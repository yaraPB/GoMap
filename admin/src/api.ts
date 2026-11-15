declare const __API_URL__: string;
declare const __MAPBOX_TOKEN__: string;
export const API_URL = __API_URL__;
export const MAPBOX_TOKEN = __MAPBOX_TOKEN__;

// TODO: replace with GoCampus SSO
const KEY = 'gomap-admin-token';
/** The admin token if one was typed, else the account session (shared with the dev dashboard). */
export const getToken = () => sessionStorage.getItem(KEY) || (() => { try { return localStorage.getItem('gomap-session') ?? ''; } catch { return ''; } })();
export const setToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearToken = () => { sessionStorage.removeItem(KEY); try { localStorage.removeItem('gomap-session'); } catch { /* private mode */ } };

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
const del = <T,>(p: string) => req<T>(p, { method: 'DELETE' });

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
  note: string | null; note_kind: NoteKind | null; note_at: string | null; lunch: [string, string]; lunch_custom: boolean;
  presence: { status: string; reason: string | null; until: string | null; set_by: string } | null;
};
export type NoteKind = 'sick' | 'online' | 'appointment' | 'email' | 'back_soon' | 'teaching' | 'conference' | 'away_week' | 'semester_off' | 'hours_moved' | 'custom';
export type OpenState = { state: 'open'; until: string } | { state: 'closed'; next: { day: string; time: string } | null } | { state: 'not_published' };
export type Service = {
  id: string; name: string; short_name: string; category: string; handles: string[]; keywords: string[]; places: { id: string; name: string; known: boolean }[];
  location_text: string | null; room: string | null; email: string | null; extension: string | null; phone: string | null; hours: Hours | null; hours_text: string | null;
  hours_raw: string | null; notes: string | null; open: OpenState; verified_at: string | null; stale: boolean; source: string | null; admin_edited: boolean; updated_at: string;
};
export type Issue = { id: string; issue: string; go_to: string; service_id: string | null; location_text: string | null; place: { id: string; name: string; known: boolean } | null; notes: string | null; keywords: string[]; sort: number; admin_edited: boolean };
export type CampusHours = { open: string; close: string; lunch: [string, string]; weekend_working: boolean; emergencies: string | null; exceptions: string[] };
export type OfficeTimeRow = { id: string; name: string; department: string | null; place: { id: string; name: string } | null; office_number: string | null; hours: Hours | null; hours_text: string | null;
  published_min: number; in_min: number; busy_min: number; sessions: number; by_day: Record<string, number>; ratio: number | null; heat: number[][] | null };
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

export type CampusEvent = { id: string; title: string; description: string | null; kind: string; audience: string; organizer: string | null; link: string | null;
  starts_at: string; ends_at: string; state: 'now' | 'today' | 'soon' | 'later' | 'past'; sample: boolean; place: { id: string; name: string; coordinates: [number, number] } | null; location_text: string | null };
export type Rule = { id: string; title: string; triggers: string[]; answer: string; answer_fr: string | null; answer_ar: string | null; place_id: string | null; service_id: string | null;
  procedure_id: string | null; urgent: boolean; enabled: boolean; hits: number; updated_at: string };
export type Trace = { candidates: { intent: string; id: string; score: number }[]; tools: { name: string; args: Record<string, string>; found: boolean }[]; ms: number; model: string | null };
export type TryAnswer = { intent: string; text: string; answered_by: string; rule?: { id: string; title: string }; place?: { id: string; name: string }; service?: { id: string; short_name: string };
  procedure?: { id: string; title: string }; person?: { id: string; name: string }; events?: CampusEvent[]; alert?: { tone: string; text: string }; trace?: Trace; unverified?: boolean };
export type TestResult = { pass: boolean; why: string[]; intent: string; id: string | null; text: string; answered_by: string; trace: Trace | null; at: string };
export type AssistantTest = { id: string; question: string; lang: string; expect_intent: string | null; expect_id: string | null; expect_text: string | null; last_result: TestResult | null; updated_at: string };
export type FootprintFC = { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: { id: string; place_id: string | null; place_name: string | null; source: string } }[] };

