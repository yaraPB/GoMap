import type { LineString, Position } from 'geojson';
import { projector, projectOnSegment, type Edge, type Graph } from './graph.js';

export type RouteMode = 'walk' | 'step_free' | 'drive';
export type Turn = 'depart' | 'straight' | 'slight left' | 'slight right' | 'left' | 'right' | 'sharp left' | 'sharp right' | 'arrive';
export type Step = {
  turn: Turn; distance_m: number; text: string; at: Position; bearing: number;
  crossing: boolean; stairs: boolean; on: string | null; kind: Edge['kind'];
};
export type RouteResult = {
  mode: RouteMode; distance_m: number; duration_s: number;
  geometry: LineString; steps: Step[];
  /** where the route leaves a footpath for a road, or crosses one: the design's crossing markers */
  crossings: Position[];
  uses_roads: boolean;
  segments: Segment[];
  /** slope, estimated from 10 m contours (max_grade in %); null when there is no terrain data */
  slope: { climb_m: number; descent_m: number; max_grade: number; steep_m: number } | null;
};
/**
 * One stretch of the route drawn in one style: on a footpath, walking along a road cars use,
 * on stairs, or in the car. `steep`: steeper than a wheelchair ramp may be.
 */
export type Segment = { kind: 'path' | 'road' | 'stairs' | 'drive'; steep: boolean; coordinates: Position[] };

/** Up to 5 %: no ramp needed. 8.3 % (1:12): the steepest a wheelchair ramp may be. */
export const GENTLE = 0.05;
export const STEEP = 0.083;

/** Grade of an edge walked away from node `from` (+ uphill), 0 when the height is unknown. */
export function gradeFrom(edge: Edge, from: number | null): number {
  if (edge.rise == null) return 0;
  const g = edge.rise / Math.max(edge.length, 1);
  return from === edge.b ? -g : g;
}
/**
 * Tobler's hiking function, relative to the flat: 1 on level ground, 1.42 at +10 %, 0.84 at its
 * fastest (a gentle 5 % descent), slower again on steep descents.
 */
export function walkSlowdown(grade: number) {
  const g = Math.max(-0.4, Math.min(0.4, grade));
  return Math.exp(3.5 * (Math.abs(g + 0.05) - 0.05));
}
const FASTEST = walkSlowdown(-0.05);
/**
 * Wheelchairs, strollers, crutches: up or down, a slope over 5 % is hard and over 8 % is more than
 * any ramp. Heights are estimates, so steep paths are avoided hard but never forbidden.
 */
export function wheelSlowdown(grade: number) {
  const a = Math.abs(grade);
  if (a <= GENTLE) return 1;
  if (a <= STEEP) return 1 + (a - GENTLE) * 30;
  if (a <= 0.12) return 5;
  return 14;
}

// Average adult walking pace is ~1.3–1.4 m/s on the flat. Ifrane sits at 1,650 m and the campus is
// hilly, so we use 1.25 m/s, slower on stairs, plus a pause at each road crossing. Step-free (wheelchair,
// stroller) ~1.0 m/s. Driving on campus roads: 20 km/h.
const SPEED: Record<RouteMode, number> = { walk: 1.25, step_free: 1.0, drive: 5.5 };
const STAIRS_SPEED = 0.55;     // m/s of horizontal distance on a flight of steps
const CROSSING_S = 8;          // look both ways, wait for a car
const ARRIVAL_S = 20;          // last metres to the door and inside

/** Realistic time for the average person, not just distance ÷ speed. */
export function walkSeconds(legs: { kind: string; length: number; grade?: number }[], crossings: number, mode: RouteMode) {
  if (mode === 'drive') return legs.reduce((t, l) => t + l.length / SPEED.drive, 0) + 30; // + parking
  // uphill slows everyone (Tobler); pushing a wheelchair up or holding it back down a steep stretch, more so
  const moving = legs.reduce((t, l) => t + (l.kind === 'stairs' && mode === 'walk' ? l.length / STAIRS_SPEED
    : l.length / SPEED[mode] * walkSlowdown(l.grade ?? 0) * (mode === 'step_free' ? Math.min(2, Math.max(1, Math.abs(l.grade ?? 0) / GENTLE)) : 1)), 0);
  return moving + crossings * CROSSING_S + ARRIVAL_S;
}
const ROAD_COST: Record<string, number> = { service: 1.25, street: 1.3, residential: 1.3, track: 1.2, street_limited: 1.2,
  tertiary: 1.6, tertiary_link: 1.6, secondary: 2.2, primary: 2.8, primary_link: 2.8 };

