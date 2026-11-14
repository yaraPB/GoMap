declare const __API_URL__: string;
declare const __MAPBOX_TOKEN__: string;
export const API_URL = __API_URL__;
export const MAPBOX_TOKEN = __MAPBOX_TOKEN__;

// TODO: replace with GoCampus SSO
const KEY = 'gomap-admin-token';
export const getToken = () => sessionStorage.getItem(KEY) ?? '';
export const setToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearToken = () => sessionStorage.removeItem(KEY);

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${getToken()}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  }).catch(() => { throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is the server running?`); });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? 'Request failed');
  return body as T;
}
const put = <T,>(p: string, b: unknown) => req<T>(p, { method: 'PUT', body: JSON.stringify(b) });
const post = <T,>(p: string, b: unknown = {}) => req<T>(p, { method: 'POST', body: JSON.stringify(b) });

export type Hours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;
export type Place = {
  id: string; name: string; number: string | null; category: string; schools: string[]; aliases: string[]; coordinates: [number, number];
  status: 'open' | 'closed'; closed_reason: string | null; closed_until: string | null; people_count: number; position_estimated: boolean; verified: boolean;
};
export type PlaceDetail = Place & { description: string | null; hours: Hours | null; verified_at: string | null; review_months: number; source: string;
  entrances: { id: string; name: string; coordinates: [number, number]; step_free: boolean; estimated: boolean }[]; departments: { id: string; name: string; count: number }[] };
export type Person = {
  id: string; name: string; title: string | null; role: string; department: { id: string; name: string } | null; email: string | null; phone: string | null;
  place: { id: string; name: string } | null; office_number: string | null; floor: number | null; hours: Hours | null; hours_raw: string | null;
  conflict: { field: string; values: { value: string; place_id: string | null; source: string }[] } | null; verified_at: string | null; stale: boolean; missing: string[];
  availability: { state: string; label: string; detail: string | null };
};
export type Procedure = { id: string; title: string; summary: string; owner_office: string; place_id: string | null; contact_email: string | null;
  steps: { title: string; body: string }[]; match_phrases: string[]; source: string | null; status: 'draft' | 'review' | 'live'; verified_at: string | null; unverified: boolean };
export type ReportCluster = {
  cluster_id: string; status: string; kind: string; count: number; coordinates: [number, number]; place: { id: string; name: string } | null;
  closure: { from: string; until: string | null; reason: string; radius_m: number } | null; first_at: string; last_at: string;
  reports: { id: string; kind: string; note: string | null; photo_path: string | null; duration: string; reporter: string; created_at: string }[];
};
export type Overview = {
  counts: Record<string, number>;
  conflicts: { id: string; name: string; conflict: Person['conflict'] }[];
  shared_offices: { place_id: string; office_number: string; names: string; n: number }[];
  stale: { places: { id: string; name: string; verified_at: string | null; position_estimated: boolean }[]; people: { id: string; name: string; verified_at: string | null }[]; people_total: number };
  missing: { id: string; name: string; missing: string[] }[]; missing_total: number;
  unanswered: { question: string; lang: string; times: number; last: string }[];
  procedures_not_live: { id: string; title: string; status: string }[];
};

export const api = {
  overview: () => req<Overview>('/api/admin/overview'),
  places: () => req<Place[]>('/api/places'),
  place: (id: string) => req<PlaceDetail>(`/api/places/${id}`),
  savePlace: (id: string, b: Record<string, unknown>) => put<unknown>(`/api/admin/places/${id}`, b),
  saveEntrance: (id: string, b: Record<string, unknown>) => put<unknown>(`/api/admin/entrances/${id}`, b),
  people: () => req<Person[]>('/api/people'),
  person: (id: string) => req<Person>(`/api/people/${id}`),
  savePerson: (id: string, b: Record<string, unknown>) => put<Person>(`/api/admin/people/${id}`, b),
  procedures: () => req<Procedure[]>('/api/procedures'),
  saveProcedure: (id: string, b: Record<string, unknown>) => put<unknown>(`/api/admin/procedures/${id}`, b),
  createProcedure: (b: Record<string, unknown>) => post<{ id: string }>('/api/admin/procedures', b),
  preview: (question: string) => post<{ intent: string; text: string; procedure?: { title: string; steps: { title: string; body: string }[] }; place?: { name: string; hours: string | null }; unverified?: boolean; source?: string; answered_by: string }>('/api/admin/procedures/preview', { question }),
  reports: (status?: string) => req<ReportCluster[]>(`/api/admin/reports${status ? `?status=${status}` : ''}`),
  confirm: (cluster: string, b: { from: string; until: string | null; reason: string; radius_m: number; close_place: boolean }) => post<{ notified: string[]; closed_edges: number }>(`/api/admin/reports/${cluster}/confirm`, b),
  dismiss: (cluster: string) => post(`/api/admin/reports/${cluster}/dismiss`),
  resolve: (cluster: string) => post(`/api/admin/reports/${cluster}/resolve`),
  log: () => req<{ id: string; question: string; lang: string; intent: string; answered_by: string; created_at: string }[]>('/api/admin/assistant-log'),
  changes: () => req<{ id: string; entity: string; entity_id: string; action: string; detail: unknown; actor: string; created_at: string }[]>('/api/admin/changes'),
};

export const CATEGORIES = ['academic', 'residential', 'dining', 'athletics', 'admin', 'services', 'facilities'];
export const CAT_COLOR: Record<string, string> = { academic: '#2563EB', residential: '#E0841F', dining: '#D1473F', athletics: '#11864F', admin: '#6D5BD0', services: '#0E7490', facilities: '#6B7280' };
export const SCHOOLS = [['sba', 'Business Administration'], ['sse', 'Science & Engineering'], ['shss', 'Humanities & Social Sciences'], ['lc', 'Language Center']] as const;
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
