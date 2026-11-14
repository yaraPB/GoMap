import { Platform } from 'react-native';
import type { Answer, Closure, CrowdingCollection, Lang, MockUser, OfficeList, Person, PlaceDetail, PlaceLite, Position, Procedure, ReportKind, Route, RouteMode, WalkwayCollection } from './types';

const local = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || local).replace(/\/$/, '');

/** The mock account in use (no SSO yet). Sent on every request. TODO: replace with GoCampus SSO */
let currentUser = 'demo-student';
export const setApiUser = (id: string) => { currentUser = id; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'x-gomap-user': currentUser, ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, (body as { error?: string }).error || 'Request failed');
  return body as T;
}
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `?${s}` : '';
};
const ll = (p: Position | null | undefined) => (p ? { lat: p[1], lng: p[0] } : undefined);

export const api = {
  places: (f: { category?: string; school?: string; q?: string } = {}) => request<PlaceLite[]>(`/api/places${qs(f)}`),
  place: (id: string) => request<PlaceDetail>(`/api/places/${encodeURIComponent(id)}`),
  offices: (id: string) => request<OfficeList>(`/api/places/${encodeURIComponent(id)}/people`),
  people: (f: { q?: string; department?: string; open_now?: boolean; limit?: number } = {}) => request<Person[]>(`/api/people${qs(f)}`),
  person: (id: string) => request<Person>(`/api/people/${encodeURIComponent(id)}`),
  setPresence: (id: string, body: { status: 'in' | 'busy' | 'out' | 'clear'; reason?: string | null; until?: string | null }) =>
    request<Person>(`/api/people/${encodeURIComponent(id)}/presence`, { method: 'PUT', body: JSON.stringify(body) }),
  procedures: (q?: string) => request<Procedure[]>(`/api/procedures${qs({ q })}`),
  route: (from: Position, to: { placeId?: string; coord?: Position }, mode: RouteMode) =>
    request<Route>('/api/route', { method: 'POST', body: JSON.stringify({ from: ll(from), to_place_id: to.placeId, to: ll(to.coord), mode }) }),
  walkways: () => request<WalkwayCollection>('/api/geo/walkways'),
  closures: () => request<Closure[]>('/api/geo/closures'),
  crowding: (weekday: number, hour: number) => request<CrowdingCollection>(`/api/crowding${qs({ weekday, hour })}`),
  ask: (text: string, lang: Lang, from: Position | null, history: { role: 'user' | 'assistant'; text: string }[], localOnly = false) =>
    request<Answer>('/api/assistant/ask', { method: 'POST', body: JSON.stringify({ text, lang, from: ll(from), history: history.slice(-6), local_only: localOnly }) }),
  transcribe: async (uri: string, lang: Lang) => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      form.append('audio', blob, 'question.webm');
    } else {
      form.append('audio', { uri, name: 'question.m4a', type: 'audio/mp4' } as unknown as Blob);
    }
    form.append('lang', lang);
    return request<{ text: string }>('/api/assistant/transcribe', { method: 'POST', body: form });
  },
  report: (r: { kind: ReportKind; at: Position; note?: string; duration?: 'today' | 'days' | 'unknown'; photoUri?: string | null }) => {
    const form = new FormData();
    form.append('kind', r.kind);
    form.append('lat', String(r.at[1]));
    form.append('lng', String(r.at[0]));
    if (r.note) form.append('note', r.note);
    form.append('duration', r.duration ?? 'unknown');
    if (r.photoUri) form.append('photo', { uri: r.photoUri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
    return request<{ id: string; status: string; place: { id: string; name: string } | null; merged_with_existing: boolean }>('/api/reports', { method: 'POST', body: form });
  },
  myReports: () => request<{ id: string; kind: string; status: string; place_id: string | null; created_at: string; decided_at: string | null; reason: string | null }[]>('/api/reports/mine'),
  mockUsers: () => request<MockUser[]>('/api/mock-users'),
};
