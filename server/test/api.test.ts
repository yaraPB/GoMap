import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from '../src/boot.js';
import { createApp } from '../src/app.js';

let server: Server;
let base = '';
let ctx: Awaited<ReturnType<typeof boot>>;
let geminiCalls = 0;

// The plaza in front of the library: a real point on the imported network.
const PLAZA = { lat: 33.5393, lng: -5.1066 };
const admin = { authorization: 'Bearer dev-admin-token', 'content-type': 'application/json' };
const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any }; };
const send = async (path: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }, method = 'POST') => {
  const r = await fetch(base + path, { method, headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};

before(async () => {
  const mockGemini = (async (url: string | URL | Request, init?: RequestInit) => {
    geminiCalls++;
    assert.match(String(url), /generativelanguage/);
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "I don't have that in the campus records." }] } }] }), { status: 200 });
  }) as typeof fetch;
  ctx = await boot({ mongoUri: '', sqliteFile: ':memory:', geminiKey: 'test-key', fetchImpl: mockGemini, quiet: true });
  server = createApp({ ...ctx, uploadsDir: mkdtempSync(join(tmpdir(), 'gomap-')) }).listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>(r => server.close(() => r())); await ctx.close(); });

test('places come from the map data with real building numbers', async () => {
  const { body: all } = await get('/api/places');
  const ids = all.map((p: { id: string }) => p.id);
  for (const id of ['building-11', 'building-8b', 'building-15', 'building-17', 'cafeteria-newrest', 'building-16']) assert.ok(ids.includes(id), id);
  const { body: academic } = await get('/api/places?category=academic&school=sba');
  assert.ok(academic.every((p: { category: string }) => p.category === 'academic'));
  assert.ok(academic.some((p: { id: string }) => p.id === 'building-11'));
  const { body: b16 } = await get('/api/places/building-16');
  assert.equal(b16.position_estimated, true);
  assert.ok(b16.departments.length > 0);
});

test('building 11 lists offices by floor, with the shared office and the conflict', async () => {
  const { body } = await get('/api/places/building-11/people');
  assert.ok(body.total > 10);
  const people = body.floors.flatMap((f: { people: unknown[] }) => f.people);
  const satt = people.find((p: { id: string }) => p.id === 'harit-satt');
  assert.equal(satt.office_number, '111');
  assert.ok(satt.shared_with.length >= 2, 'office 111 is shared');
  const chetioui = people.find((p: { id: string }) => p.id === 'youssef-chetioui');
  assert.equal(chetioui.conflict.field, 'office_number');
  const { body: goel } = await get('/api/people/lakshmi-goel');
  assert.deepEqual(goel.missing.sort(), ['email', 'hours', 'office']);
  assert.equal(goel.availability.state, 'not_published');
});

test('walking route from the plaza to building 11 ends at its entrance', async () => {
  const { status, body } = await send('/api/route', { from: PLAZA, to_place_id: 'building-11', mode: 'walk' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.distance_m > 50 && body.distance_m < 800, `distance ${body.distance_m}`);
  assert.equal(body.geometry.type, 'LineString');
  assert.equal(body.steps[0].turn, 'depart');
  assert.equal(body.steps.at(-1).turn, 'arrive');
  assert.equal(body.destination.place_id, 'building-11');
  assert.equal(body.destination.entrance, 'Main entrance');
});

test('a confirmed closure reroutes the next walk, and resolving it restores the route', async () => {
  const before = (await send('/api/route', { from: PLAZA, to_place_id: 'building-11' })).body;
  const coords = before.geometry.coordinates;
  const mid = coords[Math.floor(coords.length / 2)];
  const report = await send('/api/reports', { kind: 'closed', lat: mid[1], lng: mid[0], note: 'Fenced off', duration: 'days' });
  assert.equal(report.status, 201);
  const dup = await send('/api/reports', { kind: 'closed', lat: mid[1] + 0.00005, lng: mid[0], note: 'same' });
  assert.equal(dup.body.merged_with_existing, true, 'within 20 m → same decision');
  const { body: queue } = await (await fetch(`${base}/api/admin/reports?status=new`, { headers: admin })).json().then(b => ({ body: b as any }));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].count, 2);
  const confirm = await send(`/api/admin/reports/${queue[0].cluster_id}/confirm`, { reason: 'Works on the path', radius_m: 6, close_place: false }, admin);
  assert.equal(confirm.status, 200);
  assert.ok(confirm.body.closed_edges > 0);
  const afterClose = await send('/api/route', { from: PLAZA, to_place_id: 'building-11' });
  if (afterClose.status === 200) assert.notDeepEqual(afterClose.body.geometry.coordinates, coords, 'route changed');
  else assert.equal(afterClose.status, 404);
  await send(`/api/admin/reports/${queue[0].cluster_id}/resolve`, {}, admin);
  const restored = await send('/api/route', { from: PLAZA, to_place_id: 'building-11' });
  assert.deepEqual(restored.body.geometry.coordinates, coords);
});

