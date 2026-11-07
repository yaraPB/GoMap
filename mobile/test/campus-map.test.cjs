const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadHtmlForPlaces() {
  const source = fs.readFileSync(path.join(__dirname, '../src/CampusMap.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => id === 'react-native' ? { StyleSheet: { absoluteFill: {}, create: styles => styles } } : {},
  });
  return module.exports.htmlForPlaces;
}

test('Mapbox map reports readiness and marker selection to React Native', () => {
  const place = { id: 'library', name: 'M6 Library', category: 'Campus Services', latitude: 33.5398, longitude: -5.1066 };
  const html = loadHtmlForPlaces()([place], 'pk.test-public-token');
  assert.match(html, /api\.mapbox\.com\/mapbox-gl-js/);
  assert.match(html, /mapbox:\/\/styles\/mapbox\/streets-v12/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const messages = [];
  const elements = [];
  const map = { on: (event, callback) => { if (event === 'load') callback(); }, flyTo: () => {}, easeTo: () => {}, getPitch: () => 45 };
  class Marker {
    constructor({ element }) { this.element = element; }
    setLngLat(coords) { assert.equal(coords[0], place.longitude); return this; }
    addTo() { return this; }
    getElement() { return this.element; }
  }
  const window = {
    ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) },
    mapboxgl: { supported: () => true, Map: class { constructor(options) { assert.equal(options.accessToken, 'pk.test-public-token'); return map; } }, Marker },
  };
  const document = { createElement: () => { const element = { style: { setProperty: () => {} }, setAttribute: () => {} }; elements.push(element); return element; } };
  new vm.Script(script).runInNewContext({ window, document, setTimeout: () => {} });
  assert.equal(messages[0].type, 'ready');
  elements[0].onclick();
  assert.deepEqual(messages[1], { type: 'select', detail: 'library' });
  window.gomap.filter('Academic');
  assert.equal(elements[0].style.display, 'none');
});

test('place names cannot inject a closing script tag', () => {
  const html = loadHtmlForPlaces()([{ id: 'x', name: '</script><script>alert(1)</script>', category: 'Academic', latitude: 33, longitude: -5 }], 'pk.test');
  assert.ok(!html.includes('</script><script>alert(1)'));
});
