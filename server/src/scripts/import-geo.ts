/**
 * npm run geo:import            → Mapbox (needs MAPBOX_TOKEN, or reads mobile/.env.local)
 * npm run geo:import -- --osm   → OpenStreetMap via Overpass (no token, open licence)
 *
 * Writes data/campus/{walkways,pois,buildings}.geojson. Those files are committed so the
 * server seeds from them without any token. Re-run whenever the campus data improves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromMapbox, fromOsm } from '../geo/sources.js';
import { DATA_DIR, loadEnv, mapboxToken } from '../config.js';
import { buildGraph, graphReport } from '../routing/graph.js';

loadEnv();
const useOsm = process.argv.includes('--osm');
const bundle = useOsm ? await fromOsm() : await fromMapbox(mapboxToken() ?? (() => {
  throw new Error('No Mapbox token. Set MAPBOX_TOKEN in server/.env (or EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env.local), or run with --osm.');
})());

const out = join(DATA_DIR, 'campus');
mkdirSync(out, { recursive: true });
const source = useOsm ? '© OpenStreetMap contributors (ODbL)' : '© Mapbox © OpenStreetMap contributors';
const write = (name: string, features: unknown[]) => {
  writeFileSync(join(out, `${name}.geojson`), JSON.stringify({ type: 'FeatureCollection', attribution: source, generated_at: new Date().toISOString(), features }, null, 1) + '\n');
};
write('walkways', bundle.walkways);
write('pois', bundle.pois);
write('buildings', bundle.buildings);

const kinds: Record<string, number> = {};
for (const w of bundle.walkways) kinds[`${w.properties.kind}/${w.properties.modes}`] = (kinds[`${w.properties.kind}/${w.properties.modes}`] ?? 0) + 1;
console.log(`Imported from ${useOsm ? 'OpenStreetMap' : 'Mapbox'} → data/campus/`);
console.log(`  ${bundle.walkways.length} lines`, kinds);
console.log(`  ${bundle.pois.length} labels, ${bundle.buildings.length} building footprints`);
console.log(graphReport(buildGraph(bundle.walkways)));