test('assistant answers places locally, with directions opening by themselves', async () => {
  const calls = geminiCalls;
  const { body } = await send('/api/assistant/ask', { text: 'Take me to building eleven', lang: 'en', from: PLAZA });
  assert.equal(body.intent, 'place');
  assert.equal(body.answered_by, 'local');
  assert.deepEqual(body.action, { type: 'route', place_id: 'building-11', mode: 'walk' });
  assert.ok(body.route.distance_m > 0);
  assert.equal(geminiCalls, calls, 'no model call');
});

test('assistant answers procedures and people with source and verification', async () => {
  const minor = (await send('/api/assistant/ask', { text: 'How do I declare a minor?', lang: 'en' })).body;
  assert.equal(minor.intent, 'procedure');
  assert.equal(minor.unverified, true, 'draft procedure is flagged');
  assert.equal(minor.action.place_id, 'building-2');
  assert.ok(minor.procedure.steps.length >= 2);
  assert.ok(minor.source);
  const person = (await send('/api/assistant/ask', { text: 'Is professor Harit Satt in?', lang: 'en' })).body;
  assert.equal(person.intent, 'person');
  assert.equal(person.person.id, 'harit-satt');
});

test('assistant falls back to Gemini for open questions and does not invent a place', async () => {
  const calls = geminiCalls;
  const { body } = await send('/api/assistant/ask', { text: 'What is the meaning of life on campus tonight', lang: 'en' });
  assert.equal(geminiCalls, calls + 1);
  assert.equal(body.intent, 'unknown');
  assert.equal(body.action, undefined);
  const again = (await send('/api/assistant/ask', { text: 'What is the meaning of life on campus tonight', lang: 'en' })).body;
  assert.equal(again.answered_by, 'cache');
  assert.equal(geminiCalls, calls + 1);
});

test('faculty presence: only the person can set it, and it shows on their card', async () => {
  const denied = await send('/api/people/harit-satt/presence', { status: 'busy' }, { 'content-type': 'application/json', 'x-gomap-user': 'demo-student' }, 'PUT');
  assert.equal(denied.status, 403);
  const until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const ok = await send('/api/people/harit-satt/presence', { status: 'busy', reason: 'meeting', until }, { 'content-type': 'application/json', 'x-gomap-user': 'harit-satt' }, 'PUT');
  assert.equal(ok.status, 200);
  // Presence clears at 18:30 campus time, so after that it is already gone.
  if (ok.body.presence) assert.equal(ok.body.availability.state, 'busy');
});

test('admin endpoints need the token; overview lists what is wrong', async () => {
  assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401);
  const overview = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json() as any;
  assert.ok(overview.conflicts.some((c: { id: string }) => c.id === 'youssef-chetioui'));
  assert.ok(overview.missing.some((m: { id: string }) => m.id === 'lakshmi-goel'));
  assert.ok(overview.unanswered.length >= 1);
});

test('crowding returns load per walkway segment', async () => {
  const { body } = await get('/api/crowding?weekday=1&hour=12');
  assert.equal(body.type, 'FeatureCollection');
  assert.ok(body.features.length > 50);
  assert.ok(body.features.some((f: { properties: { level: string } }) => f.properties.level === 'high'));
});
