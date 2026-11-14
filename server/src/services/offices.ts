/**
 * Offices and student services, and the "where do I go for X" routing table.
 * Read by the public API, the assistant (local router + Gemini tools) and the admin.
 */
import { config } from '../config.js';
import { json, meta, type Sql } from '../db/sqlite.js';
import { formatHours, openState, type Hours } from '../lib/hours.js';
import { campusHours, type CampusHours } from '../seed/services.js';
import { isStale } from './directory.js';

export type ServiceRow = {
  id: string; name: string; short_name: string | null; category: string; handles: string; keywords: string; place_ids: string;
  location_text: string | null; room: string | null; email: string | null; extension: string | null; phone: string | null;
  hours: string | null; hours_raw: string | null; notes: string | null; sort: number; admin_edited: number;
  verified_at: string | null; source: string | null; updated_at: string;
};
export type IssueRow = {
  id: string; issue: string; go_to: string; service_id: string | null; location_text: string | null; place_id: string | null;
  notes: string | null; keywords: string; sort: number; admin_edited: number; updated_at: string;
};

export const SERVICE_CATEGORIES = ['academic', 'money', 'wellbeing', 'campus_life', 'it', 'admin', 'service'] as const;

export class Offices {
  constructor(private db: Sql) {}

  campus(): CampusHours { return json.parse<CampusHours>(meta.get(this.db, 'campus_hours'), campusHours()); }

  list() { return this.db.prepare('SELECT * FROM services ORDER BY sort, name').all() as ServiceRow[]; }
  row(id: string) { return this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined; }
  issues() { return this.db.prepare('SELECT * FROM issue_routing ORDER BY sort, issue').all() as IssueRow[]; }
  issue(id: string) { return this.db.prepare('SELECT * FROM issue_routing WHERE id = ?').get(id) as IssueRow | undefined; }

  view(r: ServiceRow, placeNames: Map<string, string>, now = new Date()) {
    const hours = json.parse<Hours | null>(r.hours, null);
    const placeIds = json.parse<string[]>(r.place_ids, []);
    return {
      id: r.id, name: r.name, short_name: r.short_name ?? r.name, category: r.category,
      handles: json.parse<string[]>(r.handles, []), keywords: json.parse<string[]>(r.keywords, []),
      places: placeIds.map(id => ({ id, name: placeNames.get(id) ?? id, known: placeNames.has(id) })),
      location_text: r.location_text, room: r.room, email: r.email, extension: r.extension, phone: r.phone,
      hours, hours_text: formatHours(hours), hours_raw: r.hours_raw, notes: r.notes, open: openState(hours, config.timezone, now),
      verified_at: r.verified_at, stale: isStale(r.verified_at, 12, now), source: r.source, admin_edited: !!r.admin_edited, updated_at: r.updated_at,
    };
  }

  issueView(r: IssueRow, placeNames: Map<string, string>) {
    return {
      id: r.id, issue: r.issue, go_to: r.go_to, service_id: r.service_id, location_text: r.location_text,
      place: r.place_id ? { id: r.place_id, name: placeNames.get(r.place_id) ?? r.place_id, known: placeNames.has(r.place_id) } : null,
      notes: r.notes, keywords: json.parse<string[]>(r.keywords, []), sort: r.sort, admin_edited: !!r.admin_edited, updated_at: r.updated_at,
    };
  }
}

/** Minutes covered by a weekly timetable. */
export function weeklyMinutes(hours: Hours | null) {
  if (!hours) return 0;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Object.values(hours).reduce((sum, ranges) => sum + (ranges ?? []).reduce((s, [a, b]) => s + Math.max(0, m(b) - m(a)), 0), 0);
}
