/**
 * Accounts in the browser (admin and dev dashboards): email + password against the GoMap API, which
 * returns its own session. The session is kept in localStorage so both dashboards share it.
 */
import { API_URL } from './api';

export type Role = 'student' | 'faculty' | 'staff' | 'admin' | 'dev';
export type AuthConfig = { allowed_domains: string[]; min_password: number; demo_accounts: boolean;
  test_accounts: { email: string; name: string; role: Role }[]; test_password: string | null };
export type SessionUser = { id: string; email: string; name: string; role: Role; person_id: string | null };

const SESSION = 'gomap-session';
export const getSession = () => { try { return localStorage.getItem(SESSION) ?? ''; } catch { return ''; } };
export const setSession = (t: string) => { try { localStorage.setItem(SESSION, t); } catch { /* private mode */ } };
export const clearSession = () => { try { localStorage.removeItem(SESSION); } catch { /* private mode */ } };

export async function authConfig(): Promise<AuthConfig> {
  const r = await fetch(`${API_URL}/api/auth/config`);
  if (!r.ok) throw new Error('Cannot reach the API');
  return r.json();
}

/** Email + password → a GoMap session (stored), or the server's own error message. */
export async function logIn(email: string, password: string): Promise<SessionUser> {
  const r = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).catch(() => null);
  if (!r) throw new Error('Cannot reach the GoMap API. Is the server running?');
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
