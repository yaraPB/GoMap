/**
 * Where the campus geometry comes from. Three sources, one output shape:
 *
 *  - mapbox: decodes Mapbox Streets v8 vector tiles over the campus. The `road` layer tells
 *            footpaths from roads (class=path/pedestrian vs street/service/…), `poi_label`
 *            carries the real building numbers, `building` carries footprints.
 *  - osm:    the same data straight from OpenStreetMap (Overpass API). Open licence (ODbL),
 *            use this one before any public release; Mapbox's terms limit storing tile data.
 *  - mock:   the hand-drawn files in data/ (walking_paths.geojson, driving_roads.geojson).
 *            They carry no properties, so the file a line comes from decides its kind.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, Position } from 'geojson';
import { CAMPUS_BBOX, type BuildingFeature, type PoiFeature, type WayFeature, type WayKind, type WayModes, type WayProps } from './types.js';

export type GeoBundle = { walkways: WayFeature[]; pois: PoiFeature[]; buildings: BuildingFeature[] };

// ── shared helpers ───────────────────────────────────────────────────────────

const round = (c: Position): Position => [Number(c[0].toFixed(7)), Number(c[1].toFixed(7))];

/** Split any (Multi)LineString into plain LineStrings with ≥2 distinct points. */
export function lineParts(geometry: Geometry): Position[][] {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  return lines.map(line => line.map(round)).filter(line => line.length >= 2 &&
    line.some(c => c[0] !== line[0][0] || c[1] !== line[0][1]));
}

function inCampus(geometry: Geometry) {
  const [w, s, e, n] = CAMPUS_BBOX;
  const coords = turf.coordAll(turf.feature(geometry));
  return coords.some(([x, y]) => x >= w && x <= e && y >= s && y <= n);
}

/** Road classes ranked so a walking route prefers paths over a dual carriageway. */
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street', 'street_limited',
  'service', 'track', 'residential', 'unclassified', 'living_street', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link']);

export function classifyMapbox(cls: string, type: string): { kind: WayKind; modes: WayModes } | null {
  if (cls === 'path' || cls === 'pedestrian') {
    if (type === 'steps') return { kind: 'stairs', modes: 'walk' };
    if (type === 'crossing') return { kind: 'crossing', modes: 'walk' };
    return { kind: 'walkway', modes: 'walk' };
  }
  const base = cls.replace(/_link$/, '');
  if (ROAD_CLASSES.has(cls) || ROAD_CLASSES.has(base)) {
    // Highways outside campus: cars only. Campus service roads and streets: shared.
    const carsOnly = ['motorway', 'trunk'].includes(base);
    return { kind: 'road', modes: carsOnly ? 'drive' : 'both' };
  }
  return null; // rail, ferry, aerialway, golf, construction…
}

export function classifyOsm(tags: Record<string, string>): { kind: WayKind; modes: WayModes } | null {
  const hw = tags.highway;
  if (!hw) return null;
  if (hw === 'steps') return { kind: 'stairs', modes: 'walk' };
  if (tags.footway === 'crossing' || tags.highway === 'crossing') return { kind: 'crossing', modes: 'walk' };
  if (tags.ramp === 'yes' || tags['ramp:wheelchair'] === 'yes') return { kind: 'ramp', modes: 'walk' };
  if (['footway', 'path', 'pedestrian', 'sidewalk', 'cycleway', 'bridleway', 'corridor'].includes(hw)) return { kind: 'walkway', modes: 'walk' };
  if (ROAD_CLASSES.has(hw) || ROAD_CLASSES.has(hw.replace(/_link$/, ''))) {
    const carsOnly = ['motorway', 'trunk'].includes(hw.replace(/_link$/, '')) || tags.foot === 'no';
    return { kind: 'road', modes: carsOnly ? 'drive' : 'both' };
  }
  return null;
}

function way(coords: Position[], props: Omit<WayProps, 'id'>, id: string): WayFeature {
  return { type: 'Feature', properties: { id, ...props }, geometry: { type: 'LineString', coordinates: coords } };
}