/**
 * How expensive an edge is for this mode, or Infinity if not allowed. `from`: the node it is
 * entered from, so uphill costs more than downhill; without it the uphill way is assumed.
 *  - walk: about the time it takes: campus paths before roads with cars, hills slow you down
 *  - step_free: never stairs; slopes past 5 % cost more, past a ramp's 8 % much more
 *  - drive: roads only
 */
export function edgeCost(edge: Edge, mode: RouteMode, closed: Set<string>, from: number | null = null): number {
  if (closed.has(edge.id)) return Infinity;
  if (mode === 'drive') return edge.modes === 'walk' ? Infinity : edge.length;
  if (edge.modes === 'drive') return Infinity;
  if (mode === 'step_free' && (!edge.stepFree || edge.kind === 'stairs')) return Infinity;
  let cost = edge.length;
  if (edge.kind === 'road') cost *= ROAD_COST[edge.roadClass ?? ''] ?? 1.4;
  if (edge.kind === 'stairs') return cost * 1.15;
  const grade = from == null ? Math.abs(gradeFrom(edge, edge.a)) : gradeFrom(edge, from);
  return cost * (mode === 'step_free' ? wheelSlowdown(grade) : walkSlowdown(grade));
}
/** The cheapest a metre can ever cost in this mode (keeps the A* estimate a lower bound). */
const MIN_COST_PER_M: Record<RouteMode, number> = { walk: FASTEST, step_free: 1, drive: 1 };

export type Snap = { edge: number; point: Position; offsetA: number; offsetB: number; distance: number };

/** Nearest usable edge to a coordinate. Routes start from the snapped point, not a node. */
export function snap(graph: Graph, coord: Position, mode: RouteMode, closed: Set<string>, maxDistance = 400): Snap | null {
  const { toXY, toLL } = projector(graph.origin);
  const p = toXY(coord);
  let best: Snap | null = null;
  graph.edges.forEach((edge, i) => {
    if (!Number.isFinite(edgeCost(edge, mode, closed))) return;
    const a = graph.nodes[edge.a].xy, b = graph.nodes[edge.b].xy;
    const hit = projectOnSegment(p, a, b);
    if (hit.distance > maxDistance || (best && hit.distance >= best.distance)) return;
    best = { edge: i, point: toLL(hit.point), offsetA: hit.t * edge.length, offsetB: (1 - hit.t) * edge.length, distance: hit.distance };
  });
  return best;
}

class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(node: number, priority: number) {
    const a = this.items; a.push([node, priority]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][1] <= a[i][1]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): number {
    const a = this.items; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top[0];
  }
}

/**
 * A* from a snapped start to any of several target nodes (a building's entrances).
 * Returns the node path, or null when the closures or the mode leave no way through.
 */
export function shortestPath(graph: Graph, start: Snap, targets: number[], mode: RouteMode, closed: Set<string>) {
  const targetSet = new Set(targets);
  if (!targetSet.size) return null;
  const tXY = targets.map(t => graph.nodes[t].xy);
  const h = (n: number) => { const p = graph.nodes[n].xy; return MIN_COST_PER_M[mode] * Math.min(...tXY.map(t => Math.hypot(p[0] - t[0], p[1] - t[1]))); };
  const g = new Map<number, number>(), prev = new Map<number, { node: number; edge: number } | null>();
  const heap = new Heap();
  const se = graph.edges[start.edge];
  // heading to a, the edge is walked from the b side, and the other way round
  for (const [node, off, from] of [[se.a, start.offsetA, se.b], [se.b, start.offsetB, se.a]] as const) {
    const cost = off * edgeCost(se, mode, closed, from) / Math.max(se.length, 1e-6);
    if (cost < (g.get(node) ?? Infinity)) { g.set(node, cost); prev.set(node, null); heap.push(node, cost + h(node)); }
  }
  const done = new Set<number>();
  while (heap.size) {
    const n = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    if (targetSet.has(n)) {
      const path: { node: number; edge: number | null }[] = [];
      let cur: number | undefined = n;
      while (cur !== undefined) {
        const p = prev.get(cur);
        path.unshift({ node: cur, edge: p ? p.edge : null });
        cur = p ? p.node : undefined;
      }
      return { path, cost: g.get(n)! };
    }
    for (const ei of graph.nodes[n].edges) {
      const edge = graph.edges[ei];
      const c = edgeCost(edge, mode, closed, n);
      if (!Number.isFinite(c)) continue;
      const m = edge.a === n ? edge.b : edge.a;
      const cost = g.get(n)! + c;
      if (cost < (g.get(m) ?? Infinity)) { g.set(m, cost); prev.set(m, { node: n, edge: ei }); heap.push(m, cost + h(m)); }
    }
  }
  return null;
}

