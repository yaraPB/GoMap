import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';

test('discovery, service recommendation and report form one working slice', async () => {
  const db = openDatabase(':memory:');
  const server = createApp(db);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const search = await fetch(`${base}/api/places?q=scholarship`);
    assert.equal(search.status, 200);
    const places = await search.json();
    assert.equal(places.length, 1);
    assert.equal(places[0].id, 'financial-aid');
    assert.equal(places[0].verificationStatus, 'sample');

    const services = await (await fetch(`${base}/api/services`)).json();
    assert.equal(services.find(s => s.id === 'scholarship').destinationId, 'financial-aid');

    const report = await fetch(`${base}/api/reports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: 'financial-aid', issueType: 'Wrong pin', details: 'Please check entrance.' })
    });
    assert.equal(report.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 1);

    const invalid = await fetch(`${base}/api/reports`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: 'unknown', issueType: 'Wrong pin', details: 'Check.' })
    });
    assert.equal(invalid.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
