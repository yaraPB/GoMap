/**
 * Mapbox labels → GoMap places. Building numbers and positions are real (from the map data);
 * categories, names beyond the label, and hours are our best reading and stay unverified
 * (verified_at = null) until an admin confirms them.
 */
import * as turf from '@turf/turf';
import type { Position } from 'geojson';
import type { BuildingFeature, PoiFeature } from '../geo/types.js';

export type PlaceSeed = {
  _id: string; name: string; number: string | null; category: string; schools: string[]; aliases: string[];
  description: string | null; location: { type: 'Point'; coordinates: Position };
  hours: Record<string, [string, string][]> | null; position_estimated: boolean; source: string;
};

type Rule = { id?: string; number?: string; name: string; category: string; aliases?: string[]; description?: string; schools?: string[]; hours?: PlaceSeed['hours'] };

// Assumptions for the demo, pending confirmation by campus staff. Break is noon–2 PM.
const WEEKDAY_OFFICE: PlaceSeed['hours'] = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, [['09:00', '12:00'], ['14:00', '17:00']]]).concat([['sat', []], ['sun', []]]));

/** What each AUI building number holds, from the faculty directory and the design brief. */
const BUILDINGS: Record<string, Rule> = {
  '1': { name: 'Building 1', category: 'admin', description: 'Administration.' },
  '2': { name: 'Building 2', category: 'admin', aliases: ["registrar", "registrar's office"], description: "Registrar's Office (from the design brief, not verified).", hours: WEEKDAY_OFFICE },
  '3': { name: 'Building 3', category: 'services', aliases: ['student services'] },
  '4': { name: 'Building 4', category: 'academic', schools: ['shss', 'lc'] },
  '5': { name: 'Building 5', category: 'academic', schools: ['sse', 'lc'], aliases: ['sse', 'school of science and engineering', 'science and engineering dean'], description: "School of Science and Engineering: Dean's office and student affairs." },
  '6': { name: 'Building 6', category: 'academic', schools: ['sse', 'shss', 'lc', 'sba'], description: 'Classrooms, faculty offices, biology and chemistry lab.' },
  '7': { name: 'Building 7', category: 'academic', schools: ['sse', 'shss'], description: 'Faculty offices, physics and engineering lab.' },
  '8': { name: 'Building 8', category: 'academic', schools: ['shss', 'lc'], aliases: ['ssah', 'shss', 'language center', 'humanities'], description: "School of Social Sciences, Arts and Humanities (Dean's office, Office 1) and the Language Center." },
  '8b': { name: 'Building 8B', category: 'academic', schools: ['sba', 'sse', 'shss', 'lc'] },
  '9': { name: 'Building 9', category: 'academic', schools: ['sse', 'lc'], description: 'Faculty offices and the food control lab.' },
  '10': { name: 'Building 10', category: 'academic', schools: ['sba', 'shss'] },
  '11': { name: 'Building 11', category: 'academic', schools: ['sba'], aliases: ['sba', 'school of business', 'business school', 'school of business administration'], description: 'School of Business Administration: school office, faculty offices.' },
  '15': { name: 'Mohammed VI Library', category: 'services', aliases: ['library', 'building 15', 'bibliotheque', 'm6 library', 'المكتبة', 'مكتبة', 'la bibliotheque'], description: 'University library and research guides.' },
  '17': { name: 'Main Auditorium', category: 'services', aliases: ['building 17', 'auditorium', 'amphitheatre'] },
};

