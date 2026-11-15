/**
 * Sign in with Outlook in the browser (admin and dev dashboards): Microsoft's authorization-code flow
 * with PKCE for single-page apps. No client secret, no library. Microsoft gives us an ID token, the
 * GoMap API checks it against Microsoft's keys and returns its own session, kept in localStorage so
 * both dashboards share it.
 */
import { API_URL } from './api';

export type AuthConfig = { microsoft: { client_id: string; tenant: string; authority: string } | null; demo_accounts: boolean };
export type SessionUser = { id: string; email: string; name: string; role: 'student' | 'faculty' | 'staff' | 'admin' | 'dev'; person_id: string | null };

const SESSION = 'gomap-session';
const PENDING = 'gomap-ms-pending';
export const getSession = () => { try { return localStorage.getItem(SESSION) ?? ''; } catch { return ''; } };
export const setSession = (t: string) => { try { localStorage.setItem(SESSION, t); } catch { /* private mode */ } };
export const clearSession = () => { try { localStorage.removeItem(SESSION); } catch { /* private mode */ } };

const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
/** Where Microsoft sends people back: this very page, without query or hash. */
export const redirectUri = () => `${location.origin}${location.pathname}`;

export async function authConfig(): Promise<AuthConfig> {
  const r = await fetch(`${API_URL}/api/auth/config`);
  if (!r.ok) throw new Error('Cannot reach the API');
  return r.json();
}

/** Off to Microsoft's sign-in page. */
export async function startMicrosoftSignIn(cfg: NonNullable<AuthConfig['microsoft']>, returnHash = location.hash) {
  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = random(16);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, returnHash, cfg }));
  const q = new URLSearchParams({
    client_id: cfg.client_id, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: 'openid profile email', code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
  });
  location.assign(`${cfg.authority}/${cfg.tenant}/oauth2/v2.0/authorize?${q}`);
}

/**
 * Back from Microsoft (?code=…): trade the code for the ID token, then for a GoMap session.
 * Returns the signed-in user, or null when this page load is not a sign-in return.
 */
export async function finishMicrosoftSignIn(): Promise<SessionUser | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code'), error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (!code && !error) return null;
  const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null') as { verifier: string; state: string; returnHash: string; cfg: NonNullable<AuthConfig['microsoft']> } | null;
  sessionStorage.removeItem(PENDING);
  history.replaceState(null, '', `${redirectUri()}${pending?.returnHash ?? ''}`);
  if (error) throw new Error(`Microsoft sign-in was cancelled or failed: ${error}`);
  if (!pending || url.searchParams.get('state') !== pending.state) throw new Error('This sign-in link expired. Please sign in again.');
  const tok = await fetch(`${pending.cfg.authority}/${pending.cfg.tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: pending.cfg.client_id, grant_type: 'authorization_code', code: code!, redirect_uri: redirectUri(), code_verifier: pending.verifier, scope: 'openid profile email' }),
  });
  const t = await tok.json().catch(() => ({})) as { id_token?: string; error_description?: string };
  if (!tok.ok || !t.id_token) throw new Error(t.error_description?.split('\r\n')[0] ?? 'Microsoft did not return an ID token.');
  const r = await fetch(`${API_URL}/api/auth/microsoft`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id_token: t.id_token }) });
  const body = await r.json().catch(() => ({})) as { token?: string; user?: SessionUser; error?: string };
  if (!r.ok || !body.token) throw new Error(body.error ?? 'GoMap could not sign you in.');
  setSession(body.token);
  return body.user!;
}

export async function me(token = getSession()): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await fetch(`${API_URL}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  return r?.ok ? r.json() : null;
}

/** The Microsoft logo, as drawn on Microsoft's own sign-in buttons. */
export function MicrosoftMark({ size = 18 }: { size?: number }) {
  const s = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <rect x="0" y="0" width={s} height={s} fill="#F25022" /><rect x={s + 2} y="0" width={s} height={s} fill="#7FBA00" />
      <rect x="0" y={s + 2} width={s} height={s} fill="#00A4EF" /><rect x={s + 2} y={s + 2} width={s} height={s} fill="#FFB900" />
    </svg>
  );
}
