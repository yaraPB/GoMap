import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../src/config.js';
import { fromMockFiles, classifyMapbox, classifyOsm } from '../src/geo/sources.js';
import type { WayFeature } from '../src/geo/types.js';
import { buildGraph, components } from '../src/routing/graph.js';
import { shortestPath, snap, turnFor } from '../src/routing/route.js';
import { parseHours, openState } from '../src/lib/hours.js';
import { IntentRouter, normalise } from '../src/assistant/router.js';
import { parseOffice } from '../src/seed/people.js';

const mock = (f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
const line = (id: string, kind: WayFeature['properties']['kind'], coords: number[][], stepFree = true): WayFeature => ({
  type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
  properties: { id, kind, modes: kind === 'road' ? 'both' : 'walk', step_free: stepFree, lit: null, covered: null, name: null, road_class: kind === 'road' ? 'service' : 'path', source: 'mock' },
});

test('mock files: a line drawn in both files becomes one shared road', () => {
  const ways = fromMockFiles(mock('walking_paths.geojson'), mock('driving_roads.geojson'));
  assert.equal(ways.length, 3);
  assert.deepEqual(ways.map(w => `${w.properties.kind}/${w.properties.modes}`).sort(), ['road/both', 'road/both', 'road/drive']);
});

test('mock files: the T-junction landing on a middle vertex is joined', () => {
  const ways = fromMockFiles(mock('walking_paths.geojson'), { type: 'FeatureCollection', features: [] });
  const g = buildGraph(ways);
  assert.equal(components(g).sizes.length, 1, 'both walking lines form one connected network');
});

test('graph splits a path that crosses a road between vertices', () => {
  const g = buildGraph([line('p', 'walkway', [[-5.107, 33.539], [-5.106, 33.539]]), line('r', 'road', [[-5.1065, 33.5385], [-5.1065, 33.5395]])]);
  assert.equal(components(g).sizes.length, 1);
  assert.ok(g.nodes.some(n => n.edges.length === 4), 'a 4-way node at the crossing');
});

test('graph joins a line that stops 2 m short of another line (between its vertices)', () => {
  const g = buildGraph([line('a', 'walkway', [[-5.107, 33.539], [-5.106, 33.539]]), line('b', 'walkway', [[-5.1065, 33.53902], [-5.1065, 33.5395]])]);
  assert.equal(components(g).sizes.length, 1);
});

test('step-free routing refuses stairs', () => {
  const g = buildGraph([line('a', 'walkway', [[-5.107, 33.539], [-5.1065, 33.539]]), line('b', 'stairs', [[-5.1065, 33.539], [-5.106, 33.539]], false)]);
  const end = g.nodes.find(n => Math.abs(n.coord[0] + 5.106) < 1e-5)!.id;
  assert.ok(shortestPath(g, snap(g, [-5.107, 33.539], 'walk', new Set())!, [end], 'walk', new Set()));
  assert.equal(shortestPath(g, snap(g, [-5.107, 33.539], 'step_free', new Set())!, [end], 'step_free', new Set()), null);
});

test('closed edges are unreachable', () => {
  const g = buildGraph([line('a', 'walkway', [[-5.107, 33.539], [-5.1065, 33.539], [-5.106, 33.539]])]);
  const end = g.nodes.find(n => Math.abs(n.coord[0] + 5.106) < 1e-5)!.id;
  const start = snap(g, [-5.107, 33.539], 'walk', new Set())!;
  assert.equal(shortestPath(g, start, [end], 'walk', new Set(['a:1'])), null);
});

test('classification tells footpaths, stairs, crossings and roads apart', () => {
  assert.deepEqual(classifyMapbox('path', 'footway'), { kind: 'walkway', modes: 'walk' });
  assert.deepEqual(classifyMapbox('path', 'steps'), { kind: 'stairs', modes: 'walk' });
  assert.deepEqual(classifyMapbox('service', 'service'), { kind: 'road', modes: 'both' });
  assert.deepEqual(classifyMapbox('motorway', 'motorway'), { kind: 'road', modes: 'drive' });
  assert.equal(classifyMapbox('major_rail', 'rail'), null);
  assert.deepEqual(classifyOsm({ highway: 'footway', footway: 'crossing' }), { kind: 'crossing', modes: 'walk' });
  assert.deepEqual(classifyOsm({ highway: 'footway', ramp: 'yes' }), { kind: 'ramp', modes: 'walk' });
});

test('turn thresholds', () => {
  assert.equal(turnFor(5), 'straight');
  assert.equal(turnFor(-40), 'slight left');
  assert.equal(turnFor(90), 'right');
  assert.equal(turnFor(-160), 'sharp left');
});

test('hours: parses the directory formats; missing is not closed', () => {
  assert.deepEqual(parseHours('Monday, Wednesday & Friday 9:00-11:00 and 13:00-14:00').hours,
    { mon: [['09:00', '11:00'], ['13:00', '14:00']], wed: [['09:00', '11:00'], ['13:00', '14:00']], fri: [['09:00', '11:00'], ['13:00', '14:00']] });
  assert.deepEqual(parseHours('Monday-Thursday 10:10-11:50').hours, { mon: [['10:10', '11:50']], tue: [['10:10', '11:50']], wed: [['10:10', '11:50']], thu: [['10:10', '11:50']] });
  const appt = parseHours('Wednesday 15:00-18:00; Tuesday & Thursday by appointment');
  assert.deepEqual(appt.hours, { wed: [['15:00', '18:00']] });
  assert.equal(appt.byAppointment, true);
  assert.equal(parseHours('TBA').hours, null);
  assert.equal(parseHours('See office door for current office hours').note, 'See office door for current office hours');
  assert.equal(openState(null).state, 'not_published');
  // Monday 10:00 in Casablanca (UTC+1) = 09:00 UTC
  const monday10 = new Date('2026-11-16T09:00:00Z');
  assert.deepEqual(openState({ mon: [['09:00', '11:00']] }, 'Africa/Casablanca', monday10), { state: 'open', until: '11:00' });
  assert.equal(openState({ mon: [], tue: [['09:00', '10:00']] }, 'Africa/Casablanca', monday10).state, 'closed');
});

test('office strings parse into building, office and floor', () => {
  assert.deepEqual(parseOffice('Building 16 (NAB), Office 146'), { place_id: 'building-16', office_number: '146', floor: 1 });
  assert.deepEqual(parseOffice('Building 8B, Office 313'), { place_id: 'building-8b', office_number: '313', floor: 3 });
  assert.deepEqual(parseOffice('Building 11, Office 4'), { place_id: 'building-11', office_number: '4', floor: 0 });
  assert.deepEqual(parseOffice(null), { place_id: null, office_number: null, floor: null });
});

test('intent router: places, people, procedures and number words', () => {
  const r = new IntentRouter(
    [{ id: 'building-8', keys: ['Building 8', 'building 8'] }, { id: 'building-15', keys: ['Mohammed VI Library', 'library'] }, { id: 'its', keys: ['ITS', 'wifi'] }],
    [{ id: 'harit-satt', keys: ['Harit Satt', 'Satt'] }],
    [{ id: 'declare-minor', keys: ['Declare a minor', 'declare a minor', 'minor declaration'] }],
  );
  assert.equal(normalise('Take me to building eight'), 'take me to building 8');
  assert.equal(r.match('Take me to building eight…')?.id, 'building-8');
  assert.equal(r.match('where is the library?')?.intent, 'place');
  assert.equal(r.match('is professor Satt in his office?')?.id, 'harit-satt');
  assert.equal(r.match('How do I declare a minor?')?.id, 'declare-minor');
  assert.equal(r.match('how do I use this map')?.intent, 'help');
  assert.equal(r.match('what is the meaning of life'), null);
  assert.equal(r.match('take me to the library step free')?.mode, 'step_free');
});

test('islands are joined to the main network, so every place is reachable (Building 14)', async () => {
  const { connectIslands } = await import('../src/routing/graph.js');
  const g = buildGraph([
    line('main', 'walkway', [[-5.107, 33.539], [-5.106, 33.539]]),
    line('island', 'walkway', [[-5.1065, 33.5394], [-5.1064, 33.5396]]), // ~45 m north, touches nothing
  ]);
  assert.equal(components(g).sizes.length, 2);
  const added = connectIslands(g);
  assert.equal(added.length, 1);
  assert.equal(components(g).sizes.length, 1);
  const end = g.nodes.find(n => Math.abs(n.coord[1] - 33.5396) < 1e-6)!.id;
  assert.ok(shortestPath(g, snap(g, [-5.107, 33.539], 'walk', new Set())!, [end], 'walk', new Set()), 'a route reaches the island');
});

test('real campus data: every place has a route from the main plaza', async () => {
  const { connectIslands } = await import('../src/routing/graph.js');
  const { loadGeo } = await import('../src/seed/seed.js');
  const { placesFromPois } = await import('../src/seed/places.js');
  const { nearestNode } = await import('../src/routing/route.js');
  const geo = loadGeo();
  const g = buildGraph(geo.walkways, [-5.1066, 33.5393]);
  connectIslands(g, 80);
  const start = snap(g, [-5.10655, 33.53925], 'walk', new Set())!;
  const unreachable = placesFromPois(geo.pois, geo.buildings).filter(p => {
    const n = nearestNode(g, p.location.coordinates, 'walk');
    return n == null || !shortestPath(g, start, [n], 'walk', new Set());
  }).map(p => p._id);
  assert.deepEqual(unreachable, []);
});

// ── slopes ──────────────────────────────────────────────────────────────────

/**
 * A hill on a flat plain, as Mapbox Terrain stores it: nested squares, each the area at or above
 * its level (1600, 1610, 1620 m), centred on (-5.106, 33.539), 100 m apart from one level to the next.
 */
function hill() {
  const [cx, cy] = [-5.106, 33.539];
  const kx = 111320 * Math.cos(cy * Math.PI / 180), ky = 110540;
  const sq = (half: number) => [[cx - half / kx, cy - half / ky], [cx + half / kx, cy - half / ky], [cx + half / kx, cy + half / ky], [cx - half / kx, cy + half / ky], [cx - half / kx, cy - half / ky]];
  const tile: [number, number, number, number] = [-5.12, 33.53, -5.09, 33.55];
  return { type: 'FeatureCollection' as const, features: [[1600, 300], [1610, 200], [1620, 100]].map(([ele, half]) => ({ type: 'Feature' as const, properties: { ele, tile }, geometry: { type: 'Polygon' as const, coordinates: [sq(half)] } })), kx, ky, cx, cy };
}

test('elevation: heights between contour lines are interpolated and never jump', async () => {
  const { makeElevation } = await import('../src/geo/elevation.js');
  const h = hill();
  const ele = makeElevation(h, [h.cx, h.cy]);
  // 150 m east of the centre: halfway between the 1610 line (200 m) and the 1620 line (100 m)
  assert.ok(Math.abs(ele([h.cx + 150 / h.kx, h.cy])! - 1615) < 0.01);
  assert.ok(Math.abs(ele([h.cx + 200 / h.kx, h.cy])! - 1610) < 0.01, 'on the line itself');
  // walking out from the top in 1 m steps, the height never changes by more than the slope allows
  let prev = ele([h.cx + 101 / h.kx, h.cy])!;
  for (let d = 102; d < 299; d++) {
    const e = ele([h.cx + d / h.kx, h.cy])!;
    assert.ok(Math.abs(e - prev) < 0.2, `jump of ${(e - prev).toFixed(2)} m at ${d} m`);
    prev = e;
  }
  assert.equal(makeElevation(null)([h.cx, h.cy]), null, 'no terrain data: unknown, not zero');
});

test('graph: with terrain every edge has a rise, and long lines are sampled without breaking them', async () => {
  const { makeElevation } = await import('../src/geo/elevation.js');
  const h = hill();
  // a 180 m path from 290 m to 110 m east of the top: climbs from 1601 m to 1619 m
  const g = buildGraph([line('up', 'walkway', [[h.cx + 290 / h.kx, h.cy], [h.cx + 110 / h.kx, h.cy]])], [h.cx, h.cy], { elevation: makeElevation(h, [h.cx, h.cy]) });
  assert.equal(components(g).sizes.length, 1, 'still one piece');
  assert.ok(g.edges.length >= 9, `sampled every 20 m (${g.edges.length} edges)`);
  const climb = g.edges.reduce((s, e) => s + e.rise!, 0);
  assert.ok(Math.abs(climb - 18) < 0.1, `climb ${climb.toFixed(1)} m`);
  assert.equal(buildGraph([line('up', 'walkway', [[h.cx + 290 / h.kx, h.cy], [h.cx + 110 / h.kx, h.cy]])]).edges.length, 1, 'without terrain the line is left alone');
});

test('step-free takes the gentle way round a hill; walking goes straight over it', async () => {
  const { makeElevation } = await import('../src/geo/elevation.js');
  const { buildRoute } = await import('../src/routing/route.js');
  const h = hill();
  const P = (x: number, y: number) => [h.cx + x / h.kx, h.cy + y / h.ky];
  // straight over: from 250 m west to 250 m east through the top (~10 % up, then down)
  // round: the same two ends joined by a path that stays on the flat plain 350 m south
  const g = buildGraph([
    line('over', 'walkway', [P(-250, 0), P(0, 0), P(250, 0)]),
    line('round', 'walkway', [P(-250, 0), P(-350, -350), P(350, -350), P(250, 0)]),
  ], [h.cx, h.cy], { elevation: makeElevation(h, [h.cx, h.cy]) });
  const from = P(-250, 0) as [number, number];
  const end = g.nodes.reduce((b, n) => (Math.hypot(n.coord[0] - P(250, 0)[0], n.coord[1] - P(250, 0)[1]) < Math.hypot(b.coord[0] - P(250, 0)[0], b.coord[1] - P(250, 0)[1]) ? n : b)).id;
  const go = (mode: 'walk' | 'step_free') => {
    const s = snap(g, from, mode, new Set())!;
    return buildRoute(g, s, from, shortestPath(g, s, [end], mode, new Set())!.path, null, mode);
  };
  const walk = go('walk'), wheels = go('step_free');
  assert.ok(walk.distance_m < 520, `walking goes over the top (${walk.distance_m} m)`);
  assert.ok(walk.slope!.climb_m >= 15 && walk.slope!.max_grade >= 8, `and says so: ${JSON.stringify(walk.slope)}`);
  assert.ok(wheels.distance_m > 1000, `step-free goes round (${wheels.distance_m} m)`);
  assert.ok(wheels.slope!.max_grade <= 5 && wheels.slope!.steep_m === 0, JSON.stringify(wheels.slope));
  assert.ok(walk.segments.some(s => s.steep), 'the steep stretch is marked for the map');
  assert.ok(walk.duration_s > walk.distance_m / 1.25, 'the climb costs time');
});

test('walking time follows the hill: up is slower than down', async () => {
  const { walkSlowdown, wheelSlowdown } = await import('../src/routing/route.js');
  assert.equal(walkSlowdown(0), 1);
  assert.ok(walkSlowdown(0.1) > 1.3 && walkSlowdown(0.1) < 1.5);
  assert.ok(walkSlowdown(-0.05) < 1, 'a gentle descent is a bit faster');
  assert.ok(walkSlowdown(-0.25) > 1, 'a steep descent is slow again');
  assert.equal(wheelSlowdown(0.04), 1);
  assert.ok(wheelSlowdown(0.1) > wheelSlowdown(0.07) && wheelSlowdown(-0.1) === wheelSlowdown(0.1), 'steep is hard on wheels both ways');
});
