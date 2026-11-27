import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import { DATA_DIR } from '../config.js';
import { Place, Walkway } from '../db/mongo.js';
import { meta, type Sql } from '../db/sqlite.js';
import { fromMockFiles } from '../geo/sources.js';
import type { BuildingFeature, PoiFeature, WayFeature } from '../geo/types.js';
import { placesFromPois } from './places.js';
import { peopleFromDirectory } from './people.js';
import { procedureSeeds } from './procedures.js';
import { ACCOUNT_SEEDS, campusHours, issuesFromJson, servicesFromJson, type IssueJson, type ServiceJson, type WorkingHoursJson } from './services.js';

const SEED_VERSION = '2026-11-27b';
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/**
 * Seed order for the network:
 *   1. data/campus/walkways.geojson  (npm run geo:import, from Mapbox or OSM)
 *   2. data/walking_paths.geojson + data/driving_roads.geojson  (hand-drawn mock)
 */
/**
 * data/campus/traced.geojson: paths, roads and buildings the team traced from satellite imagery
 * where the map data has gaps. Paths join the routing network; footprints fill buildings the
 * map does not have (never replacing one it has).
 */
export function tracedGeo(dataDir = DATA_DIR): { ways: WayFeature[]; buildings: BuildingFeature[] } {
  const file = join(dataDir, 'campus', 'traced.geojson');
  if (!existsSync(file)) return { ways: [], buildings: [] };
  type P = { id: string; kind: string; highway: string | null; name: string | null; height: number | null };
  const fc = readJson<FeatureCollection>(file);
  const ways: WayFeature[] = [];
  const buildings: BuildingFeature[] = [];
  for (const f of fc.features) {
    const p = f.properties as P;
    if ((p.kind === 'path' || p.kind === 'road') && f.geometry.type === 'LineString') {
      const road = p.kind === 'road';
      ways.push({ type: 'Feature', geometry: f.geometry, properties: { id: p.id, kind: road ? 'road' : p.highway === 'steps' ? 'stairs' : 'walkway', modes: road ? 'both' : 'walk',
        step_free: p.highway !== 'steps', lit: null, covered: null, name: p.name, road_class: road ? (p.highway ?? 'service') : null, source: 'trace' } });
    } else if (p.kind === 'building' && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
      buildings.push({ type: 'Feature', geometry: f.geometry, properties: { height: p.height, source: 'trace' } });
    }
  }
  return { ways, buildings };
}

/** Share of `a`'s area that `b` covers (0..1). */
function covered(a: BuildingFeature, b: BuildingFeature) {
  try {
    const x = turf.intersect(turf.featureCollection([a, b] as never));
    return x ? turf.area(x) / turf.area(a) : 0;
  } catch { return 0; }
}

/**
 * data/additional-buildings.geojson: footprints the team drew precisely (no properties needed).
 * They are the best shapes we have, so each one replaces the rough satellite traces it covers. One
 * the basemap already draws (80 %+ inside a mapped building) is left out: Mapbox extrudes that
 * building itself, and a second copy would flicker through it.
 */
export function surveyedBuildings(mapped: BuildingFeature[], dataDir = DATA_DIR): BuildingFeature[] {
  const file = join(dataDir, 'additional-buildings.geojson');
  if (!existsSync(file)) return [];
  return readJson<FeatureCollection>(file).features
    .filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
    .map(f => {
      const p = (f.properties ?? {}) as { height?: unknown; name?: unknown };
      return { type: 'Feature', geometry: f.geometry, properties: { height: Number(p.height) || 9, source: 'survey' } } as BuildingFeature;
    })
    .filter(s => !mapped.some(m => covered(s, m) >= 0.8));
}

/** 10 m contour lines (npm run geo:terrain), for path slopes. Optional: without them slopes are unknown. */
export function loadContours(dataDir = DATA_DIR): FeatureCollection | null {
  const file = join(dataDir, 'campus', 'contours.geojson');
  return existsSync(file) ? readJson<FeatureCollection>(file) : null;
}