export const api = {
  overview: () => req<Overview>('/api/admin/overview'),
  places: () => req<Place[]>('/api/places'),
  place: (id: string) => req<PlaceDetail>(`/api/places/${id}`),
  savePlace: (id: string, b: Record<string, unknown>) => put<unknown>(`/api/admin/places/${id}`, b),
  createPlace: (b: Record<string, unknown>) => post<{ _id: string; name: string }>('/api/admin/places', b),
  deletePlace: (id: string) => del<{ ok: true; deleted: Record<string, unknown> & { _id: string; name: string; category: string; location: { coordinates: [number, number] } }; people_unlinked: number }>(`/api/admin/places/${encodeURIComponent(id)}`),
  footprints: () => req<FootprintFC>('/api/admin/footprints'),
  events: () => req<CampusEvent[]>('/api/admin/events'),
  createEvent: (b: Record<string, unknown>) => post<CampusEvent>('/api/admin/events', b),
  saveEvent: (id: string, b: Record<string, unknown>) => put<CampusEvent>(`/api/admin/events/${id}`, b),
  deleteEvent: (id: string) => del(`/api/admin/events/${id}`),
  rules: () => req<Rule[]>('/api/admin/rules'),
  createRule: (b: Record<string, unknown>) => post<Rule>('/api/admin/rules', b),
  saveRule: (id: string, b: Record<string, unknown>) => put<Rule>(`/api/admin/rules/${id}`, b),
  deleteRule: (id: string) => del(`/api/admin/rules/${id}`),
  tests: () => req<AssistantTest[]>('/api/admin/assistant-tests'),
  createTest: (b: Record<string, unknown>) => post<AssistantTest>('/api/admin/assistant-tests', b),
  saveTest: (id: string, b: Record<string, unknown>) => put<AssistantTest>(`/api/admin/assistant-tests/${id}`, b),
  deleteTest: (id: string) => del(`/api/admin/assistant-tests/${id}`),
  runTests: (b: { id?: string; local_only?: boolean } = {}) => post<{ total: number; passed: number; results: (TestResult & { test: string })[] }>('/api/admin/assistant-tests/run', b),
  tryAsk: (question: string, lang = 'en') => post<TryAnswer>('/api/admin/assistant/try', { question, lang }),
  assistantStatus: () => req<{ model: { provider: string; model: string } | null; rules: number; transcription: string | null }>('/api/admin/assistant/status'),
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
  services: () => req<Service[]>('/api/admin/services'),
  saveService: (id: string, b: Record<string, unknown>) => put<Service>(`/api/admin/services/${id}`, b),
  createService: (b: Record<string, unknown>) => post<Service>('/api/admin/services', b),
  deleteService: (id: string) => del(`/api/admin/services/${id}`),
  issues: () => req<Issue[]>('/api/admin/issues'),
  saveIssue: (id: string, b: Record<string, unknown>) => put<Issue>(`/api/admin/issues/${id}`, b),
  createIssue: (b: Record<string, unknown>) => post<Issue>('/api/admin/issues', b),
  deleteIssue: (id: string) => del(`/api/admin/issues/${id}`),
  campus: () => req<CampusHours>('/api/campus'),
  saveCampus: (b: Partial<CampusHours>) => put<CampusHours>('/api/admin/campus-hours', b),
  officeTime: (days: number, department?: string) => req<{ days: number; heat: number[][]; people: OfficeTimeRow[] }>(`/api/admin/office-time?days=${days}${department ? `&department=${department}` : ''}`),
  ask: (question: string) => post<{ intent: string; text: string; service?: Service; issue?: { go_to: string }; alert?: { text: string }; answered_by: string }>('/api/admin/procedures/preview', { question }),
  log: () => req<{ id: string; question: string; lang: string; intent: string; answered_by: string; created_at: string }[]>('/api/admin/assistant-log'),
  changes: () => req<{ id: string; entity: string; entity_id: string; action: string; detail: unknown; actor: string; created_at: string }[]>('/api/admin/changes'),
};

export const SERVICE_CATEGORIES: [string, string][] = [['academic', 'Academic'], ['money', 'Money'], ['wellbeing', 'Health & wellbeing'], ['campus_life', 'Campus life'], ['it', 'IT'], ['admin', 'Administration'], ['service', 'Other']];
export const NOTE_KINDS: [NoteKind, string][] = [['sick', 'Out sick today'], ['online', 'Online meeting'], ['appointment', 'Take an appointment'], ['email', 'Email me'], ['back_soon', 'Back soon'], ['teaching', 'Teaching'], ['conference', 'At a conference'], ['away_week', 'Not here this week'], ['semester_off', 'On leave this semester'], ['hours_moved', 'Office hours moved'], ['custom', 'Note']];
export const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`);
export const CATEGORIES = ['academic', 'residential', 'dining', 'athletics', 'admin', 'services', 'facilities'];
export const EVENT_KINDS: [string, string][] = [['talk', 'Talk'], ['sport', 'Sport'], ['club', 'Clubs'], ['culture', 'Culture'], ['official', 'Official'], ['career', 'Careers'], ['other', 'Other']];
export const AUDIENCES: [string, string][] = [['all', 'Everyone'], ['students', 'Students'], ['faculty', 'Faculty & staff'], ['visitors', 'Visitors']];
export const CAT_COLOR: Record<string, string> = { academic: '#2563EB', residential: '#E0841F', dining: '#D1473F', athletics: '#11864F', admin: '#6D5BD0', services: '#0E7490', facilities: '#6B7280' };
export const SCHOOLS = [['sba', 'Business Administration'], ['sse', 'Science & Engineering'], ['shss', 'Humanities & Social Sciences'], ['lc', 'Language Center']] as const;
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
