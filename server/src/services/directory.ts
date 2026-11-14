import { config } from '../config.js';
import { json, type Sql } from '../db/sqlite.js';
import { campusNow, formatHours, openState, parseHours, type Hours, type OpenState } from '../lib/hours.js';

export const DEPARTMENTS: Record<string, { name: string; school: string }> = {
  SBA: { name: 'School of Business Administration', school: 'sba' },
  SSE: { name: 'School of Science and Engineering', school: 'sse' },
  SSAH: { name: 'School of Social Sciences, Arts and Humanities', school: 'shss' },
  LC: { name: 'Language Center', school: 'lc' },
};

export type PersonRow = {
  id: string; name: string; title: string | null; department: string | null; email: string | null; phone: string | null;
  profile_url: string | null; role: string; place_id: string | null; office_number: string | null; floor: number | null;
  office_hours: string | null; hours_raw: string | null; conflict: string | null; verified_at: string | null; source: string;
  updated_at: string;
};
type PresenceRow = { person_id: string; status: 'in' | 'busy' | 'out'; reason: string | null; until: string | null; set_by: string; set_at: string };

/** Presence lasts for today only and clears itself at 18:30 campus time. */
export const PRESENCE_CLEARS_AT = '18:30';

function localDate(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function activePresence(p: PresenceRow | undefined, now = new Date()): PresenceRow | null {
  if (!p) return null;
  if (localDate(new Date(p.set_at)) !== localDate(now)) return null;
  if (campusNow(config.timezone, now).time >= PRESENCE_CLEARS_AT) return null;
  if (p.until && p.until <= now.toISOString()) return null;
  return p;
}

export function clearExpiredPresence(db: Sql, now = new Date()) {
  const rows = db.prepare('SELECT * FROM presence').all() as PresenceRow[];
  const del = db.prepare('DELETE FROM presence WHERE person_id = ?');
  for (const r of rows) if (!activePresence(r, now)) del.run(r.person_id);
}

export type Availability = { state: 'in' | 'busy' | 'out' | 'open' | 'closed' | 'not_published'; label: string; detail: string | null; source: 'presence' | 'hours' };

const REASON: Record<string, string> = { meeting: 'In a meeting', teaching: 'Teaching', campus: 'Elsewhere on campus', away: 'Off campus', none: '' };
const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const DAYNAME: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function availability(hours: Hours | null, presence: PresenceRow | null, now = new Date()): { availability: Availability; open: OpenState } {
  const open = openState(hours, config.timezone, now);
  if (presence) {
    const until = presence.until ? `until ${time(presence.until)}` : 'for the rest of today';
    const label = presence.status === 'in' ? 'In the office' : presence.status === 'busy' ? 'Busy' : 'Not in today';
    const detail = [REASON[presence.reason ?? 'none'], until].filter(Boolean).join(' · ');
    return { availability: { state: presence.status, label, detail, source: 'presence' }, open };
  }
  if (open.state === 'open') return { availability: { state: 'open', label: 'Office hours now', detail: `until ${open.until}`, source: 'hours' }, open };
  if (open.state === 'closed') {
    const next = open.next ? `Next: ${DAYNAME[open.next.day]} ${open.next.time}` : null;
    return { availability: { state: 'closed', label: 'Not in office hours', detail: next, source: 'hours' }, open };
  }
  return { availability: { state: 'not_published', label: 'Hours not published', detail: null, source: 'hours' }, open };
}

export function isStale(verifiedAt: string | null, months = 6, now = new Date()) {
  if (!verifiedAt) return true;
  const d = new Date(verifiedAt);
  d.setMonth(d.getMonth() + months);
  return d < now;
}

export class Directory {
  constructor(private db: Sql) {}

  row(id: string) { return this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow | undefined; }

  presence(id: string) { return activePresence(this.db.prepare('SELECT * FROM presence WHERE person_id = ?').get(id) as PresenceRow | undefined); }

  list(filter: { q?: string; department?: string; placeId?: string } = {}) {
    const rows = this.db.prepare(`SELECT * FROM people WHERE (? = '' OR department = ?) AND (? = '' OR place_id = ?) ORDER BY name`)
      .all(filter.department ?? '', filter.department ?? '', filter.placeId ?? '', filter.placeId ?? '') as PersonRow[];
    if (!filter.q) return rows;
    const q = filter.q.toLowerCase();
    return rows.filter(r => `${r.name} ${r.title ?? ''} ${r.office_number ?? ''}`.toLowerCase().includes(q));
  }

  /** The public view of a person: what the card, the office list and the assistant all show. */
  view(r: PersonRow, placeNames: Map<string, string>, now = new Date()) {
    const hours = json.parse<Hours | null>(r.office_hours, null);
    const parsed = parseHours(r.hours_raw);
    const presence = this.presence(r.id);
    const { availability: avail, open } = availability(hours, presence, now);
    const shared = r.place_id && r.office_number
      ? (this.db.prepare('SELECT id, name FROM people WHERE place_id = ? AND office_number = ? AND id != ?').all(r.place_id, r.office_number, r.id) as { id: string; name: string }[])
      : [];
    return {
      id: r.id, name: r.name, title: r.title, role: r.role,
      department: r.department ? { id: r.department, name: DEPARTMENTS[r.department]?.name ?? r.department } : null,
      email: r.email, phone: r.phone, profile_url: r.profile_url,
      place: r.place_id ? { id: r.place_id, name: placeNames.get(r.place_id) ?? r.place_id } : null,
      office_number: r.office_number, floor: r.floor,
      hours, hours_text: formatHours(hours), hours_raw: r.hours_raw, hours_note: parsed.note, by_appointment: parsed.byAppointment,
      open, availability: avail,
      note: (this.db.prepare('SELECT note FROM office_notes WHERE person_id = ?').get(r.id) as { note: string } | undefined)?.note ?? null,
      presence: presence ? { status: presence.status, reason: presence.reason, until: presence.until, set_at: presence.set_at, set_by: presence.set_by, clears_at: PRESENCE_CLEARS_AT } : null,
      shared_with: shared,
      conflict: json.parse(r.conflict, null),
      verified_at: r.verified_at, stale: isStale(r.verified_at), source: r.source,
      missing: [!r.place_id && 'office', !r.email && 'email', !hours && 'hours'].filter(Boolean) as string[],
    };
  }

  setPresence(id: string, input: { status: 'in' | 'busy' | 'out' | 'clear'; reason?: string | null; until?: string | null }, actor: string) {
    if (input.status === 'clear') { this.db.prepare('DELETE FROM presence WHERE person_id = ?').run(id); return; }
    this.db.prepare(`INSERT INTO presence (person_id,status,reason,until,set_by,set_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(person_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, until=excluded.until, set_by=excluded.set_by, set_at=excluded.set_at`)
      .run(id, input.status, input.reason ?? null, input.until ?? null, actor, new Date().toISOString());
  }
}
