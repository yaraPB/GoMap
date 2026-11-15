/**
 * Campus events. Kept in SQLite (they are records with times, not geometry); place_id points at
 * a Mongo place so the app can draw the event's pin and route to it.
 */
import { randomUUID } from 'node:crypto';
import type { Position } from 'geojson';
import type { Sql } from '../db/sqlite.js';
import { meta } from '../db/sqlite.js';

export const EVENT_KINDS = ['talk', 'sport', 'club', 'culture', 'official', 'career', 'other'] as const;
export const AUDIENCES = ['all', 'students', 'faculty', 'visitors'] as const;

export type EventRow = {
  id: string; title: string; description: string | null; kind: string; place_id: string | null; location_text: string | null;
  starts_at: string; ends_at: string; audience: string; organizer: string | null; link: string | null; sample: number; created_at: string; updated_at: string;
};
export type PlaceRef = { id: string; name: string; coordinates: Position; category: string };

/** now: under way · today: later today · soon: next 7 days · later. Campus time zone. */
export function eventState(e: Pick<EventRow, 'starts_at' | 'ends_at'>, now = new Date(), tz = 'Africa/Casablanca') {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const s = new Date(e.starts_at), end = new Date(e.ends_at);
  if (end <= now) return 'past' as const;
  if (s <= now) return 'now' as const;
  if (day(s) === day(now)) return 'today' as const;
  if (s.getTime() - now.getTime() < 7 * 86400000) return 'soon' as const;
  return 'later' as const;
}

export class Events {
  constructor(private db: Sql) {}

  list(opts: { from?: Date; days?: number; includePast?: boolean } = {}) {
    const now = opts.from ?? new Date();
    const until = new Date(now.getTime() + (opts.days ?? 30) * 86400000).toISOString();
    const rows = opts.includePast
      ? this.db.prepare('SELECT * FROM events WHERE ends_at >= ? ORDER BY starts_at').all(new Date(now.getTime() - 30 * 86400000).toISOString())
      : this.db.prepare('SELECT * FROM events WHERE ends_at >= ? AND starts_at <= ? ORDER BY starts_at').all(now.toISOString(), until);
    return rows as EventRow[];
  }
  row(id: string) { return this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined; }

  view(e: EventRow, places: Map<string, PlaceRef>, now = new Date()) {
    const place = e.place_id ? places.get(e.place_id) ?? null : null;
    return {
      id: e.id, title: e.title, description: e.description, kind: e.kind, audience: e.audience, organizer: e.organizer, link: e.link,
      starts_at: e.starts_at, ends_at: e.ends_at, state: eventState(e, now), sample: !!e.sample,
      place: place ? { id: place.id, name: place.name, coordinates: place.coordinates } : null, location_text: e.location_text,
    };
  }

  save(id: string | null, b: Partial<EventRow>, now = new Date().toISOString()) {
    const existing = id ? this.row(id) : undefined;
    const row = { ...existing, ...b } as EventRow;
    if (!row.title?.trim()) throw new Error('title is required');
    if (!row.starts_at || !row.ends_at || Number.isNaN(Date.parse(row.starts_at)) || Number.isNaN(Date.parse(row.ends_at))) throw new Error('starts_at and ends_at must be ISO dates');
    if (row.ends_at <= row.starts_at) throw new Error('an event must end after it starts');
    if (!EVENT_KINDS.includes(row.kind as never)) row.kind = 'other';
    if (!AUDIENCES.includes(row.audience as never)) row.audience = 'all';
    const newId = id ?? `${row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}-${randomUUID().slice(0, 4)}`;
    this.db.prepare(`INSERT INTO events (id,title,description,kind,place_id,location_text,starts_at,ends_at,audience,organizer,link,sample,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, kind=excluded.kind, place_id=excluded.place_id,
      location_text=excluded.location_text, starts_at=excluded.starts_at, ends_at=excluded.ends_at, audience=excluded.audience,
      organizer=excluded.organizer, link=excluded.link, sample=0, updated_at=excluded.updated_at`)
      .run(newId, row.title.trim(), row.description ?? null, row.kind, row.place_id ?? null, row.location_text ?? null, row.starts_at, row.ends_at,
        row.audience, row.organizer ?? null, row.link ?? null, 0, existing?.created_at ?? now, now);
    return newId;
  }

  delete(id: string) { return this.db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0; }

  /**
   * A first run gets three clearly-labelled sample events so the map, the visitor card and the
   * assistant have something to show. Once the admin deletes them they never come back.
   */
  seedSamples(now = new Date()) {
    if (meta.get(this.db, 'events_seeded')) return;
    const at = (days: number, h: number, m = 0) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(h - 1, m, 0, 0); return d.toISOString(); }; // campus = UTC+1
    const samples: Omit<EventRow, 'id' | 'created_at' | 'updated_at' | 'sample'>[] = [
      { title: 'Open campus talk', description: 'Sample event: replace it with a real one in Admin → Events.', kind: 'talk', place_id: 'building-17', location_text: 'Main Auditorium', starts_at: at(0, 18), ends_at: at(0, 19, 30), audience: 'all', organizer: 'Student Activities', link: null },
      { title: 'Inter-school football match', description: 'Sample event.', kind: 'sport', place_id: 'fitness-centre', location_text: 'Sports complex', starts_at: at(1, 16), ends_at: at(1, 18), audience: 'all', organizer: 'Athletics', link: null },
      { title: 'Club fair', description: 'Sample event: meet the student clubs.', kind: 'club', place_id: 'student-center', location_text: 'Student Center', starts_at: at(3, 11), ends_at: at(3, 15), audience: 'students', organizer: 'Student Activities', link: null },
    ];
    const ins = this.db.prepare(`INSERT OR IGNORE INTO events (id,title,description,kind,place_id,location_text,starts_at,ends_at,audience,organizer,link,sample,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
    samples.forEach((s, i) => ins.run(`sample-${i + 1}`, s.title, s.description, s.kind, s.place_id, s.location_text, s.starts_at, s.ends_at, s.audience, s.organizer, s.link, now.toISOString(), now.toISOString()));
    meta.set(this.db, 'events_seeded', now.toISOString());
  }
}
