/**
 * The real directory (data/aui_departments_faculty.json) → people rows.
 * Gaps stay gaps on purpose: no office, no email, no hours are shown as such in the app,
 * and the admin conflict screen is fed by sources that disagree (e.g. Chetioui 109 vs 108).
 */
import { parseHours } from '../lib/hours.js';

type FacultyJson = { name: string; title: string | null; office: string | null; building: string | null; office_hours: string | null; phone: string | null; email: string | null; profile_url: string | null };
type StaffJson = { name: string; role: string; office: string | null; hours: string | null; phone: string | null; email: string | null };
type Directory = { retrieved_on: string; departments: { id: string; faculty: FacultyJson[]; staff_contacts?: StaffJson[] }[] };

export type PersonSeed = {
  id: string; name: string; title: string | null; department: string; email: string | null; phone: string | null;
  profile_url: string | null; role: 'faculty' | 'staff'; place_id: string | null; office_number: string | null;
  floor: number | null; office_hours: string | null; hours_raw: string | null; conflict: string | null; verified_at: string | null;
  source: string;
};

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 'Building 16 (NAB), Office 146' → { place_id: 'building-16', office: '146', floor: 1 } */
export function parseOffice(office: string | null): { place_id: string | null; office_number: string | null; floor: number | null } {
  if (!office) return { place_id: null, office_number: null, floor: null };
  if (/mohammed vi library/i.test(office)) return { place_id: 'building-15', office_number: office.split(',')[1]?.trim() ?? null, floor: null };
  const m = office.match(/Building\s+(\d+[A-Za-z]?)\b[^,]*(?:,\s*(?:Office|Room|Lab)\s+([0-9A-Za-z]+))?/i);
  if (!m) return { place_id: null, office_number: null, floor: null };
  const number = m[2] ?? null;
  // AUI numbering: 1xx → first floor, 2xx → second, 0xx and 1–2 digit rooms → ground
  const floor = number && /^\d+$/.test(number) ? (number.length === 3 && number[0] !== '0' ? Number(number[0]) : 0) : null;
  return { place_id: `building-${m[1].toLowerCase()}`, office_number: number, floor };
}

export function peopleFromDirectory(dir: Directory, now: string): PersonSeed[] {
  const people = new Map<string, PersonSeed>();
  for (const dep of dir.departments) {
    for (const f of dep.faculty) {
      const o = parseOffice(f.office);
      const h = parseHours(f.office_hours);
      const id = slug(f.name);
      if (people.has(id)) continue;
      people.set(id, {
        id, name: f.name, title: f.title, department: dep.id, email: f.email, phone: f.phone, profile_url: f.profile_url,
        role: 'faculty', ...o, office_hours: h.hours ? JSON.stringify(h.hours) : null, hours_raw: f.office_hours,
        conflict: null, verified_at: f.office || f.email ? dir.retrieved_on : null, source: 'aui.ma faculty directory',
      });
    }
    for (const s of dep.staff_contacts ?? []) {
      const id = slug(s.name);
      const o = parseOffice(s.office);
      const existing = people.get(id);
      if (existing) {
        // same person in two sources: keep the directory value, record the disagreement
        if (s.office && existing.office_number && o.office_number !== existing.office_number) {
          existing.conflict = JSON.stringify({ field: 'office_number', values: [
            { value: existing.office_number, place_id: existing.place_id, source: 'Faculty directory' },
            { value: o.office_number, place_id: o.place_id, source: `${dep.id} staff contacts` },
          ] });
        }
        existing.title ??= s.role;
        existing.email ??= s.email;
        continue;
      }
      const h = parseHours(s.hours?.replace(' / ', ', ') ?? null);
      people.set(id, {
        id, name: s.name, title: s.role, department: dep.id, email: s.email, phone: s.phone, profile_url: null,
        role: 'staff', ...o, office_hours: h.hours ? JSON.stringify(h.hours) : null, hours_raw: s.hours,
        conflict: null, verified_at: dir.retrieved_on, source: `${dep.id} staff contacts`,
      });
    }
  }
  void now;
  return [...people.values()];
}
