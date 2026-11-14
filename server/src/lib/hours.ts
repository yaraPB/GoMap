/**
 * One hours shape for places and people:
 *   { mon: [["09:00","11:00"], ["13:00","14:00"]], tue: [], wed: [...] }
 * A MISSING day key = not published for that day. An EMPTY array = explicitly closed.
 * `null` for the whole value = nothing published at all. These are different answers.
 */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = typeof DAYS[number];
export type Hours = Partial<Record<Day, [string, string][]>>;
export type ParsedHours = { hours: Hours | null; note: string | null; byAppointment: boolean };

const DAY_WORDS: Record<string, Day> = {
  monday: 'mon', mon: 'mon', tuesday: 'tue', tue: 'tue', tues: 'tue', wednesday: 'wed', wed: 'wed',
  thursday: 'thu', thu: 'thu', thurs: 'thu', friday: 'fri', fri: 'fri', saturday: 'sat', sat: 'sat', sunday: 'sun', sun: 'sun',
};
const pad = (t: string) => { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`; };

function daysIn(text: string): Day[] {
  const lower = text.toLowerCase();
  const range = lower.match(/\b([a-z]+)\s*[-–]\s*([a-z]+)\b/);
  if (range && DAY_WORDS[range[1]] && DAY_WORDS[range[2]]) {
    const a = DAYS.indexOf(DAY_WORDS[range[1]]), b = DAYS.indexOf(DAY_WORDS[range[2]]);
    return DAYS.slice(a, b + 1);
  }
  const out: Day[] = [];
  for (const word of lower.match(/[a-z]+/g) ?? []) {
    const d = DAY_WORDS[word];
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

export function parseHours(raw: string | null | undefined): ParsedHours {
  if (!raw || !raw.trim()) return { hours: null, note: null, byAppointment: false };
  const text = raw.trim();
  const byAppointment = /appointment/i.test(text);
  const notes: string[] = [];
  const hours: Hours = {};
  let anyTimes = false;
  for (const clauseRaw of text.split(';')) {
    const clause = clauseRaw.trim();
    if (!clause) continue;
    const times = [...clause.matchAll(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/g)].map(m => [pad(m[1]), pad(m[2])] as [string, string]);
    let days = daysIn(clause.replace(/(\d{1,2}:\d{2})/g, ''));
    if (!times.length) {
      if (/appointment|online|door|tba|tbc|communicated|none|not listed/i.test(clause)) notes.push(clause.replace(/^or\s+/i, ''));
      continue;
    }
    if (!days.length) days = ['mon', 'tue', 'wed', 'thu', 'fri']; // staff '8:30-17:30': working days
    anyTimes = true;
    for (const d of days) hours[d] = [...(hours[d] ?? []), ...times].sort((a, b) => a[0].localeCompare(b[0]));
    const extra = clause.match(/\(([^)]*)\)/);
    if (extra) notes.push(extra[1]);
  }
  return { hours: anyTimes ? hours : null, note: notes.length ? notes.join('; ') : (anyTimes ? null : text), byAppointment };
}

/** Local wall-clock parts in the campus timezone. */
export function campusNow(tz = 'Africa/Casablanca', now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = String(parts.weekday).toLowerCase().slice(0, 3) as Day;
  return { day, time: `${parts.hour}:${parts.minute}` };
}

export type OpenState =
  | { state: 'open'; until: string }
  | { state: 'closed'; next: { day: Day; time: string } | null }
  | { state: 'not_published' };

export function openState(hours: Hours | null | undefined, tz?: string, now = new Date()): OpenState {
  if (!hours || !Object.keys(hours).length) return { state: 'not_published' };
  const { day, time } = campusNow(tz, now);
  const today = hours[day];
  if (today === undefined && !DAYS.some(d => hours[d]?.length)) return { state: 'not_published' };
  for (const [a, b] of today ?? []) if (time >= a && time < b) return { state: 'open', until: b };
  const start = DAYS.indexOf(day);
  for (let i = 0; i < 7; i++) {
    const d = DAYS[(start + i) % 7];
    for (const [a] of hours[d] ?? []) if (i > 0 || a > time) return { state: 'closed', next: { day: d, time: a } };
  }
  return { state: 'closed', next: null };
}

const DAY_LABEL: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export function formatHours(hours: Hours | null | undefined): string | null {
  if (!hours) return null;
  return DAYS.filter(d => hours[d] !== undefined)
    .map(d => `${DAY_LABEL[d]} ${hours[d]!.length ? hours[d]!.map(([a, b]) => `${a}–${b}`).join(', ') : 'closed'}`).join(' · ');
}
