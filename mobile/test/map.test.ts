import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mapHtml, CAMPUS_CENTER } from '../src/map/mapHtml';

const html = mapHtml('pk.test-token', { flyIn: true });
const scriptOf = (page: string) => page.match(/<script>\n([\s\S]*?)<\/script>/)?.[1] ?? '';
const script = scriptOf(html);

test('the in-page map script is valid JavaScript', () => {
  assert.ok(script.length > 1000);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('the map page uses Mapbox GL JS and attributes OpenStreetMap', () => {
  assert.match(html, /api\.mapbox\.com\/mapbox-gl-js\/v3/);
  assert.match(html, /OpenStreetMap contributors/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
});

function mapHarness({ flyIn = true, reduced = false } = {}) {
  const messages: { type: string; detail: unknown }[] = [];
  const events = new Map<string, Set<(...args: any[]) => void>>();
  const emit = (event: string, ...args: any[]) => [...(events.get(event) ?? [])].forEach(fn => fn(...args));
  const created: { onclick?: (e: unknown) => void; className: string }[] = [];
  const calls: { name: string; args: any }[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  let options: any;
  const record = (name: string) => (args: any) => { calls.push({ name, args }); };
  const el = () => {
    const node: any = { className: '', style: { setProperty() {} }, classList: { toggle() {} }, children: [] as unknown[], setAttribute() {}, appendChild(c: unknown) { node.children.push(c); node.firstChild ??= c; }, querySelector: () => ({ style: {} }), innerHTML: '', textContent: '' };
    created.push(node);
    return node;
  };
  const sources: Record<string, { data: any; setData: (d: any) => void; getClusterExpansionZoom: () => void }> = {};
  const map: any = {
    on(ev: string, fn: (...args: any[]) => void) { if (!events.has(ev)) events.set(ev, new Set()); events.get(ev)!.add(fn); },
    once(ev: string, fn: (...args: any[]) => void) { const once = (...args: any[]) => { map.off(ev, once); fn(...args); }; map.on(ev, once); },
    off(ev: string, fn: (...args: any[]) => void) { events.get(ev)?.delete(fn); },
    addControl() {}, flyTo: record('flyTo'), jumpTo(args: any) { record('jumpTo')(args); emit('moveend'); },
    easeTo: record('easeTo'), fitBounds(_bounds: any, opts: any) { record('fitBounds')(opts); },
    stop() { emit('moveend'); }, setMaxBounds: record('setMaxBounds'), setMinZoom: record('setMinZoom'), setFog() {},
    getZoom: () => 16.4, getBearing: () => 0, setConfigProperty(_scope: string, key: string, value: any) { record('config')({ key, value }); },
    getConfigProperty: () => true, setPaintProperty() {}, setLayoutProperty() {},
    addSource: (id: string, s: any) => { sources[id] = { data: s.data, setData(d) { this.data = d; }, getClusterExpansionZoom() {} }; },
    getSource: (id: string) => sources[id], addLayer() {}, getLayer: () => true, setStyle() {},
    querySourceFeatures: (id: string) => (sources[id]?.data.features ?? []),
  };
  class Marker { el: any; constructor(o: any) { this.el = o.element; } setLngLat() { return this; } addTo() { return this; } remove() {} getElement() { return this.el; } }
  const listeners: Record<string, (e: unknown) => void> = {};
  const win: any = {
    ReactNativeWebView: { postMessage: (m: string) => messages.push(JSON.parse(m)) },
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    matchMedia: () => ({ matches: reduced }), parent: null,
    mapboxgl: { supported: () => true, Map: function (opts: any) { options = opts; return map; }, Marker, AttributionControl: function () {}, LngLatBounds: function () { return { extend() {} }; } },
  };
  win.parent = win;
  const ctx = vm.createContext({ window: win, mapboxgl: win.mapboxgl, document: { createElement: el, addEventListener() {}, body: { classList: { toggle: record('bodyClass') } } },
    setTimeout(fn: () => void, ms: number) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id: number) { timers.delete(id); }, setInterval: () => 0, clearInterval() {}, JSON, Math, Object, String, console });
  new vm.Script(scriptOf(mapHtml('pk.test-token', { flyIn }))).runInContext(ctx);
  return { messages, calls, options, emit, created, sources,
    command: (data: unknown) => listeners.message({ data: JSON.stringify(data) }),
    runTimers(ms: number) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
  };
}

const place = { id: 'building-11', name: 'Building 11', number: '11', category: 'academic', schools: ['sba'], coordinates: [-5.108, 33.539], status: 'open' };

test('the page reports ready, renders pins and forwards a pin tap to React Native', () => {
  const h = mapHarness({ flyIn: false });
  h.emit('style.load');
  assert.ok(h.messages.some(m => m.type === 'ready'));
  h.command({ type: 'places', places: [place] });
  h.emit('render');
  const pin = h.created.find(c => c.className.split(' ')[0] === 'pin');
  assert.ok(pin, 'a pin element was created');
  pin.onclick!({ stopPropagation() {} });
  assert.deepEqual(h.messages.at(-1), { type: 'select', detail: 'building-11' });
});

test('arrival starts at the planet, ignores initial follow reset, and ends once at campus', () => {
  const h = mapHarness();
  assert.equal(h.options.projection, 'globe');
  assert.ok(h.options.zoom < 1);
  h.emit('style.load');
  h.command({ type: 'follow', on: false });
  assert.equal(h.calls.filter(c => c.name === 'easeTo').length, 0);
  h.emit('load');
  assert.equal(h.calls.filter(c => c.name === 'flyTo').length, 0, 'globe is held before the descent');
  h.runTimers(850);
  const flight = h.calls.find(c => c.name === 'flyTo')!;
  assert.deepEqual(Array.from(flight.args.center), CAMPUS_CENTER);
  assert.equal(flight.args.zoom, 16.4);
  h.emit('moveend');
  h.emit('touchstart');
  assert.equal(h.messages.filter(m => m.type === 'flyInDone').length, 1);
  assert.equal(h.calls.filter(c => c.name === 'setMinZoom').at(-1)?.args, 14.2);
});

test('skipping before or during arrival cancels the flight without restarting it', () => {
  for (const during of [false, true]) {
    const h = mapHarness();
    h.emit('style.load'); h.emit('load');
    if (during) h.runTimers(850);
    h.command({ type: 'skipIntro' });
    h.runTimers(850); h.emit('moveend'); h.command({ type: 'skipIntro' });
    assert.equal(h.messages.filter(m => m.type === 'flyInDone').length, 1);
    assert.equal(h.calls.filter(c => c.name === 'flyTo').length, during ? 1 : 0);
    assert.equal(h.calls.filter(c => c.name === 'jumpTo').at(-1)?.args.zoom, 16.4);
  }
});

test('reduced motion and disabled intro land immediately and still signal arrival', () => {
  for (const opts of [{ reduced: true }, { flyIn: false }]) {
    const h = mapHarness(opts);
    assert.equal(h.options.zoom, 16.4);
    h.emit('style.load'); h.emit('load'); h.runTimers(850);
    assert.equal(h.calls.filter(c => c.name === 'flyTo').length, 0);
    assert.equal(h.messages.filter(m => m.type === 'flyInDone').length, 1);
  }
});

test('tour filters real places and leaves room for its card; building tint survives style reload', () => {
  const h = mapHarness({ flyIn: false });
  h.emit('style.load'); h.emit('load');
  h.command({ type: 'places', places: [place, { ...place, id: 'food', category: 'dining' }] });
  const padding = { top: 100, bottom: 340, left: 40, right: 40 };
  h.command({ type: 'filter', category: 'dining', school: 'all', fit: true, padding });
  assert.equal(h.sources.places.data.features.length, 1);
  assert.equal(h.sources.places.data.features[0].properties.id, 'food');
  assert.equal(h.calls.find(c => c.name === 'fitBounds')?.args.padding.bottom, 340);
  h.command({ type: 'filter', category: 'all', school: 'all' });
  assert.equal(h.sources.places.data.features.length, 2);
  h.emit('style.load');
  const tints = h.calls.filter(c => c.name === 'config' && c.args.key === 'colorBuildings');
  assert.equal(tints.length, 2);
  assert.equal(tints[1].args.value, '#C4C1BA');
});
