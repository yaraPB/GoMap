import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mapHtml } from '../src/map/mapHtml';

const html = mapHtml('pk.test-token', { flyIn: true });
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1] ?? '';

test('the in-page map script is valid JavaScript', () => {
  assert.ok(script.length > 1000);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('the map page uses Mapbox GL JS and attributes OpenStreetMap', () => {
  assert.match(html, /api\.mapbox\.com\/mapbox-gl-js\/v3/);
  assert.match(html, /OpenStreetMap contributors/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
});

test('the page reports ready, renders pins and forwards a pin tap to React Native', () => {
  const messages: { type: string; detail: unknown }[] = [];
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const created: { onclick?: (e: unknown) => void; className: string }[] = [];
  const el = () => {
    const node: any = { className: '', style: { setProperty() {} }, classList: { toggle() {} }, children: [] as unknown[], setAttribute() {}, appendChild(c: unknown) { node.children.push(c); node.firstChild ??= c; }, querySelector: () => ({ style: {} }), innerHTML: '', textContent: '' };
    created.push(node);
    return node;
  };
  const sources: Record<string, { data: any; setData: (d: any) => void; getClusterExpansionZoom: () => void }> = {};
  const map: any = {
    on: (ev: string, fn: () => void) => { (handlers[ev] ??= []).push(fn); },
    once: (ev: string, fn: () => void) => { (handlers[ev] ??= []).push(fn); },
    off() {}, addControl() {}, flyTo() {}, jumpTo() {}, easeTo() {}, fitBounds() {}, stop() {}, setMaxBounds() {}, setMinZoom() {},
    getZoom: () => 16.4, getBearing: () => 0, setConfigProperty() {}, getConfigProperty: () => true, setPaintProperty() {}, setLayoutProperty() {},
    addSource: (id: string, s: any) => { sources[id] = { data: s.data, setData(d) { this.data = d; }, getClusterExpansionZoom() {} }; },
    getSource: (id: string) => sources[id], addLayer() {}, getLayer: () => true, setStyle() {},
    querySourceFeatures: (id: string) => (sources[id]?.data.features ?? []),
  };
  class Marker { el: any; constructor(o: any) { this.el = o.element; } setLngLat() { return this; } addTo() { return this; } remove() {} getElement() { return this.el; } }
  const listeners: Record<string, (e: unknown) => void> = {};
  const win: any = {
    ReactNativeWebView: { postMessage: (m: string) => messages.push(JSON.parse(m)) },
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    matchMedia: () => ({ matches: false }), parent: null,
    mapboxgl: { supported: () => true, Map: function () { return map; }, Marker, AttributionControl: function () {}, LngLatBounds: function () { return { extend() {} }; } },
  };
  win.parent = win;
  const ctx = vm.createContext({ window: win, mapboxgl: win.mapboxgl, document: { createElement: el, addEventListener() {} }, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, JSON, Math, Object, String, console });
  new vm.Script(script).runInContext(ctx);
  handlers['style.load']?.forEach(fn => fn());
  assert.ok(messages.some(m => m.type === 'ready'));
  listeners.message({ data: JSON.stringify({ type: 'places', places: [{ id: 'building-11', name: 'Building 11', number: '11', category: 'academic', schools: ['sba'], coordinates: [-5.108, 33.539], status: 'open' }] }) });
  handlers.render?.forEach(fn => fn());
  const pin = created.find(c => c.className.split(' ')[0] === 'pin');
  assert.ok(pin, 'a pin element was created');
  pin!.onclick!({ stopPropagation() {} });
  assert.deepEqual(messages.at(-1), { type: 'select', detail: 'building-11' });
});