export function loadGeo(dataDir = DATA_DIR): { walkways: WayFeature[]; pois: PoiFeature[]; buildings: BuildingFeature[]; source: string } {
  const campus = join(dataDir, 'campus');
  const pois = existsSync(join(campus, 'pois.geojson')) ? readJson<FeatureCollection>(join(campus, 'pois.geojson')).features as PoiFeature[] : [];
  const mapped = existsSync(join(campus, 'buildings.geojson')) ? readJson<FeatureCollection>(join(campus, 'buildings.geojson')).features as BuildingFeature[] : [];
  const traced = tracedGeo(dataDir);
  const surveyed = surveyedBuildings(mapped, dataDir);
  // a traced footprint only counts when its centre is not already inside a mapped building,
  // and when no surveyed footprint has redrawn it (mostly covers it)
  const buildings = [...mapped, ...surveyed, ...traced.buildings.filter(t => !mapped.some(m => turf.booleanPointInPolygon(turf.centroid(t), m))
    && !surveyed.some(s => covered(t, s) >= 0.5))];
  if (existsSync(join(campus, 'walkways.geojson'))) {
    const fc = readJson<FeatureCollection & { attribution?: string }>(join(campus, 'walkways.geojson'));
    return { walkways: [...fc.features as WayFeature[], ...traced.ways], pois, buildings, source: `${fc.attribution ?? 'imported'} + ${traced.ways.length} traced paths` };
  }
  const walking = join(dataDir, 'walking_paths.geojson'), driving = join(dataDir, 'driving_roads.geojson');
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const walkways = fromMockFiles(existsSync(walking) ? readJson(walking) : empty, existsSync(driving) ? readJson(driving) : empty);
  return { walkways: [...walkways, ...traced.ways], pois, buildings, source: 'mock files in data/' };
}

export async function seedMongo(now: string, dataDir = DATA_DIR) {
  const geo = loadGeo(dataDir);
  if (await Walkway.estimatedDocumentCount() === 0 && geo.walkways.length) {
    await Walkway.insertMany(geo.walkways.map(w => ({ _id: w.properties.id, ...w.properties, id: undefined, geometry: w.geometry })));
  } else {
    // a persistent database seeded before the traced paths existed: add the ones it lacks
    const traced = geo.walkways.filter(w => w.properties.source === 'trace');
    const have = new Set((await Walkway.find({ _id: { $in: traced.map(t => t.properties.id) } }, { _id: 1 }).lean()).map(d => String(d._id)));
    const missing = traced.filter(t => !have.has(t.properties.id));
    if (missing.length) await Walkway.insertMany(missing.map(w => ({ _id: w.properties.id, ...w.properties, id: undefined, geometry: w.geometry })));
  }
  const places = placesFromPois(geo.pois, geo.buildings);
  if (await Place.estimatedDocumentCount() === 0) {
    await Place.insertMany(places.map(p => ({ ...p, verified_at: null, created_at: now, updated_at: now })));
  } else {
    // Databases seeded before the offices list: the Registrar moved to Building 1, and the
    // office buildings get their aliases and hours. Admin-verified places are left alone.
    const corrected = ['building-1', 'building-2', 'building-3', 'building-4', 'building-7', 'building-9', 'building-10', 'building-14', 'building-26', 'building-38', 'building-39'];
    if (await Place.exists({ _id: 'building-2', aliases: 'registrar' })) {
      for (const p of places.filter(x => corrected.includes(x._id))) {
        const existing = await Place.findById(p._id).lean();
        if (!existing) await Place.insertMany([{ ...p, verified_at: null, created_at: now, updated_at: now }]);
        else if (!existing.verified_at) await Place.updateOne({ _id: p._id }, { $set: { name: p.name, category: p.category, aliases: p.aliases, description: p.description, hours: p.hours, updated_at: now } });
      }
    }
  }
  return geo.source;
}

type DirectoryJson = Omit<Parameters<typeof peopleFromDirectory>[0], 'departments'> & {
  working_hours?: WorkingHoursJson; offices_and_services?: ServiceJson[]; student_issue_routing?: IssueJson[];
  university?: { name?: string; phone?: string; email?: string; website?: string; academic_catalog?: string };
  departments: (Parameters<typeof peopleFromDirectory>[0]['departments'][number] & SchoolJson)[];
};
/** A school as the assistant describes it (find_department). */
export type SchoolJson = { id: string; name?: string; location?: { main_building?: string; notes?: string }; website?: string; description?: string; programs?: string[]; services?: string[];
  staff_contacts?: { name: string; role?: string; office?: string | null; hours?: string | null; phone?: string | null; email?: string | null }[] };

