import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';

test('Express API serves discovery and saves a correction report', async () => {
  const db = openDatabase(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const places = await (await fetch(`${base}/api/places?q=scholarship`)).json() as { id: string; verificationStatus: string }[];
    assert.equal(places.length, 1);
    assert.equal(places[0].id, 'financial-aid');
    assert.equal(places[0].verificationStatus, 'sample');
    const report = await fetch(`${base}/api/reports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: 'financial-aid', issueType: 'Wrong pin', details: 'Please check entrance.' }),
    });
    assert.equal(report.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reports').get()!.count, 1);
    const invalid = await fetch(`${base}/api/reports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: 'unknown', issueType: 'Wrong pin', details: 'Check.' }),
    });
    assert.equal(invalid.status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test('assistant uses server key and limits suggestions to known places', async () => {
  const db = openDatabase(':memory:');
  let prompt = '';
  const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'test-key');
    prompt = String(init?.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      answer: 'The Financial Aid Office is a suggested contact, but AUI must verify it.',
      placeIds: ['financial-aid', 'invented-office'],
    }) }] } }] }), { status: 200 });
  }) as typeof fetch;
  const server = createApp(db, { fetchImpl: mockFetch, apiKey: 'test-key' }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const answer = await fetch(`${base}/api/assistant`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Where can I ask about a scholarship?', history: [] }),
    });
    assert.equal(answer.status, 200);
    const data = await answer.json() as { suggestedPlaces: { id: string }[] };
    assert.deepEqual(data.suggestedPlaces.map(place => place.id), ['financial-aid']);
    assert.match(prompt, /sample campus records/);
    const invalid = await fetch(`${base}/api/assistant`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(501) }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