// ── maneuvers ───────────────────────────────────────────────────────────────

const toRad = Math.PI / 180;
export function bearing(a: Position, b: Position) {
  const φ1 = a[1] * toRad, φ2 = b[1] * toRad, Δλ = (b[0] - a[0]) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}
export function haversine(a: Position, b: Position) {
  const φ1 = a[1] * toRad, φ2 = b[1] * toRad;
  const s = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((b[0] - a[0]) * toRad / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
export function turnFor(delta: number): Turn {
  const d = Math.abs(delta);
  if (d < 25) return 'straight';
  const side = delta > 0 ? 'right' : 'left';
  if (d < 55) return `slight ${side}` as Turn;
  if (d < 130) return side;
  return `sharp ${side}` as Turn;
}

/** `junction`: the leg starts at a node where the walker has a real choice (3+ usable ways). */
/** `fromNode`: the node the leg is walked away from (for its slope); `node`: same, but null on the first leg (no junction there). */
type Leg = { from: Position; to: Position; edge: Edge; junction: boolean; node: number | null; edgeIndex: number | null; fromNode: number };

const side = (t: Turn) => (t.includes('left') ? 'left' : 'right');

function describe(turn: Turn, leg: Leg, crossingRoad: boolean): string {
  const on = leg.edge.name && leg.edge.kind === 'road' ? ` onto ${leg.edge.name}` : '';
  const verb = turn === 'straight' ? '' : turn.startsWith('slight') ? `Keep ${side(turn)} and ` : `Turn ${side(turn)} and `;
  if (leg.edge.kind === 'stairs') return turn === 'straight' ? 'Take the stairs' : `${verb}take the stairs`;
  if (crossingRoad || leg.edge.kind === 'crossing') return turn === 'straight' ? 'Cross the road' : `${verb}cross the road`;
  if (leg.edge.kind === 'ramp') return turn === 'straight' ? 'Take the ramp' : `${verb}take the ramp`;
  if (turn.startsWith('slight')) return `Keep ${side(turn)}${on}`;
  if (turn.startsWith('sharp')) return `Turn sharp ${side(turn)}${on}`;
  return `Turn ${turn}${on}`;
}

export function buildRoute(graph: Graph, start: Snap, startCoord: Position, path: { node: number; edge: number | null }[], end: Position | null, mode: RouteMode): RouteResult {
  const closedNone = new Set<string>();
  const usableDegree = (n: number) => graph.nodes[n].edges.filter(e => Number.isFinite(edgeCost(graph.edges[e], mode, closedNone))).length;
  const legs: Leg[] = [];
  const se = graph.edges[start.edge];
  if (path.length) legs.push({ from: start.point, to: graph.nodes[path[0].node].coord, edge: se, junction: false, node: null, edgeIndex: start.edge, fromNode: path[0].node === se.a ? se.b : se.a });
  for (let i = 1; i < path.length; i++) {
    legs.push({ from: graph.nodes[path[i - 1].node].coord, to: graph.nodes[path[i].node].coord, edge: graph.edges[path[i].edge!], junction: usableDegree(path[i - 1].node) >= 3, node: path[i - 1].node, edgeIndex: path[i].edge, fromNode: path[i - 1].node });
  }
  const real = legs.filter(l => haversine(l.from, l.to) > 0.3);

  const coords: Position[] = [startCoord];
  if (haversine(startCoord, start.point) > 0.5) coords.push(start.point);
  for (const l of real) coords.push(l.to);
  if (end) coords.push(end);

  // crossings: an explicit crossing, or a short stretch of road between two footpaths
  const crossings: Position[] = [];
  const crossingLeg = new Set<number>();
  real.forEach((l, i) => {
    if (l.edge.kind === 'crossing') { crossings.push(l.from); crossingLeg.add(i); return; }
    if (mode === 'drive' || l.edge.kind !== 'road' || real[i - 1]?.edge.kind === 'road') return;
    let j = i, len = 0;
    while (j < real.length && real[j].edge.kind === 'road') { len += real[j].edge.length; j++; }
    if (real[i - 1]?.edge.modes === 'walk' && real[j]?.edge.modes === 'walk' && len < 25) { crossings.push(l.from); crossingLeg.add(i); }
  });

  // Bearing over ~12 m either side of a node, so short wiggles in the geometry don't count as turns.
  const headingInto = (i: number) => {
    let k = i - 1, len = 0;
    while (k > 0 && len + haversine(real[k].from, real[k].to) < 12) { len += haversine(real[k].from, real[k].to); k--; }
    return bearing(real[Math.max(0, k)].from, real[i - 1].to);
  };
  const headingOut = (i: number) => {
    let k = i, len = 0;
    while (k < real.length - 1 && len + haversine(real[k].from, real[k].to) < 12) { len += haversine(real[k].from, real[k].to); k++; }
    return bearing(real[i].from, real[k].to);
  };

  const steps: Step[] = [];
  real.forEach((leg, i) => {
    const len = haversine(leg.from, leg.to);
    const prev = steps.at(-1);
    const crossing = crossingLeg.has(i);
    const stairs = leg.edge.kind === 'stairs' && prev?.kind !== 'stairs';
    const roadChange = mode === 'drive' && !!prev && !!leg.edge.name && leg.edge.name !== prev.on;
    let turn: Turn = 'depart';
    if (i > 0) {
      const delta = ((headingOut(i) - headingInto(i) + 540) % 360) - 180;
      // A bend with no other way to go is not an instruction. Only junctions get one.
      turn = leg.junction ? turnFor(delta) : 'straight';
      // Taking the straightest exit at a fork is not an instruction either.
      if (leg.junction && Math.abs(delta) < 55 && leg.node != null) {
        const inH = headingInto(i);
        const node = graph.nodes[leg.node];
        const prevEdge = real[i - 1]?.edgeIndex;
        const others = node.edges.filter(e => e !== leg.edgeIndex && e !== prevEdge && Number.isFinite(edgeCost(graph.edges[e], mode, closedNone)))
          .map(e => { const ed = graph.edges[e]; const other = graph.nodes[ed.a === leg.node ? ed.b : ed.a].coord; return Math.abs(((bearing(node.coord, other) - inH + 540) % 360) - 180); });
        if (others.every(o => o > Math.abs(delta) + 15)) turn = 'straight';
      }
    }
    if (prev && turn === 'straight' && !crossing && !stairs && !roadChange) { prev.distance_m += len; return; }
    steps.push({
      turn, distance_m: len, at: leg.from, bearing: Math.round(bearing(leg.from, leg.to)), crossing, stairs: leg.edge.kind === 'stairs',
      on: leg.edge.name, kind: leg.edge.kind,
      text: turn === 'depart' ? (leg.edge.kind === 'road' ? `Head along the road${leg.edge.name ? ` (${leg.edge.name})` : ''}` : 'Head along the path')
        : turn === 'straight' && roadChange ? `Continue onto ${leg.edge.name}` : describe(turn, leg, crossing),
    });
  });
  // fold sub-6 m steps into their neighbour so nobody hears "turn left in 3 m"
  const tidy: Step[] = [];
  for (const s of steps) {
    const last = tidy.at(-1);
    if (last && s.distance_m < 6 && !s.crossing && !s.stairs) { last.distance_m += s.distance_m; continue; }
    tidy.push(s);
  }

  // Arrival: which side the door is on, relative to the last direction of travel.
  const lastOnNetwork = real.length ? real.at(-1)!.to : start.point;
  const finalPoint = end ?? lastOnNetwork;
  let arriveText = 'You have arrived';
  if (end && real.length && haversine(lastOnNetwork, end) > 2) {
    if (tidy.length) tidy.at(-1)!.distance_m += haversine(lastOnNetwork, end);
    const travel = bearing(real.at(-1)!.from, real.at(-1)!.to);
    const toDoor = bearing(lastOnNetwork, end);
    const d = ((toDoor - travel + 540) % 360) - 180;
    arriveText = Math.abs(d) < 30 ? 'The entrance is ahead' : `The entrance is on your ${d > 0 ? 'right' : 'left'}`;
  }
  tidy.push({ turn: 'arrive', distance_m: 0, at: finalPoint, bearing: tidy.at(-1)?.bearing ?? 0, crossing: false, stairs: false, on: null, kind: 'walkway', text: arriveText });
  for (const s of tidy) s.distance_m = Math.round(s.distance_m);

  const distance = real.reduce((s, l) => s + haversine(l.from, l.to), 0) + haversine(startCoord, start.point) + (end ? haversine(lastOnNetwork, end) : 0);
  const lens = real.map(l => haversine(l.from, l.to));
  const grades = real.map(l => gradeFrom(l.edge, l.fromNode));
  const { slope, steep } = slopeOf(real, lens, grades, mode);

  // the route in drawable stretches: car, footpath, road shared with cars, stairs; steep marked
  const segments: Segment[] = [];
  const addSeg = (kind: Segment['kind'], isSteep: boolean, a: Position, b: Position) => {
    const last = segments.at(-1);
    if (last && last.kind === kind && last.steep === isSteep) last.coordinates.push(b);
    else segments.push({ kind, steep: isSteep, coordinates: [a, b] });
  };
  const kindOf = (e: Edge): Segment['kind'] => (mode === 'drive' ? 'drive' : e.kind === 'stairs' ? 'stairs' : e.kind === 'road' ? 'road' : 'path');
  if (haversine(startCoord, start.point) > 0.5) addSeg(mode === 'drive' ? 'drive' : 'path', false, startCoord, start.point);
  real.forEach((l, i) => addSeg(kindOf(l.edge), steep[i], l.from, l.to));
  if (end) addSeg(mode === 'drive' ? 'drive' : 'path', false, lastOnNetwork, end);

  return {
    mode, distance_m: Math.round(distance),
    duration_s: Math.round(walkSeconds([...real.map((l, i) => ({ kind: l.edge.kind, length: lens[i], grade: grades[i] })), { kind: 'walkway', length: distance - lens.reduce((s, x) => s + x, 0) }], crossings.length, mode)),
    geometry: { type: 'LineString', coordinates: coords }, steps: tidy, crossings,
    uses_roads: real.some(l => l.edge.kind === 'road'),
    segments, slope,
  };
}

/**
 * Climb, descent and the steepest stretch. Grades are read over stretches of at least 15 m, so
 * one noisy metre between two contour lines does not turn into a "hill".
 */
function slopeOf(real: Leg[], lens: number[], grades: number[], mode: RouteMode) {
  const steep = real.map(() => false);
  if (mode === 'drive' || !real.some(l => l.edge.rise != null)) return { slope: null, steep };
  let climb = 0, descent = 0, maxGrade = 0, steepM = 0;
  let from = 0;
  while (from < real.length) {
    let to = from, len = 0, rise = 0;
    // stairs are their own stretch: their slope is the stairs, not the hill
    while (to < real.length && (len < 15 || to === from) && (real[to].edge.kind === 'stairs') === (real[from].edge.kind === 'stairs')) { len += lens[to]; rise += grades[to] * lens[to]; to++; }
    if (rise > 0) climb += rise; else descent -= rise;
    const g = len > 0 ? Math.abs(rise / len) : 0;
    if (real[from].edge.kind !== 'stairs') {
      if (len >= 8) maxGrade = Math.max(maxGrade, g);
      if (g > STEEP) { steepM += len; for (let k = from; k < to; k++) steep[k] = true; }
    }
    from = to;
  }
  return { slope: { climb_m: Math.round(climb), descent_m: Math.round(descent), max_grade: Math.round(maxGrade * 1000) / 10, steep_m: Math.round(steepM) }, steep };
}

/** Of every node reachable from `start` (closures and mode respected), the one closest to `coord`. */
export function nearestReachable(graph: Graph, start: Snap, coord: Position, mode: RouteMode, closed: Set<string>): number | null {
  const { toXY } = projector(graph.origin);
  const p = toXY(coord);
  const se = graph.edges[start.edge];
  const seen = new Set<number>([se.a, se.b]);
  const stack = [se.a, se.b];
  let best: { node: number; d: number } | null = null;
  while (stack.length) {
    const n = stack.pop()!;
    const d = Math.hypot(graph.nodes[n].xy[0] - p[0], graph.nodes[n].xy[1] - p[1]);
    if (!best || d < best.d) best = { node: n, d };
    for (const ei of graph.nodes[n].edges) {
      const e = graph.edges[ei];
      if (!Number.isFinite(edgeCost(e, mode, closed))) continue;
      const m = e.a === n ? e.b : e.a;
      if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
  }
  return best?.node ?? null;
}

/** Nearest node usable by this mode. Used to attach entrances to the network. */
export function nearestNode(graph: Graph, coord: Position, mode: RouteMode, closed: Set<string> = new Set()) {
  const s = snap(graph, coord, mode, closed);
  if (!s) return null;
  const e = graph.edges[s.edge];
  return s.offsetA <= s.offsetB ? e.a : e.b;
}