/**
 * SQLite from data/aui_departments_faculty.json. Runs at every boot: empty tables are filled, and
 * when the JSON file changes (new hash) its rows are re-imported, except rows the admin edited.
 */
export function seedSqlite(db: Sql, now: string, dataDir = DATA_DIR) {
  const file = join(dataDir, 'aui_departments_faculty.json');
  const raw = readFileSync(file, 'utf8');
  // bump SEED_VERSION when the seeding code changes (new keywords…): rows the admin never edited are refreshed
  const hash = createHash('sha1').update(raw).update(SEED_VERSION).digest('hex');
  const dir = JSON.parse(raw) as DirectoryJson;
  const changed = meta.get(db, 'directory_hash') !== hash;
  const campus = campusHours(dir.working_hours);
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  const person = db.prepare(`INSERT INTO people (id,name,title,department,email,phone,profile_url,role,place_id,office_number,floor,
      office_hours,hours_raw,conflict,verified_at,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, title=excluded.title, department=excluded.department, email=excluded.email, phone=excluded.phone,
      profile_url=excluded.profile_url, place_id=excluded.place_id, office_number=excluded.office_number, floor=excluded.floor,
      office_hours=excluded.office_hours, hours_raw=excluded.hours_raw, conflict=excluded.conflict, verified_at=excluded.verified_at,
      source=excluded.source, updated_at=excluded.updated_at WHERE people.admin_edited = 0`);
  // procedures the admin never touched are refreshed with the seed when the JSON changes
  const procCols = `INSERT INTO procedures (id,title,summary,owner_office,place_id,contact_email,steps,match_phrases,source,status,verified_at,updated_at,channel)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const proc = db.prepare(changed ? `${procCols}
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, owner_office=excluded.owner_office, place_id=excluded.place_id,
      contact_email=excluded.contact_email, steps=excluded.steps, match_phrases=excluded.match_phrases, source=excluded.source, status=excluded.status,
      verified_at=excluded.verified_at, updated_at=excluded.updated_at, channel=excluded.channel
      WHERE NOT EXISTS (SELECT 1 FROM change_log WHERE entity = 'procedure' AND entity_id = procedures.id)` : `${procCols} ON CONFLICT(id) DO NOTHING`);
  const service = db.prepare(`INSERT INTO services (id,name,short_name,category,handles,keywords,place_ids,location_text,room,email,extension,phone,hours,hours_raw,notes,sort,source,verified_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, category=excluded.category, handles=excluded.handles, keywords=excluded.keywords,
      place_ids=excluded.place_ids, location_text=excluded.location_text, room=excluded.room, email=excluded.email, extension=excluded.extension, phone=excluded.phone,
      hours=excluded.hours, hours_raw=excluded.hours_raw, notes=excluded.notes, sort=excluded.sort, source=excluded.source, verified_at=excluded.verified_at,
      updated_at=excluded.updated_at WHERE services.admin_edited = 0`);
  const issue = db.prepare(`INSERT INTO issue_routing (id,issue,go_to,service_id,location_text,place_id,notes,keywords,sort,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET issue=excluded.issue, go_to=excluded.go_to, service_id=excluded.service_id, location_text=excluded.location_text,
      place_id=excluded.place_id, notes=excluded.notes, keywords=excluded.keywords, sort=excluded.sort, updated_at=excluded.updated_at
      WHERE issue_routing.admin_edited = 0`);
  const account = db.prepare('INSERT OR IGNORE INTO accounts (id,name,role,person_id,description,sort) VALUES (?,?,?,?,?,?)');

  db.exec('BEGIN');
  try {
    if (changed || count('people') === 0) {
      for (const p of peopleFromDirectory(dir, now)) {
        person.run(p.id, p.name, p.title, p.department, p.email, p.phone, p.profile_url, p.role, p.place_id, p.office_number, p.floor,
          p.office_hours, p.hours_raw, p.conflict, p.verified_at, p.source, now, now);
      }
    }
    for (const p of procedureSeeds(dir.retrieved_on)) {
      proc.run(p.id, p.title, p.summary, p.owner_office, p.place_id, p.contact_email, JSON.stringify(p.steps), JSON.stringify(p.match_phrases),
        p.source, p.status, p.verified_at, now, p.channel ?? 'in_person');
    }
    // the Registrar is in Building 1 (offices list), not Building 2 as the design brief guessed
    db.prepare(`UPDATE procedures SET place_id = 'building-1', contact_email = 's.moujahid@aui.ma', owner_office = 'Registrar (Registration Office)',
      steps = replace(steps, 'Building 2', 'Building 1'), updated_at = ? WHERE id = 'declare-minor' AND place_id = 'building-2'`).run(now);
    if (changed || count('services') === 0) {
      const services = servicesFromJson(dir.offices_and_services ?? [], campus, dir.retrieved_on);
      for (const s of services) {
        service.run(s.id, s.name, s.short_name, s.category, JSON.stringify(s.handles), JSON.stringify(s.keywords), JSON.stringify(s.place_ids), s.location_text, s.room,
          s.email, s.extension, s.phone, s.hours ? JSON.stringify(s.hours) : null, s.hours_raw, s.notes, s.sort, s.source, dir.retrieved_on, now);
      }
      for (const r of issuesFromJson(dir.student_issue_routing ?? [], services)) {
        issue.run(r.id, r.issue, r.go_to, r.service_id, r.location_text, r.place_id, r.notes, JSON.stringify(r.keywords), r.sort, now);
      }
    }
    for (const a of ACCOUNT_SEEDS) account.run(a.id, a.name, a.role, a.person_id, a.description, a.sort);
    if (changed || !meta.get(db, 'campus_hours')) meta.set(db, 'campus_hours', JSON.stringify(campus));
    // schools and the university's own contacts, for "tell me about SSE" and "who do I ask"
    meta.set(db, 'schools', JSON.stringify(dir.departments.map(d => ({ id: d.id, name: d.name, location: d.location, website: d.website, description: d.description,
      programs: d.programs ?? [], services: d.services ?? [], staff_contacts: d.staff_contacts ?? [] }))));
    if (dir.university) meta.set(db, 'university', JSON.stringify(dir.university));
    meta.set(db, 'directory_hash', hash);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/**
 * Simulated crowding, same shape the real GPS-trace model will fill later: one load per
 * walkway per weekday hour. Busy near the academic core and dining, peaking at class changes
 * and lunch. Deterministic, so the demo looks the same every time.
 */
export function seedCrowding(db: Sql, walkways: { id: string; coords: number[][]; modes: string }[]) {
  if ((db.prepare('SELECT COUNT(*) AS n FROM crowding').get() as { n: number }).n > 0) return;
  const core: [number, number][] = [[-5.1066, 33.5388], [-5.1060, 33.5392], [-5.1078, 33.5386]]; // plaza, cafeteria, 8/8B/11
  const peaks: Record<number, number> = { 8: 0.55, 9: 0.5, 10: 0.85, 11: 0.6, 12: 1, 13: 0.9, 14: 0.55, 15: 0.6, 16: 0.8, 17: 0.55, 18: 0.4, 19: 0.3, 20: 0.2 };
  const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
  const insert = db.prepare('INSERT INTO crowding (edge_id, weekday, hour, load) VALUES (?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const w of walkways) {
      if (w.modes === 'drive') continue;
      const mid = w.coords[Math.floor(w.coords.length / 2)];
      const d = Math.min(...core.map(c => Math.hypot((mid[0] - c[0]) * 92700, (mid[1] - c[1]) * 110540)));
      const nearness = Math.max(0, 1 - d / 450);
      for (let weekday = 0; weekday < 7; weekday++) {
        const dayFactor = weekday >= 5 ? 0.25 : weekday === 4 ? 0.8 : 1;
        for (let hour = 8; hour <= 20; hour++) {
          const noise = 0.75 + hash(`${w.id}:${weekday}:${hour}`) * 0.5;
          insert.run(w.id, weekday, hour, Math.min(1, Number((nearness * peaks[hour] * dayFactor * noise).toFixed(3))));
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
