/**
 * npm run geo:terrain → data/campus/contours.geojson (10 m contour lines from Mapbox Terrain v2).
 *
 * Needs MAPBOX_TOKEN (or reads mobile/.env.local). The file is committed, so the server never
 * needs the token: it estimates the slope of every path from it at boot.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, loadEnv, mapboxToken } from '../config.js';
import { contoursFromMapbox, makeElevation } from '../geo/elevation.js';
import { CAMPUS_CENTER } from '../geo/types.js';

loadEnv();
const token = mapboxToken();
if (!token) throw new Error('No Mapbox token. Set MAPBOX_TOKEN in server/.env (or EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env.local).');
const contours = await contoursFromMapbox(token);
const out = join(DATA_DIR, 'campus');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'contours.geojson'), JSON.stringify({
  type: 'FeatureCollection', attribution: '© Mapbox (Terrain v2)', generated_at: new Date().toISOString(),
  note: 'Areas at or above each 10 m contour, per map tile. Used to estimate path slopes for step-free routes.', features: contours,
}) + '\n');
const levels = [...new Set(contours.map(c => c.properties.ele))].sort((a, b) => a - b);
console.log(`Imported ${contours.length} contour areas, ${levels[0]}–${levels.at(-1)} m → data/campus/contours.geojson`);
console.log(`  campus centre is at about ${makeElevation(contours)(CAMPUS_CENTER)?.toFixed(1)} m`);