const NAMED: Record<string, Rule> = {
  'main auditorium': { id: 'building-17', number: '17', ...BUILDINGS['17'] },
  'student center': { name: 'Student Center', category: 'services' },
  'ground and maintenance': { name: 'Grounds and Maintenance', category: 'facilities', aliases: ['maintenance', 'facilities management'] },
  'cafeteria newrest': { name: 'Cafeteria Newrest', category: 'dining', aliases: ['cafeteria', 'main cafeteria', 'newrest', 'lunch', 'eat', 'food', 'breakfast', 'المطعم', 'مطعم', 'كافيتيريا', 'manger', 'cantine'] },
  'restaurants': { name: 'Restaurants', category: 'dining', aliases: ['restaurant', 'restaurants', 'food court', 'dinner'] },
  'aui shop': { name: 'AUI Shop', category: 'services', aliases: ['shop', 'convenience store'] },
  'book store': { name: 'Book Store', category: 'services', aliases: ['bookstore', 'books'] },
  'business office': { name: 'Business Office', category: 'admin', aliases: ['fees', 'payments', 'tuition'] },
  'enrollment services': { name: 'Enrollment Services', category: 'admin', aliases: ['admissions', 'enrollment'] },
  'its': { name: 'ITS', category: 'services', aliases: ['it', 'it support', 'information technology services', 'it desk'] },
  'security office': { name: 'Security Office', category: 'services', aliases: ['security', 'lost and found', 'campus police', 'الأمن', 'securite'] },
  'therapist office': { name: 'Therapist Office', category: 'services', aliases: ['counseling', 'counselling', 'therapist', 'wellbeing'] },
  'old game room': { name: 'Old Game Room', category: 'athletics', aliases: ['game room'] },
  'masjid al akhawayn': { name: 'Masjid Al Akhawayn', category: 'services', aliases: ['mosque', 'masjid', 'prayer', 'pray', 'prayer room', 'المسجد', 'مسجد', 'mosquee'] },
  'aui post office': { name: 'AUI Post Office', category: 'services', aliases: ['post office', 'mail'] },
};
const SKIP = /parc d'ifrane|hotel michliffen|^al akhawayn university/i;

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function placesFromPois(pois: PoiFeature[], buildings: BuildingFeature[]) {
  const places = new Map<string, PlaceSeed & { footprint: BuildingFeature['geometry'] | null; height: number | null }>();
  const footprintAt = (c: Position) => buildings.find(b => turf.booleanPointInPolygon(c, b));
  const add = (id: string, rule: Rule, c: Position, number: string | null) => {
    if (places.has(id)) return;
    const fp = footprintAt(c);
    places.set(id, {
      _id: id, name: rule.name, number, category: rule.category, schools: rule.schools ?? [],
      aliases: [...new Set([...(rule.aliases ?? []), ...(number ? [`building ${number}`, `b${number}`, number] : [])])],
      description: rule.description ?? null, location: { type: 'Point', coordinates: c },
      hours: rule.hours ?? (['services', 'admin'].includes(rule.category) ? WEEKDAY_OFFICE : null), position_estimated: false, source: 'mapbox',
      footprint: fp?.geometry ?? null, height: fp?.properties.height ?? null,
    });
  };
  const counters: Record<string, number> = {};
  const nth = (key: string) => (counters[key] = (counters[key] ?? 0) + 1);

  for (const poi of pois) {
    const { name, poi_class, maki } = poi.properties;
    const c = poi.geometry.coordinates;
    if (SKIP.test(name)) continue;
    const num = name.match(/^(\d+[a-z]?)\b/i)?.[1]?.toLowerCase();
    if (num) {
      const n = Number.parseInt(num, 10);
      const rule = BUILDINGS[num] ?? (n >= 18 && n <= 39
        ? { name: `Building ${num.toUpperCase()}`, category: 'residential', aliases: ['residence', 'dorm', 'housing'], description: 'Residence hall (category inferred from location, not verified).' }
        : { name: `Building ${num.toUpperCase()}`, category: 'academic' });
      let id = `building-${num}`;
      // two labels both read "29": keep both, flag the second for checking
      if (places.has(id) && haversine(places.get(id)!.location.coordinates, c) > 40) {
        id = `${id}-east`;
        add(id, { ...rule, description: 'A second map label also reads 29. Needs checking on site.' }, c, num.toUpperCase());
        continue;
      }
      add(id, rule, c, num.toUpperCase());
      continue;
    }
    const named = NAMED[name.toLowerCase()];
    if (named) { add(named.id ?? slug(named.name), named, c, named.number ?? null); continue; }
    if (poi_class === 'motorist' || maki === 'parking') {
      const letter = String.fromCharCode(64 + nth('parking'));
      add(`car-park-${letter.toLowerCase()}`, { name: `Car park ${letter}`, category: 'facilities', aliases: ['parking', 'car park', 'park my car', 'موقف السيارات', 'stationnement'] }, c, null);
      continue;
    }
    if (maki === 'tennis') {
      // neighbouring courts are one place
      const near = [...places.values()].find(p => p.name.startsWith('Tennis courts') && haversine(p.location.coordinates, c) < 120);
      if (near) continue;
      const k = nth('tennis');
      add(`tennis-courts-${k}`, { name: k === 1 ? 'Tennis courts' : `Tennis courts ${k}`, category: 'athletics', aliases: ['tennis'] }, c, null);
      continue;
    }
    if (maki === 'fitness-centre') { add('fitness-centre', { name: 'Fitness centre', category: 'athletics', aliases: ['gym', 'fitness', 'sports hall', 'salle de sport', 'صالة الرياضة'] }, c, null); continue; }
    if (name) add(slug(name), { name, category: 'services' }, c, null);
  }

  // The faculty directory puts many offices in Building 16 (New Academic Building), but the map
  // has no label for it. Placed by estimate west of 8B; the admin must move the pin.
  if (!places.has('building-16')) {
    places.set('building-16', {
      _id: 'building-16', name: 'Building 16 · New Academic Building', number: '16', category: 'academic',
      schools: ['sba', 'sse', 'shss'], aliases: ['nab', 'new academic building', 'building 16', 'b16', '16'],
      description: 'New Academic Building. Position estimated: not labelled in the map data.',
      location: { type: 'Point', coordinates: [-5.10905, 33.53795] }, hours: null, position_estimated: true, source: 'mock',
      footprint: null, height: null,
    });
  }
  return [...places.values()];
}

function haversine(a: Position, b: Position) {
  const r = Math.PI / 180;
  const s = Math.sin((b[1] - a[1]) * r / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
