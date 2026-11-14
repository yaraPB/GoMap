import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureCollection } from 'geojson';
import { DATA_DIR } from '../config.js';
import { Place, Walkway } from '../db/mongo.js';
import type { Sql } from '../db/sqlite.js';
import { fromMockFiles } from '../geo/sources.js';
import type { BuildingFeature, PoiFeature, WayFeature } from '../geo/types.js';
import { placesFromPois } from './places.js';
import { peopleFromDirectory } from './people.js';
import { procedureSeeds } from './procedures.js';

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/**
 * Seed order for the network:
 *   1. data/campus/walkways.geojson  (npm run geo:import, from Mapbox or OSM)
 *   2. data/walking_paths.geojson + data/driving_roads.geojson  (hand-drawn mock)
 */
export function loadGeo(dataDir = DATA_DIR): { walkways: WayFeature[]; pois: PoiFeature[]; buildings: BuildingFeature[]; source: string } {
  const campus = join(dataDir, 'campus');
  const pois = existsSync(join(campus, 'pois.geojson')) ? readJson<FeatureCollection>(join(campus, 'pois.geojson')).features as PoiFeature[] : [];
  const buildings = existsSync(join(campus, 'buildings.geojson')) ? readJson<FeatureCollection>(join(campus, 'buildings.geojson')).features as BuildingFeature[] : [];
  if (existsSync(join(campus, 'walkways.geojson'))) {
    const fc = readJson<FeatureCollection & { attribution?: string }>(join(campus, 'walkways.geojson'));
    return { walkways: fc.features as WayFeature[], pois, buildings, source: fc.attribution ?? 'imported' };
  }
  const walking = join(dataDir, 'walking_paths.geojson'), driving = join(dataDir, 'driving_roads.geojson');
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const walkways = fromMockFiles(existsSync(walking) ? readJson(walking) : empty, existsSync(driving) ? readJson(driving) : empty);
  return { walkways, pois, buildings, source: 'mock files in data/' };
}

export async function seedMongo(now: string, dataDir = DATA_DIR) {
  const geo = loadGeo(dataDir);
  if (await Walkway.estimatedDocumentCount() === 0 && geo.walkways.length) {
    await Walkway.insertMany(geo.walkways.map(w => ({ _id: w.properties.id, ...w.properties, id: undefined, geometry: w.geometry })));
  }
  if (await Place.estimatedDocumentCount() === 0) {
    const places = placesFromPois(geo.pois, geo.buildings);
    await Place.insertMany(places.map(p => ({ ...p, verified_at: null, created_at: now, updated_at: now })));
  }
  return geo.source;
}

export function seedSqlite(db: Sql, now: string, dataDir = DATA_DIR) {
  const hasPeople = (db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n > 0;
  if (!hasPeople) {
    const dir = readJson<Parameters<typeof peopleFromDirectory>[0]>(join(dataDir, 'aui_departments_faculty.json'));
    const insert = db.prepare(`INSERT INTO people (id,name,title,department,email,phone,profile_url,role,place_id,office_number,floor,
      office_hours,hours_raw,conflict,verified_at,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const procs = db.prepare(`INSERT INTO procedures (id,title,summary,owner_office,place_id,contact_email,steps,match_phrases,source,status,verified_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      for (const p of peopleFromDirectory(dir, now)) {
        insert.run(p.id, p.name, p.title, p.department, p.email, p.phone, p.profile_url, p.role, p.place_id, p.office_number, p.floor,
          p.office_hours, p.hours_raw, p.conflict, p.verified_at, p.source, now, now);
      }
      for (const p of procedureSeeds(dir.retrieved_on)) {
        procs.run(p.id, p.title, p.summary, p.owner_office, p.place_id, p.contact_email, JSON.stringify(p.steps), JSON.stringify(p.match_phrases),
          p.source, p.status, p.verified_at, now);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
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
