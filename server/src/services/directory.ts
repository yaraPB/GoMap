import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { json, meta, type Sql } from '../db/sqlite.js';
import { campusHours, type CampusHours } from '../seed/services.js';
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
  updated_at: string; lunch?: string | null; admin_edited?: number;
};

/** Sticky-note characters a professor can put on their door. */
export const NOTE_KINDS = ['sick', 'online', 'appointment', 'email', 'back_soon', 'custom'] as const;
type PresenceRow = { person_id: string; status: 'in' | 'busy' | 'out'; reason: string | null; until: string | null; set_by: string; set_at: string };

/** Presence lasts for today only and clears itself at 18:30 campus time. */
export const PRESENCE_CLEARS_AT = '18:30';

function localDate(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** An absence that runs past today (several days, a semester): it outlives the 18:30 reset. */
export const isLongAbsence = (p: { status: string; until: string | null }, now = new Date()) =>
  p.status === 'out' && !!p.until && localDate(new Date(p.until)) > localDate(now);

export function activePresence(p: PresenceRow | undefined, now = new Date()): PresenceRow | null {
  if (!p) return null;
  if (p.status === 'out' && p.until && localDate(new Date(p.until)) >= localDate(now) && localDate(new Date(p.until)) !== localDate(new Date(p.set_at))) {
    return p.until > now.toISOString() ? p : null; // multi-day: valid until the return date
  }
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

export const REASONS = ['meeting', 'teaching', 'campus', 'away', 'sick', 'conference', 'leave', 'none'] as const;
const REASON: Record<string, string> = { meeting: 'In a meeting', teaching: 'Teaching', campus: 'Elsewhere on campus', away: 'Off campus', sick: 'Sick', conference: 'At a conference', leave: 'On leave', none: '' };
const dayName = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const DAYNAME: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function availability(hours: Hours | null, presence: PresenceRow | null, now = new Date(), lunch?: [string, string] | null): { availability: Availability; open: OpenState } {
  const open = openState(hours, config.timezone, now);
  const local = campusNow(config.timezone, now);
  const weekday = !['sat', 'sun'].includes(local.day);
  if (!presence && lunch && weekday && local.time >= lunch[0] && local.time < lunch[1] && open.state !== 'open') {
    return { availability: { state: 'closed', label: 'At lunch', detail: `back at ${lunch[1]}`, source: 'hours' }, open };
  }
  if (presence) {
    const long = isLongAbsence(presence, now);
    const until = !presence.until ? 'for the rest of today' : long ? `back ${dayName(presence.until)}` : `until ${time(presence.until)}`;
    const label = presence.status === 'in' ? 'In the office' : presence.status === 'busy' ? 'Busy' : long ? 'Away' : 'Not in today';
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

  campus(): CampusHours { return json.parse<CampusHours>(meta.get(this.db, 'campus_hours'), campusHours()); }

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
    const lunch = json.parse<[string, string] | null>(r.lunch ?? null, null) ?? this.campus().lunch;
    const { availability: avail, open } = availability(hours, presence, now, lunch);
    const noteRow = this.db.prepare('SELECT note, kind, updated_at FROM office_notes WHERE person_id = ?').get(r.id) as { note: string; kind: string | null; updated_at: string } | undefined;
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
      note: noteRow?.note ?? null, note_kind: noteRow?.kind ?? (noteRow ? 'custom' : null), note_at: noteRow?.updated_at ?? null,
      lunch, lunch_custom: !!r.lunch,
      presence: presence ? { status: presence.status, reason: presence.reason, until: presence.until, set_at: presence.set_at, set_by: presence.set_by, clears_at: PRESENCE_CLEARS_AT } : null,
      shared_with: shared,
      conflict: json.parse(r.conflict, null),
      verified_at: r.verified_at, stale: isStale(r.verified_at), source: r.source,
      missing: [!r.place_id && 'office', !r.email && 'email', !hours && 'hours'].filter(Boolean) as string[],
    };
  }

  setPresence(id: string, input: { status: 'in' | 'busy' | 'out' | 'clear'; reason?: string | null; until?: string | null }, actor: string) {
    // the time log: close whatever session is open, start a new one
    const at = new Date().toISOString();
    this.db.prepare('UPDATE presence_log SET ended_at = ? WHERE person_id = ? AND ended_at IS NULL').run(at, id);
    if (input.status !== 'clear') this.db.prepare('INSERT INTO presence_log (id, person_id, status, started_at, ended_at) VALUES (?,?,?,?,?)').run(randomUUID(), id, input.status, at, input.until ?? null);
    if (input.status === 'clear') { this.db.prepare('DELETE FROM presence WHERE person_id = ?').run(id); return; }
    this.db.prepare(`INSERT INTO presence (person_id,status,reason,until,set_by,set_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(person_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, until=excluded.until, set_by=excluded.set_by, set_at=excluded.set_at`)
      .run(id, input.status, input.reason ?? null, input.until ?? null, actor, new Date().toISOString());
  }

  /**
   * Published office hours vs time actually marked "in the office", over the last `days` days.
   * Open sessions stop at the 18:30 reset (or now). This is what the admin's time report shows.
   */
  officeTime(days = 7, now = new Date()) {
    const since = new Date(now.getTime() - days * 86400000).toISOString();
    const logs = this.db.prepare('SELECT person_id, status, started_at, ended_at FROM presence_log WHERE started_at >= ? OR ended_at IS NULL OR ended_at >= ?').all(since, since) as { person_id: string; status: string; started_at: string; ended_at: string | null }[];
    const byPerson = new Map<string, { in: number; busy: number; sessions: number; days: Record<string, number>; heat: number[][] }>();
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // weekday (Mon = 0) × campus hour, minutes in office
    const addHeat = (grid: number[][], from: number, to: number) => {
      for (let t = from; t < to; t += 60000 * 5) { const d = new Date(t + 3600000); grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()] += 5; } // campus ≈ UTC+1, 5-minute steps
    };
    for (const l of logs) {
      const start = new Date(Math.max(Date.parse(l.started_at), Date.parse(since)));
      const reset = new Date(start); // same local day, 18:30 campus time (≈ UTC+1)
      reset.setUTCHours(17, 30, 0, 0);
      const endCap = Math.min(now.getTime(), reset.getTime() > start.getTime() ? reset.getTime() : start.getTime());
      const end = l.ended_at ? Math.min(Date.parse(l.ended_at), endCap) : endCap;
      const minutes = Math.max(0, Math.round((end - start.getTime()) / 60000));
      const e = byPerson.get(l.person_id) ?? { in: 0, busy: 0, sessions: 0, days: {} as Record<string, number>, heat: Array.from({ length: 7 }, () => new Array(24).fill(0)) };
      if (l.status === 'in') { e.in += minutes; const d = l.started_at.slice(0, 10); e.days[d] = (e.days[d] ?? 0) + minutes; addHeat(heat, start.getTime(), end); addHeat(e.heat, start.getTime(), end); }
      if (l.status === 'busy') e.busy += minutes;
      e.sessions++;
      byPerson.set(l.person_id, e);
    }
    return Object.assign(byPerson, { heat });
  }
}