// ── Mapbox vector tiles ──────────────────────────────────────────────────────

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

export async function fromMapbox(token: string, fetchImpl: typeof fetch = fetch): Promise<GeoBundle> {
  const z = 16; // ~0.15 m precision, every footpath present
  const [w, s, e, n] = CAMPUS_BBOX;
  const walkways: WayFeature[] = [], pois: PoiFeature[] = [], buildings: BuildingFeature[] = [];
  const seenPoi = new Set<string>();
  let wayIndex = 0;
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) {
    for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
      const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.mvt?access_token=${encodeURIComponent(token)}`;
      const response = await fetchImpl(url);
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`Mapbox tile ${z}/${x}/${y} failed (${response.status}). Check MAPBOX_TOKEN.`);
      const tile = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
      // Tiles carry a buffer past their edge. Cut every line to the exact tile box so
      // neighbouring tiles meet at one shared point instead of overlapping; the graph's
      // 3 m merge then rejoins them.
      const tileBox: [number, number, number, number] = [x2lon(x, z), y2lat(y + 1, z), x2lon(x + 1, z), y2lat(y, z)];

      const roads = tile.layers.road;
      for (let i = 0; roads && i < roads.length; i++) {
        const f = roads.feature(i);
        const p = f.properties as Record<string, string | number | boolean>;
        const kind = classifyMapbox(String(p.class ?? ''), String(p.type ?? ''));
        if (!kind) continue;
        const g = f.toGeoJSON(x, y, z) as Feature<LineString | MultiLineString>;
        if (g.geometry.type !== 'LineString' && g.geometry.type !== 'MultiLineString') continue;
        const clipped = turf.bboxClip(g, tileBox);
        if (!inCampus(clipped.geometry)) continue;
        for (const coords of lineParts(clipped.geometry)) {
          walkways.push(way(coords, {
            ...kind,
            step_free: kind.kind !== 'stairs',
            lit: null, covered: p.structure === 'tunnel' ? true : null,
            name: typeof p.name === 'string' && p.name ? p.name : null,
            road_class: String(p.class ?? '') || null,
            source: 'mapbox',
          }, `mb-${String(++wayIndex).padStart(4, '0')}`));
        }
      }

      const labels = tile.layers.poi_label;
      for (let i = 0; labels && i < labels.length; i++) {
        const f = labels.feature(i);
        const p = f.properties as Record<string, string | number>;
        const g = f.toGeoJSON(x, y, z);
        if (g.geometry.type !== 'Point' || !inCampus(g.geometry)) continue;
        const c = round(g.geometry.coordinates);
        const name = typeof p.name === 'string' ? p.name.trim() : '';
        const key = `${name}|${c[0].toFixed(5)}|${c[1].toFixed(5)}`;
        if (seenPoi.has(key)) continue; // labels repeat across tile buffers
        seenPoi.add(key);
        pois.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c },
          properties: { name, poi_class: p.class ? String(p.class) : null, maki: p.maki ? String(p.maki) : null, source: 'mapbox' } });
      }

      const blds = tile.layers.building;
      for (let i = 0; blds && i < blds.length; i++) {
        const f = blds.feature(i);
        const g = f.toGeoJSON(x, y, z);
        if (g.geometry.type !== 'Polygon' && g.geometry.type !== 'MultiPolygon') continue;
        const centre = turf.centroid(g).geometry.coordinates;
        // keep a footprint only in the tile that owns its centroid (no duplicates from buffers)
        if (centre[0] < tileBox[0] || centre[0] >= tileBox[2] || centre[1] < tileBox[1] || centre[1] >= tileBox[3]) continue;
        if (!inCampus(g.geometry)) continue;
        const h = (f.properties as Record<string, number>).height;
        buildings.push({ type: 'Feature', geometry: g.geometry as BuildingFeature['geometry'],
          properties: { height: typeof h === 'number' ? h : null, source: 'mapbox' } });
      }
    }
  }
  return { walkways, pois, buildings };
}

// ── OpenStreetMap (Overpass) ─────────────────────────────────────────────────

type OverpassElement = { type: 'way' | 'node'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; lat?: number; lon?: number };

export async function fromOsm(fetchImpl: typeof fetch = fetch): Promise<GeoBundle> {
  const [w, s, e, n] = CAMPUS_BBOX;
  const box = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:60];(way["highway"](${box});way["building"](${box});node["name"](${box}););out geom;`;
  const response = await fetchImpl('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'gomap-campus-importer' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!response.ok) throw new Error(`Overpass request failed (${response.status}).`);
  const { elements } = await response.json() as { elements: OverpassElement[] };
  const walkways: WayFeature[] = [], pois: PoiFeature[] = [], buildings: BuildingFeature[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === 'way' && tags.highway && el.geometry) {
      const kind = classifyOsm(tags);
      if (!kind) continue;
      const coords = el.geometry.map(p => round([p.lon, p.lat]));
      walkways.push(way(coords, {
        ...kind,
        step_free: kind.kind !== 'stairs' && tags.wheelchair !== 'no',
        lit: tags.lit ? tags.lit === 'yes' : null,
        covered: tags.covered ? tags.covered === 'yes' : null,
        name: tags.name ?? null, road_class: tags.highway, source: 'osm',
      }, `osm-${el.id}`));
    } else if (el.type === 'way' && tags.building && el.geometry && el.geometry.length >= 4) {
      const ring = el.geometry.map(p => round([p.lon, p.lat]));
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ring.push(ring[0]);
      buildings.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { height: tags.height ? Number.parseFloat(tags.height) || null : null, source: 'osm' } });
      if (tags.name || tags.ref) {
        const c = turf.centroid({ type: 'Polygon', coordinates: [ring] }).geometry.coordinates;
        pois.push({ type: 'Feature', geometry: { type: 'Point', coordinates: round(c) },
          properties: { name: tags.ref ? `${tags.ref}${tags.name ? ' ' + tags.name : ''}` : tags.name!, poi_class: 'building', maki: null, source: 'osm' } });
      }
    } else if (el.type === 'node' && tags.name && el.lat != null && el.lon != null) {
      pois.push({ type: 'Feature', geometry: { type: 'Point', coordinates: round([el.lon, el.lat]) },
        properties: { name: tags.name, poi_class: tags.amenity ?? tags.shop ?? tags.leisure ?? null, maki: null, source: 'osm' } });
    }
  }
  return { walkways, pois, buildings };
}

