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
    assert.deepEqual(places[0].entrances, []);

    const placeDetails = await (await fetch(`${base}/api/places/financial-aid`)).json();
    assert.equal(placeDetails.description.includes('Confirm'), true);
    assert.deepEqual(placeDetails.entrances, []);

    db.prepare(`INSERT INTO entrances (id, place_id, name, latitude, longitude)
      VALUES (?, ?, ?, ?, ?)`).run('financial-aid-east', 'financial-aid', 'East entrance', 33.5385, -5.1048);
    let entrance = (await (await fetch(`${base}/api/places/financial-aid`)).json()).entrances[0];
    assert.equal(entrance.mapVisible, false);
    assert.equal(entrance.routeEligible, false);

    db.prepare(`UPDATE entrances SET verification_status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?`)
      .run('AUI facilities', '2026-10-30T10:00:00Z', 'financial-aid-east');
    entrance = (await (await fetch(`${base}/api/places/financial-aid`)).json()).entrances[0];
    assert.equal(entrance.mapVisible, true);
    assert.equal(entrance.routeEligible, false, 'a surveyed entrance is not routable before access review');

    db.prepare(`UPDATE entrances SET access_status = 'approved', access_checked_by = ?, access_checked_at = ? WHERE id = ?`)
      .run('AUI facilities', '2026-10-31T10:00:00Z', 'financial-aid-east');
    entrance = (await (await fetch(`${base}/api/places/financial-aid`)).json()).entrances[0];
    assert.equal(entrance.routeEligible, true);

    assert.throws(() => db.prepare(`INSERT INTO entrances
      (id, place_id, name, verification_status) VALUES (?, ?, ?, 'verified')`)
      .run('invalid-entrance', 'financial-aid', 'Unsurveyed entrance'));

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
