/**
 * Sign-in tokens, with Node's own crypto (no extra dependency):
 *  - verifyMicrosoftIdToken: checks an ID token from Microsoft (Outlook / Entra ID sign-in) against the
 *    keys Microsoft publishes — signature (RS256), issuer, audience (our app), expiry.
 *  - signSession / verifySession: our own short JWT (HS256) the apps send on every request afterwards.
 *    It carries only the user id; the role is read from the database on every request, so a role
 *    changed in the dev dashboard applies at once.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');
export class AuthError extends Error {}

function decode(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  try {
    return { header: JSON.parse(fromB64url(parts[0]).toString()) as Record<string, unknown>, payload: JSON.parse(fromB64url(parts[1]).toString()) as Record<string, unknown>, parts };
  } catch { throw new AuthError('Malformed token'); }
}

// ── our session ─────────────────────────────────────────────────────────────

export function signSession(payload: { sub: string; email: string }, secret: string, ttlSeconds = 30 * 86400, now = Date.now()) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds, iss: 'gomap' }));
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): { sub: string; email: string } {
  const { header, payload, parts } = decode(token);
  if (header.alg !== 'HS256' || payload.iss !== 'gomap') throw new AuthError('Not a GoMap session');
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AuthError('Bad session signature');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) throw new AuthError('Session expired, sign in again');
  return { sub: String(payload.sub), email: String(payload.email) };
}

// ── Microsoft ID tokens ─────────────────────────────────────────────────────

export type MicrosoftConfig = {
  /** Application (client) ID of the app registration */
  clientId: string;
  /** 'organizations' (any work/school account), 'common', or AUI's tenant id */
  tenant: string;
  /** https://login.microsoftonline.com (or a national cloud) */
  authority: string;
  fetchImpl?: typeof fetch;
};

type Jwk = JsonWebKey & { kid?: string };
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function signingKeys(cfg: MicrosoftConfig, refresh = false) {
  const url = `${cfg.authority.replace(/\/$/, '')}/${cfg.tenant}/discovery/v2.0/keys`;
  const hit = jwksCache.get(url);
  if (hit && !refresh && Date.now() - hit.at < 6 * 3600_000) return hit.keys;
  const res = await (cfg.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AuthError(`Could not load Microsoft signing keys (${res.status})`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export type MicrosoftIdentity = { oid: string; tid: string; email: string; name: string };

export async function verifyMicrosoftIdToken(idToken: string, cfg: MicrosoftConfig, now = Date.now()): Promise<MicrosoftIdentity> {
  const { header, payload, parts } = decode(idToken);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('Unexpected token algorithm');
  let keys = await signingKeys(cfg);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await signingKeys(cfg, true); jwk = keys.find(k => k.kid === header.kid); } // Microsoft rotates keys
  if (!jwk) throw new AuthError('Unknown signing key');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), fromB64url(parts[2]));
  if (!ok) throw new AuthError('Bad token signature');
  const tid = String(payload.tid ?? '');
  const authority = cfg.authority.replace(/\/$/, '');
  if (payload.iss !== `${authority}/${tid}/v2.0`) throw new AuthError('Token from an unexpected issuer');
  // a fixed tenant (AUI's) only accepts accounts from that tenant
  if (!['common', 'organizations', 'consumers'].includes(cfg.tenant) && tid !== cfg.tenant) throw new AuthError('This account is not from Al Akhawayn');
  if (payload.aud !== cfg.clientId) throw new AuthError('Token was issued for another app');
  const t = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + 300 < t) throw new AuthError('Token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - 300 > t) throw new AuthError('Token not valid yet');
  const email = String(payload.email ?? payload.preferred_username ?? payload.upn ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AuthError('The Microsoft account has no email address');
  return { oid: String(payload.oid ?? payload.sub ?? ''), tid, email, name: String(payload.name ?? email.split('@')[0]) };
}