// ── the hand-drawn mock files ────────────────────────────────────────────────

const coordKey = (line: Position[]) => line.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');

/**
 * walking_paths → walkway, driving_roads → road. A line drawn identically in both files is a
 * shared road (people walk on it, cars drive on it): it becomes one edge with modes 'both'.
 */
export function fromMockFiles(walking: FeatureCollection, driving: FeatureCollection): WayFeature[] {
  const out = new Map<string, WayFeature>();
  let i = 0;
  const add = (fc: FeatureCollection, kind: 'walkway' | 'road') => {
    for (const f of fc.features) {
      for (const coords of lineParts(f.geometry)) {
        const key = coordKey(coords);
        const reverse = coordKey([...coords].reverse());
        const existing = out.get(key) ?? out.get(reverse);
        if (existing) {
          if (existing.properties.kind !== kind) {
            existing.properties.kind = 'road';
            existing.properties.modes = 'both';
          }
          continue;
        }
        const props = (f.properties ?? {}) as Record<string, unknown>;
        out.set(key, way(coords, {
          kind, modes: kind === 'road' ? 'drive' : 'walk',
          step_free: props.step_free !== false, lit: typeof props.lit === 'boolean' ? props.lit : null,
          covered: typeof props.covered === 'boolean' ? props.covered : null,
          name: typeof props.name === 'string' ? props.name : null,
          road_class: kind === 'road' ? 'service' : 'path', source: 'mock',
        }, typeof props.id === 'string' ? props.id : `mock-${String(++i).padStart(3, '0')}`));
      }
    }
  };
  add(walking, 'walkway');
  add(driving, 'road');
  return [...out.values()];
}
