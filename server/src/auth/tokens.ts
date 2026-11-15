/**
 * Passwords and sessions, with Node's own crypto (no extra dependency):
 *  - hashPassword / checkPassword: scrypt with a random salt per password (never stored in clear).
 *  - signSession / verifySession: a short JWT (HS256) the apps send on every request. It carries only the
 *    user id; the role is read from the database on every request, so a role changed in the dev
 *    dashboard applies at once.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');
export class AuthError extends Error {}

// ── passwords ───────────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1 };
/** "scrypt$<salt>$<hash>" */
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export function checkPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = fromB64url(hash);
  const got = scryptSync(password, fromB64url(salt), want.length, SCRYPT);
  return timingSafeEqual(got, want);
}

// ── our session ─────────────────────────────────────────────────────────────

function decode(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  try {
    return { header: JSON.parse(fromB64url(parts[0]).toString()) as Record<string, unknown>, payload: JSON.parse(fromB64url(parts[1]).toString()) as Record<string, unknown>, parts };
  } catch { throw new AuthError('Malformed token'); }
}

export function signSession(payload: { sub: string; email: string }, secret: string, ttlSeconds = 30 * 86400, now = Date.now()) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds, iss: 'gomap' }));
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): { sub: string; email: string; iat: number } {
  const { header, payload, parts } = decode(token);
  if (header.alg !== 'HS256' || payload.iss !== 'gomap') throw new AuthError('Not a GoMap session');
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AuthError('Bad session signature');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) throw new AuthError('Session expired, sign in again');
  return { sub: String(payload.sub), email: String(payload.email), iat: Number(payload.iat ?? 0) };
}

/** A brake on password guessing: after 8 wrong tries for one email, wait a minute. In memory, per server. */
export class LoginThrottle {
  private fails = new Map<string, { n: number; until: number }>();
  check(key: string, now = Date.now()) {
    const f = this.fails.get(key);
    if (f && f.until > now) throw new AuthError(`Too many wrong passwords. Try again in ${Math.ceil((f.until - now) / 1000)} s.`);
  }
  failed(key: string, now = Date.now()) {
    const f = this.fails.get(key) ?? { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 8) { f.until = now + 60_000; f.n = 0; }
    this.fails.set(key, f);
  }
  ok(key: string) { this.fails.delete(key); }
}
