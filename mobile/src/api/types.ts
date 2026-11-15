/** Mirrors server/src responses. Kept by hand: no monorepo tooling at this size. */
export type Position = [number, number]; // [lng, lat]
export type Category = 'academic' | 'residential' | 'dining' | 'athletics' | 'admin' | 'services' | 'facilities';
export type School = 'sba' | 'sse' | 'shss' | 'lc';
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Hours = Partial<Record<Day, [string, string][]>>;
export type OpenState = { state: 'open'; until: string } | { state: 'closed'; next: { day: Day; time: string } | null } | { state: 'not_published' };

export type PlaceLite = {
  id: string; name: string; number: string | null; category: Category; schools: School[]; aliases: string[];
  coordinates: Position; status: 'open' | 'closed'; closed_reason: string | null; closed_until: string | null;
  open: OpenState['state']; people_count: number; position_estimated: boolean; verified: boolean;
};
export type Entrance = { id: string; name: string; coordinates: Position; step_free: boolean; estimated: boolean };
export type PlaceDetail = PlaceLite & {
  description: string | null; hours: Hours | null; hours_text: string | null; open_state: OpenState;
  closed_from: string | null; verified_at: string | null; review_months: number; source: string;
  entrances: Entrance[]; departments: { id: string; name: string; count: number }[];
};

export type Availability = { state: 'in' | 'busy' | 'out' | 'open' | 'closed' | 'not_published'; label: string; detail: string | null; source: 'presence' | 'hours' };
export type Person = {
  id: string; name: string; title: string | null; role: 'faculty' | 'staff';
  department: { id: string; name: string } | null; email: string | null; phone: string | null; profile_url: string | null;
  place: { id: string; name: string } | null; office_number: string | null; floor: number | null;
  hours: Hours | null; hours_text: string | null; hours_raw: string | null; hours_note: string | null; by_appointment: boolean;
  open: OpenState; availability: Availability;
  note: string | null; note_kind: NoteKind | null; note_at: string | null; note_until?: string | null; lunch: [string, string]; lunch_custom: boolean;
  presence: { status: 'in' | 'busy' | 'out'; reason: string | null; until: string | null; set_at: string; set_by: string; clears_at: string } | null;
  shared_with: { id: string; name: string }[];
  conflict: { field: string; values: { value: string; place_id: string | null; source: string }[] } | null;
  verified_at: string | null; stale: boolean; source: string; missing: string[];
};
export type OfficeList = { place_id: string; total: number; floors: { floor: number | null; people: Person[] }[] };

export type RouteMode = 'walk' | 'step_free' | 'drive';
export type Turn = 'depart' | 'straight' | 'slight left' | 'slight right' | 'left' | 'right' | 'sharp left' | 'sharp right' | 'arrive';
export type Step = { turn: Turn; distance_m: number; text: string; at: Position; bearing: number; crossing: boolean; stairs: boolean; on: string | null; kind: string };
export type Route = {
  mode: RouteMode; distance_m: number; duration_s: number;
  geometry: { type: 'LineString'; coordinates: Position[] }; steps: Step[]; crossings: Position[]; uses_roads: boolean;
  destination: { place_id: string | null; entrance: string | null; entrance_estimated: boolean; step_free: boolean };
  /** the last stretch crosses an unmapped gap: shown as approximate */
  approximate?: boolean;
};

export type Procedure = {
  id: string; title: string; summary: string; owner_office: string; place_id: string | null; contact_email: string | null;
  steps: { title: string; body: string }[]; match_phrases: string[]; source: string | null; status: 'draft' | 'review' | 'live';
  verified_at: string | null; unverified: boolean;
};

export type NoteKind = 'sick' | 'online' | 'appointment' | 'email' | 'back_soon' | 'teaching' | 'conference' | 'away_week' | 'semester_off' | 'hours_moved' | 'custom';
/** A campus event (Admin → Events). state: now = under way, today = later today, soon = this week. */
export type CampusEvent = {
  id: string; title: string; description: string | null; kind: 'talk' | 'sport' | 'club' | 'culture' | 'official' | 'career' | 'other'; audience: string; organizer: string | null; link: string | null;
  starts_at: string; ends_at: string; state: 'now' | 'today' | 'soon' | 'later' | 'past'; sample: boolean;
  place: { id: string; name: string; coordinates: Position } | null; location_text: string | null;
};
export type Service = {
  id: string; name: string; short_name: string; category: string; handles: string[]; keywords: string[]; places: { id: string; name: string; known: boolean }[];
  location_text: string | null; room: string | null; email: string | null; extension: string | null; phone: string | null;
  hours: Hours | null; hours_text: string | null; hours_raw: string | null; notes: string | null; open: OpenState; verified_at: string | null; stale: boolean; source: string | null;
};
export type CampusInfo = { open: string; close: string; lunch: [string, string]; weekend_working: boolean; emergencies: string | null; exceptions: string[]; office_hours_text: string };
export type SttSession = { provider: 'soniox'; url: string; model: string; api_key: string; expires_at: string };

export type Lang = 'en' | 'fr' | 'ar';
export type AnswerAction = { type: 'route'; place_id: string; mode: 'walk' | 'step_free' | 'ar' } | { type: 'person'; person_id: string } | { type: 'help'; topic: 'walkthrough' } | { type: 'events' };
export type Answer = {
  id: string; intent: 'place' | 'person' | 'procedure' | 'service' | 'info' | 'events' | 'help' | 'unknown'; lang: Lang; text: string;
  events?: CampusEvent[]; rule?: { id: string; title: string };
  service?: Service; issue?: { id: string; issue: string; go_to: string; notes: string | null }; alert?: { tone: 'urgent' | 'closed' | 'info'; text: string };
  place?: { id: string; name: string; category: Category; status: string; closed_reason: string | null; hours: string | null; open: string; coordinates: Position };
  route?: { distance_m: number; duration_s: number; mode: string } | null;
  person?: Person;
  procedure?: { id: string; title: string; owner_office: string; steps: { title: string; body: string }[]; status: string };
  contact?: { email: string | null; phone: string | null };
  source?: string; verified_at?: string | null; unverified?: boolean; action?: AnswerAction;
  answered_by: 'local' | 'gemini' | 'claude' | 'cache' | 'none'; suggestions?: string[]; translation_review?: boolean;
};

export type WalkwayCollection = { type: 'FeatureCollection'; attribution: string; features: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: Position[] }; properties: { id: string; kind: string; modes: string; name: string | null } }[] };
export type CrowdingCollection = { type: 'FeatureCollection'; weekday: number; hour: number; basis: string; features: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: Position[] }; properties: { id: string; load: number; delay_s: number; level: 'low' | 'medium' | 'high' } }[] };
export type Closure = { id: string; cluster_id: string; kind: string; coordinates: Position; place_id: string | null; reason: string; from: string; until: string | null; radius_m: number };
export type ReportKind = 'closed' | 'broken' | 'info' | 'hazard' | 'light' | 'access';
export type MockUser = { id: string; name: string; role: 'student' | 'faculty' | 'staff' | 'admin' | 'dev' | 'guest'; person_id?: string | null; description?: string | null;
  /** set when this is a real sign-in, not a demo account */
  email?: string };
export type SignedInUser = { id: string; email: string; name: string; role: 'student' | 'faculty' | 'staff' | 'admin' | 'dev'; person_id: string | null };
export type AuthConfig = { allowed_domains: string[]; min_password: number; demo_accounts: boolean;
  /** one account per role while the dev dashboard keeps them on */
  test_accounts: { email: string; name: string; role: SignedInUser['role'] }[]; test_password: string | null };
