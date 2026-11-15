/**
 * data/aui_departments_faculty.json → services, issue routing, campus working hours.
 * The JSON is the source of truth until the admin edits a row (admin_edited = 1).
 */
import type { Hours } from '../lib/hours.js';

export type WorkingHoursJson = {
  standard_office_hours?: { open?: string; close?: string; lunch_break?: { start?: string; end?: string; note?: string } };
  weekend?: { working?: boolean; exceptions?: string[]; emergencies?: string };
  applies_to?: string;
};
export type ServiceJson = { name: string; handles?: string[]; location: string | null; email: string | null; extension: string | null; phone: string | null; hours: string | null };
export type IssueJson = { issue: string; go_to: string; location: string | null; notes?: string };

export type CampusHours = { open: string; close: string; lunch: [string, string]; weekend_working: boolean; emergencies: string | null; exceptions: string[] };

const pad = (t: string) => { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`; };

export function campusHours(w?: WorkingHoursJson): CampusHours {
  const s = w?.standard_office_hours;
  return {
    open: pad(s?.open ?? '09:00'), close: pad(s?.close ?? '17:30'),
    lunch: [pad(s?.lunch_break?.start ?? '13:00'), pad(s?.lunch_break?.end ?? '14:00')],
    weekend_working: w?.weekend?.working ?? false,
    emergencies: w?.weekend?.emergencies ?? null,
    exceptions: w?.weekend?.exceptions ?? [],
  };
}

/** Mon–Fri with the lunch break cut out; weekends explicitly closed. */
export function officeHours(c: Pick<CampusHours, 'open' | 'close' | 'lunch'>): Hours {
  const day: [string, string][] = c.lunch[0] > c.open && c.lunch[1] < c.close ? [[c.open, c.lunch[0]], [c.lunch[1], c.close]] : [[c.open, c.close]];
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] };
}

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Office hours text as written in the JSON → hours. Returns null hours with a note when it is not a timetable. */
export function serviceHours(raw: string | null, campus: CampusHours): { hours: Hours | null; note: string | null } {
  if (!raw) return { hours: null, note: null };
  if (/24\s*\/\s*7/.test(raw) && raw.length < 20) return { hours: Object.fromEntries(ALL_DAYS.map(d => [d, [['00:00', '23:59']]])) as Hours, note: 'Open 24/7' };
  if (/appointment/i.test(raw) && !/\d{1,2}:\d{2}/.test(raw)) return { hours: null, note: raw };
  if (/7 days a week/i.test(raw)) return { hours: null, note: raw };
  if (/advisor/i.test(raw)) return { hours: null, note: raw };
  // e.g. the Health Center, where two university pages disagree: keep the daily consultation hours, show the rest
  const daily = raw.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*daily/i);
  if (daily) return { hours: Object.fromEntries(ALL_DAYS.map(d => [d, [[pad(daily[1]), pad(daily[2])]]])) as Hours, note: raw };
  const main = raw.match(/(monday|mon)\s*[-–]\s*(friday|fri)\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/i);
  if (main) {
    const lunch = raw.match(/lunch[^0-9]*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/i);
    const hours = officeHours({ open: pad(main[3]), close: pad(main[4]), lunch: lunch ? [pad(lunch[1]), pad(lunch[2])] : campus.lunch });
    const extra = /closed saturday and sunday/i.test(raw) && raw.split(';').length <= 2 ? null : raw;
    return { hours, note: extra };
  }
  return { hours: null, note: raw };
}

/** Stable ids and words students actually use (EN/FR/AR/Darija). */
const KNOWN: { match: RegExp; id: string; short: string; category: string; keywords: string[] }[] = [
  { match: /^registrar/i, id: 'registrar', short: 'Registrar', category: 'academic', keywords: ['registrar', "registrar's office", 'registration office', 'transcript', 'add drop', 'add/drop', 'change major', 'change my major', 'grade appeal', 'enrollment certificate', 'attestation', 'attestation de scolarite', 'graduation application', 'apply to graduate', 'graduation declaration', 'declare graduation', 'withdraw from a course', 'catalog year', 'degree audit', 'scolarite', 'التسجيل'] },
  { match: /^business office/i, id: 'business-office', short: 'Business Office', category: 'money', keywords: ['business office', 'pay', 'payment', 'pay fees', 'fees', 'tuition', 'balance', 'owe', 'how much i owe', 'what i owe', 'outstanding balance', 'money i owe', 'financial hold', 'hold on my account', 'refund', 'cash wallet', 'top up my card', 'student card money', 'payment plan', 'frais', 'paiement', 'الدفع', 'الرسوم'] },
  { match: /^financial aid/i, id: 'financial-aid', short: 'Financial Aid', category: 'money', keywords: ['financial aid', 'scholarship', 'merit award', 'bourse', 'aid renewal', 'work study', 'student job', 'student employment', 'منحة'] },
  { match: /international programs/i, id: 'oip', short: 'OIP', category: 'academic', keywords: ['oip', 'international programs', 'exchange', 'study abroad', 'exchange semester', 'transfer credits', 'incoming transfer', 'echange', 'تبادل'] },
  { match: /^academic advising/i, id: 'academic-advising', short: 'Academic advising', category: 'academic', keywords: ['my advisor', 'academic advisor', 'degree plan', 'course approval'] },
  { match: /^admissions/i, id: 'admissions', short: 'Admissions', category: 'admin', keywords: ['admissions', 'apply to aui', 'admission', 'new student application'] },
  { match: /dean of students|student affairs/i, id: 'dsa', short: 'Student Affairs (DSA)', category: 'campus_life', keywords: ['dsa', 'dean of students', 'student affairs', 'vie etudiante'] },
  { match: /^housing/i, id: 'housing', short: 'Housing', category: 'campus_life', keywords: ['housing', 'dorm', 'my room', 'room change', 'change room', 'roommate', 'residence', 'dorm maintenance', 'broken in my room', 'logement', 'chambre', 'السكن'] },
  { match: /^dining/i, id: 'dining', short: 'Dining', category: 'campus_life', keywords: ['dining services', 'meal plan', 'meals', 'restaurant', 'eat on the weekend'] },
  { match: /^health center/i, id: 'health-center', short: 'Health Center', category: 'wellbeing', keywords: ['health center', 'infirmary', 'doctor', 'nurse', 'clinic', 'sick', 'i am sick', 'feel sick', 'injury', 'injured', 'medical certificate', 'certificat medical', 'malade', 'infirmerie', 'مريض', 'طبيب', 'مصحة'] },
  { match: /^counseling/i, id: 'counseling', short: 'Counseling', category: 'wellbeing', keywords: ['counseling', 'counselling', 'counselor', 'therapist', 'psychologist', 'stress', 'stressed', 'anxiety', 'anxious', 'depressed', 'mental health', 'talk to someone', 'psychologue', 'ضغط', 'قلق'] },
  { match: /ccso|community care/i, id: 'ccso', short: 'CCSO', category: 'wellbeing', keywords: ['ccso', 'harassment', 'report harassment', 'sexual misconduct', 'title ix', 'harcelement', 'تحرش'] },
  { match: /^security/i, id: 'security', short: 'Security', category: 'campus_life', keywords: ['security', 'emergency', 'lost and found', 'i lost', 'lost my', 'stolen', 'campus police', 'safety', 'urgence', 'objets trouves', 'الأمن', 'طوارئ'] },
  { match: /information technolog|\bITS\b/i, id: 'its', short: 'ITS', category: 'it', keywords: ['its', 'it support', 'it desk', 'wifi', 'wi-fi', 'password', 'reset my password', 'email account', 'canvas', 'portal', 'internet', 'internet not working', 'campus account', 'واي فاي', 'الانترنت', 'mot de passe'] },
  { match: /library/i, id: 'library', short: 'Library', category: 'academic', keywords: ['library services', 'borrow a book', 'research help', 'study room'] },
  { match: /learning excellence|\bCLE\b/i, id: 'cle', short: 'CLE', category: 'academic', keywords: ['cle', 'tutoring', 'tutor', 'academic support', 'soutien'] },
  { match: /^writing center/i, id: 'writing-center', short: 'Writing Center', category: 'academic', keywords: ['writing center', 'essay help', 'help with my essay', 'help writing', 'report writing'] },
  { match: /^language center/i, id: 'language-center', short: 'Language Center', category: 'academic', keywords: ['language center', 'placement test', 'language placement', 'english placement', 'french placement', 'arabic course'] },
  { match: /pathways|employability/i, id: 'pathways', short: 'Pathways', category: 'academic', keywords: ['pathways', 'career', 'careers', 'cv', 'resume', 'job', 'job search', 'internship search', 'find an internship', 'emploi', 'stage'] },
  { match: /student activities|\bSAO\b/i, id: 'sao', short: 'SAO', category: 'campus_life', keywords: ['sao', 'student activities', 'clubs', 'club', 'student club', 'join a club', 'start a club', 'start a new club', 'create a club', 'new club', 'student events', 'clubs et associations', 'créer un club', 'نادي'] },
  { match: /^athletics/i, id: 'athletics', short: 'Athletics', category: 'campus_life', keywords: ['athletics', 'sports team', 'join a team', 'sport'] },
  { match: /honors/i, id: 'honors', short: 'Honors Program', category: 'academic', keywords: ['honors', 'honors program', 'uhp'] },
  { match: /^bookstore/i, id: 'bookstore', short: 'Bookstore', category: 'campus_life', keywords: ['textbook', 'textbooks', 'buy books', 'course books', 'livres'] },
  { match: /^campus store/i, id: 'campus-store', short: 'Campus Store', category: 'campus_life', keywords: ['campus store', 'aui merch', 'hoodie', 'souvenir'] },
  { match: /vpaa|vice president for academic/i, id: 'vpaa', short: 'VPAA', category: 'admin', keywords: ['vpaa', 'vice president academic affairs', 'provost'] },
  { match: /deans/i, id: 'deans', short: "Deans' offices", category: 'academic', keywords: ["dean's office", 'dean office', 'see the dean', 'complaint not resolved', 'doyen'] },
];

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 'Building 38 & Building 39', 'Building 2 & 3 & 14', 'Library', 'SBA: Building 11; SSE: Building 5' → place ids, main desk first. */
export function placeIdsFrom(location: string | null): string[] {
  if (!location) return [];
  const ids: string[] = [];
  if (/\blibrary\b/i.test(location)) ids.push('building-15');
  for (const m of location.matchAll(/Building\s+(\d+[A-Za-z]?)((?:\s*&\s*\d+[A-Za-z]?)*)/gi)) {
    ids.push(`building-${m[1].toLowerCase()}`);
    for (const extra of m[2].matchAll(/(\d+[A-Za-z]?)/g)) ids.push(`building-${extra[1].toLowerCase()}`);
  }
  return [...new Set(ids)];
}

export type ServiceSeed = {
  id: string; name: string; short_name: string; category: string; handles: string[]; keywords: string[]; place_ids: string[];
  location_text: string | null; room: string | null; email: string | null; extension: string | null; phone: string | null;
  hours: Hours | null; hours_raw: string | null; notes: string | null; sort: number; source: string;
};
export type IssueSeed = { id: string; issue: string; go_to: string; service_id: string | null; location_text: string | null; place_id: string | null; notes: string | null; keywords: string[]; sort: number };

export function servicesFromJson(list: ServiceJson[], campus: CampusHours, retrievedOn: string): ServiceSeed[] {
  return list.map((s, i) => {
    const known = KNOWN.find(k => k.match.test(s.name));
    const h = serviceHours(s.hours, campus);
    const room = s.location?.match(/\b(?:Room|Office)\s+([0-9A-Za-z]+)/i)?.[1] ?? null;
    return {
      id: known?.id ?? slug(s.name), name: s.name, short_name: known?.short ?? s.name.replace(/\s*\(.*\)$/, ''),
      category: known?.category ?? 'service', handles: s.handles ?? [], keywords: known?.keywords ?? [],
      place_ids: placeIdsFrom(s.location), location_text: s.location, room, email: s.email, extension: s.extension, phone: s.phone,
      hours: h.hours, hours_raw: s.hours, notes: h.note, sort: i, source: `AUI offices and services list, retrieved ${retrievedOn}`,
    };
  });
}

export function issuesFromJson(list: IssueJson[], services: ServiceSeed[]): IssueSeed[] {
  return list.map((r, i) => {
    const service = services.find(s => s.name === r.go_to) ?? services.find(s => s.name.toLowerCase().startsWith(r.go_to.toLowerCase().slice(0, 12)))
      ?? (/advisor/i.test(r.go_to) ? services.find(s => s.id === 'academic-advising') : /dean/i.test(r.go_to) ? services.find(s => s.id === 'deans') : undefined);
    // the issue text itself, split on '/', ',' and '(' so each phrase is matchable
    const keywords = [...new Set(r.issue.split(/[\/,()]| or /i).map(k => k.trim().toLowerCase()).filter(k => k.length > 2))];
    return {
      id: `issue-${i + 1}-${slug(r.issue).slice(0, 40)}`, issue: r.issue, go_to: r.go_to, service_id: service?.id ?? null,
      location_text: r.location, place_id: placeIdsFrom(r.location)[0] ?? service?.place_ids[0] ?? null, notes: r.notes ?? null, keywords, sort: i,
    };
  });
}

/** Generic demo accounts for the role views. Faculty and staff point at real directory rows. */
export const ACCOUNT_SEEDS = [
  { id: 'demo-student', name: 'Student', role: 'student', person_id: null, description: 'Find classes, offices and services', sort: 0 },
  { id: 'harit-satt', name: 'Harit Satt', role: 'faculty', person_id: 'harit-satt', description: 'Post your status and office notes', sort: 1 },
  { id: 'demo-staff', name: 'Staff', role: 'staff', person_id: null, description: 'Office hours, lunch and service desks', sort: 2 },
  { id: 'guest', name: 'Visitor', role: 'guest', person_id: null, description: 'Explore the campus, no account needed', sort: 3 },
] as const;
