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
