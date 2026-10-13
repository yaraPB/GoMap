const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('MapLibre HTML boots, reports readiness, and sends marker selections to React Native', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/CampusMap.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => id === 'react-native' ? { StyleSheet: { absoluteFill: {}, create: styles => styles } } : {},
  });
  const place = { id: 'library', name: 'M6 Library', category: 'Campus Services', latitude: 33.5398, longitude: -5.1066 };
  const html = module.exports.htmlForPlaces([place]);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline map bootstrap is present');
  const messages = [];
  const elements = [];
  const map = { on: (event, callback) => { if (event === 'load') callback(); }, flyTo: () => {}, easeTo: () => {}, getPitch: () => 53 };
  class FakeMarker {
    constructor({ element }) { this.element = element; }
    setLngLat(coords) { assert.equal(coords[0], place.longitude); return this; }
    addTo() { return this; }
    getElement() { return this.element; }
  }
  const window = { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) }, maplibregl: { Map: class { constructor() { return map; } }, Marker: FakeMarker } };
  const document = { createElement: () => { const el = { style: { setProperty: () => {} }, setAttribute: () => {} }; elements.push(el); return el; } };
  new vm.Script(script).runInNewContext({ window, document, setTimeout: () => {} });
  assert.equal(messages[0].type, 'ready', JSON.stringify(messages[0]));
  elements[0].onclick();
  assert.deepEqual(messages[1], { type: 'select', detail: 'library' });
  window.gomap.filter('Academic');
  assert.equal(elements[0].style.display, 'none');
});

test('place names cannot inject a closing script tag', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/CampusMap.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: id => id === 'react-native' ? { StyleSheet: { absoluteFill: {}, create: styles => styles } } : {} });
  const html = module.exports.htmlForPlaces([{ id: 'x', name: '</script><script>alert(1)</script>', category: 'Academic', latitude: 33, longitude: -5 }]);
  assert.ok(!html.includes('</script><script>alert(1)'));
});

test('Android raster map waits for an image tile before reporting ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/CampusMap.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => id === 'react-native' ? { StyleSheet: { absoluteFill: {}, create: styles => styles } } : {},
  });
  const html = module.exports.htmlForPlaces([{ id: 'library', name: 'M6 Library', category: 'Campus Services', latitude: 33.5398, longitude: -5.1066 }], 'raster');
  assert.match(html, /tile\.openstreetmap\.org/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const messages = [];
  const tileHandlers = {};
  const markerHandlers = {};
  const map = { setView: () => map, hasLayer: () => true, flyTo: () => {}, removeLayer: () => {} };
  const tile = { on: (name, callback) => { tileHandlers[name] = callback; }, addTo: () => tile };
  const marker = { addTo: () => marker, on: (name, callback) => { markerHandlers[name] = callback; } };
  const window = {
    ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) },
    L: { map: () => map, tileLayer: () => tile, divIcon: () => ({}), marker: () => marker },
  };
  new vm.Script(script).runInNewContext({ window, setTimeout: () => {} });
  assert.equal(messages.length, 0);
  tileHandlers.tileload();
  assert.equal(messages[0].type, 'ready');
  markerHandlers.click();
  assert.deepEqual(messages[1], { type: 'select', detail: 'library' });
});
