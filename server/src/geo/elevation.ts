/**
 * Ground height across campus, for slopes. AUI spans ~1,580 m to ~1,690 m: a 110 m climb from the
 * lowest residences to the top of campus, so "step-free" has to mean "no stairs AND no steep hills".
 *
 * Source: Mapbox Terrain v2 vector tiles, layer `contour` (10 m contour lines, `ele` in metres).
 * They are imported once (`npm run geo:terrain`) into data/campus/contours.geojson, like the paths.
 *
 * A height between two contour lines is interpolated linearly by distance: a point 30 m above the
 * 1,620 m line and 10 m below the 1,630 m line sits at ~1,627.5 m. It is an ESTIMATE of the ground,
 * good to a couple of metres; a path cut into a hillside or a built ramp can be gentler than the
 * ground around it. The app says "about" and never refuses a path on slope alone.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import { CAMPUS_BBOX, CAMPUS_CENTER } from './types.js';

export type Elevation = (c: Position) => number | null;
/** The area at or above `ele` metres, cut to one map tile (`tile`: its [w, s, e, n]). */
export type ContourFeature = Feature<Polygon, { ele: number; tile: [number, number, number, number] }>;

// ── import ──────────────────────────────────────────────────────────────────

const lon2x = (lon: number, z: number) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};
const x2lon = (x: number, z: number) => x / 2 ** z * 360 - 180;
const y2lat = (y: number, z: number) => {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** A ring split into the runs that are real contour line (segments lying along the tile border are not). */
function offTheEdge(line: Position[], [w, s, e, n]: [number, number, number, number]): Position[][] {
  const eps = 2e-6; // ~0.2 m: stored coordinates are rounded to 6 decimals
  const onSameEdge = (a: Position, b: Position) => (Math.abs(a[0] - w) < eps && Math.abs(b[0] - w) < eps) || (Math.abs(a[0] - e) < eps && Math.abs(b[0] - e) < eps)
    || (Math.abs(a[1] - s) < eps && Math.abs(b[1] - s) < eps) || (Math.abs(a[1] - n) < eps && Math.abs(b[1] - n) < eps);
  const runs: Position[][] = [];
  let run: Position[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    if (onSameEdge(line[i], line[i + 1])) { if (run.length >= 2) runs.push(run); run = []; continue; }
    if (!run.length) run.push(line[i]);
    run.push(line[i + 1]);
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/** Every 10 m contour line over the campus box, cut to the tiles so nothing is stored twice. */
export async function contoursFromMapbox(token: string, fetchImpl: typeof fetch = fetch): Promise<ContourFeature[]> {
  const z = 15;
  const [w, s, e, n] = CAMPUS_BBOX;
  const out: ContourFeature[] = [];
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) {
    for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
      const url = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/${z}/${x}/${y}.mvt?access_token=${encodeURIComponent(token)}`;
      const response = await fetchImpl(url);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`Mapbox terrain tile ${z}/${x}/${y} failed (${response.status}). Check MAPBOX_TOKEN.`);
      const tile = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
      const layer = tile.layers.contour;
      const box: [number, number, number, number] = [x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)];
      for (let i = 0; layer && i < layer.length; i++) {
        const f = layer.feature(i);
        const ele = Number((f.properties as Record<string, unknown>).ele);
        if (!Number.isFinite(ele)) continue;
        // Terrain v2 stores each level as the AREA at or above it, cut to the tile: kept as is,
        // because "which areas contain this point" is what tells its 10 m band without guessing.
        const g = f.toGeoJSON(x, y, z) as Feature<Polygon | MultiPolygon>;
        if (g.geometry.type !== 'Polygon' && g.geometry.type !== 'MultiPolygon') continue;
        const clipped = turf.bboxClip(g, box).geometry as Geometry;
        const polys = clipped.type === 'Polygon' ? [clipped.coordinates] : clipped.type === 'MultiPolygon' ? clipped.coordinates : [];
        for (const poly of polys) {
          const rings = poly.map(r => r.map(c => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))])).filter(r => r.length >= 4);
          if (!rings.length || turf.area(turf.polygon([rings[0]])) < 1) continue;
          out.push({ type: 'Feature', properties: { ele, tile: box }, geometry: { type: 'Polygon', coordinates: rings } });
        }
      }
    }
  }
  return out;
}

// ── lookup ──────────────────────────────────────────────────────────────────

type Seg = { ele: number; p: [number, number]; q: [number, number] };
type Area = { ele: number; box: [number, number, number, number]; rings: [number, number][][] };

/** Even-odd ray test over every ring, so holes count as outside. */
function inside(p: [number, number], rings: [number, number][][]) {
  let ins = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins;
    }
  return ins;
}

/**
 * Height at any point, or null when there is no terrain data (the file is optional: without it
 * every slope is unknown and routing ignores slope).
 *
 * The areas say which 10 m band a point is in (the highest level whose area contains it); the
 * distance to that band's lower line and to its upper line places it inside the band. So the
 * height is continuous everywhere: no jumps between two points a few metres apart.
 */
export function makeElevation(contours: FeatureCollection | ContourFeature[] | null | undefined, origin: Position = CAMPUS_CENTER): Elevation {
  const features = (Array.isArray(contours) ? contours : contours?.features ?? []) as Feature[];
  const kx = 111320 * Math.cos(origin[1] * Math.PI / 180), ky = 110540;
  const toXY = (c: Position): [number, number] => [(c[0] - origin[0]) * kx, (c[1] - origin[1]) * ky];
  const CELL = 40;
  const grid = new Map<string, Seg[]>();
  const areas: Area[] = [];
  const levels = new Set<number>();
  for (const f of features) {
    const props = (f.properties ?? {}) as { ele?: unknown; tile?: [number, number, number, number] };
    const ele = Number(props.ele);
    if (!Number.isFinite(ele) || f.geometry?.type !== 'Polygon') continue;
    levels.add(ele);
    const rings = (f.geometry as Polygon).coordinates.map(r => r.map(toXY));
    const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
    areas.push({ ele, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    // the area's outline is the contour line, except where it follows the tile border
    for (const ring of (f.geometry as Polygon).coordinates) {
      for (const run of props.tile ? offTheEdge(ring, props.tile) : [ring]) {
        const xy = run.map(toXY);
        for (let i = 0; i < xy.length - 1; i++) {
          const seg: Seg = { ele, p: xy[i], q: xy[i + 1] };
          for (let gx = Math.floor(Math.min(seg.p[0], seg.q[0]) / CELL); gx <= Math.floor(Math.max(seg.p[0], seg.q[0]) / CELL); gx++)
            for (let gy = Math.floor(Math.min(seg.p[1], seg.q[1]) / CELL); gy <= Math.floor(Math.max(seg.p[1], seg.q[1]) / CELL); gy++) {
              const k = `${gx}:${gy}`;
              const list = grid.get(k);
              if (list) list.push(seg); else grid.set(k, [seg]);
            }
        }
      }
    }
  }
  if (!areas.length) return () => null;
  const sorted = [...levels].sort((a, b) => a - b);
  // the contour interval (10 m for Mapbox Terrain): the smallest step between two levels
  const interval = sorted.slice(1).reduce((m, v, i) => Math.min(m, v - sorted[i]), Infinity);
  const step = Number.isFinite(interval) && interval > 0 ? interval : 10;

  /** Distance to the nearest line of this level, searching outwards; null past ~1 km. */
  const nearest = (r0: [number, number], ele: number) => {
    for (const radius of [60, 120, 240, 480, 960]) {
      let best = Infinity;
      for (let gx = Math.floor((r0[0] - radius) / CELL); gx <= Math.floor((r0[0] + radius) / CELL); gx++)
        for (let gy = Math.floor((r0[1] - radius) / CELL); gy <= Math.floor((r0[1] + radius) / CELL); gy++)
          for (const seg of grid.get(`${gx}:${gy}`) ?? []) {
            if (seg.ele !== ele) continue;
            const dx = seg.q[0] - seg.p[0], dy = seg.q[1] - seg.p[1];
            const len2 = dx * dx + dy * dy;
            const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((r0[0] - seg.p[0]) * dx + (r0[1] - seg.p[1]) * dy) / len2));
            best = Math.min(best, Math.hypot(seg.p[0] + t * dx - r0[0], seg.p[1] + t * dy - r0[1]));
          }
      if (best <= radius) return best;
    }
    return null;
  };

  return (c: Position) => {
    const p = toXY(c);
    let low = -Infinity;
    for (const a of areas) if (a.ele > low && p[0] >= a.box[0] && p[0] <= a.box[2] && p[1] >= a.box[1] && p[1] <= a.box[3] && inside(p, a.rings)) low = a.ele;
    if (low === -Infinity) low = sorted[0] - step; // below the lowest line
    const dLow = levels.has(low) ? nearest(p, low) : null;
    const dHigh = levels.has(low + step) ? nearest(p, low + step) : null;
    if (dLow != null && dHigh != null) return low + step * dLow / (dLow + dHigh);
    // a hilltop above the last line, or a hollow below the first: a few metres from the line, no more
    if (dLow != null) return low + step * 0.5 * Math.min(1, dLow / 100);
    if (dHigh != null) return low + step - step * 0.5 * Math.min(1, dHigh / 100);
    return null;
  };
}
