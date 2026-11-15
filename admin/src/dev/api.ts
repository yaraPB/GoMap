import { API_URL } from '../api';
import { getSession } from '../auth';

/** DEV_TOKEN typed on the sign-in screen (this tab only), else the account session shared with the admin. */
const KEY = 'gomap-dev-token';
export const devToken = () => sessionStorage.getItem(KEY) || getSession();
export const setDevToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearDevToken = () => sessionStorage.removeItem(KEY);

export type Role = 'student' | 'faculty' | 'staff' | 'admin' | 'dev';
export type DevUser = { id: string; email: string; name: string | null; role: Role; person_id: string | null; person: { id: string; name: string; department: string | null } | null;
  source: 'dev' | 'directory' | 'domain' | 'bootstrap' | 'test'; assigned_by: string | null; note: string | null; has_password: boolean; test: boolean; logins: number; created_at: string; updated_at: string; last_login_at: string | null };
export type Settings = { allowed_domains: string[]; default_role: Role; demo_accounts: boolean };
export type Resolution = { role: Role; source: string; person_id: string | null; name: string | null } | { refused: string };

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_URL}/api/dev${path}`, { ...init, headers: { authorization: `Bearer ${devToken()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } })
    .catch(() => { throw new Error(`Cannot reach the API at ${API_URL}. Is the server running?`); });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? 'Request failed');
  return body as T;
}
const send = <T,>(method: string, path: string, body?: unknown) => req<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const dev = {
  users: () => req<{ users: DevUser[]; roles: { id: Role; can: string }[]; settings: Settings }>('/users'),
  assign: (b: { email: string; role: Role; person_id?: string | null; note?: string }) => send<DevUser>('POST', '/users', b),
  bulk: (text: string, role: Role) => send<{ assigned: number; emails: string[]; failed: { line: string; error: string }[] }>('POST', '/users/bulk', { text, role }),
  update: (id: string, b: { role?: Role; person_id?: string | null; note?: string }) => send<DevUser>('PUT', `/users/${id}`, b),
  setPassword: (id: string, password: string) => send<DevUser>('PUT', `/users/${id}/password`, { password }),
  remove: (id: string) => send<{ ok: true; removed: string }>('DELETE', `/users/${id}`),
  check: (email: string) => req<Resolution>(`/check?email=${encodeURIComponent(email)}`),
  saveSettings: (b: Partial<Settings>) => send<Settings>('PUT', '/settings', b),
  people: (q: string) => req<{ id: string; name: string; email: string | null; role: string; department: string | null }[]>(`/people?q=${encodeURIComponent(q)}`),
  activity: () => req<{ id: string; entity_id: string; action: string; detail: Record<string, unknown> | null; actor: string; created_at: string }[]>('/activity'),
};
