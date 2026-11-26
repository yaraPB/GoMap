import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { campus3dHtml } from '../src/map/campus3dHtml';
import { CAMPUS_OUTLINE } from '../src/map/campusOutline';

const html = campus3dHtml('test-key"</script><script>alert(1)</script>');
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1] ?? '';

test('the 3D page script is valid JavaScript', () => {
  assert.ok(script.length > 1000);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('the 3D page uses Google Photorealistic 3D Tiles in Cesium, cut to the campus outline', () => {
  assert.match(html, /cesium\.com\/downloads\/cesiumjs/);
  assert.match(html, /tile\.googleapis\.com\/v1\/3dtiles\/root\.json/);
  assert.ok(html.includes(JSON.stringify(CAMPUS_OUTLINE)), 'clipped to the same outline as the 2D map');
  assert.doesNotMatch(html, /<\/script><script>alert/, 'a key cannot break out of the page');
});

test('the 3D page talks the bridge: ready, select, tapMap out; places, select, user, route in', () => {
  for (const out of ["send('ready')", "send('select'", "send('tapMap')"]) assert.ok(script.includes(out), out);
  for (const msg of ['places', 'select', 'user', 'route', 'home']) assert.ok(script.includes(`m.type==='${msg}'`), msg);
});
