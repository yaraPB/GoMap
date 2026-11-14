/**
 * The walkway graph. Built in memory at boot from the walkways collection.
 *
 * Hand-drawn and tile-derived lines rarely share exact points, so before building edges we:
 *   1. snap a line END that stops within TOLERANCE of another line's middle (a T-junction),
 *      splitting that other line there;
 *   2. split two lines where they cross each other (a path crossing a road);
 *   3. merge every vertex closer than TOLERANCE into one node.
 * Spatial work uses a local metric projection (accurate to centimetres at campus scale) and a
 * grid index, so this stays fast even with thousands of vertices.
 */
import type { Position } from 'geojson';
import type { WayFeature, WayKind, WayModes } from '../geo/types.js';

export const TOLERANCE_M = 3;

export type Edge = {
  id: string;            // `${wayId}:${segmentIndex}`
  wayId: string;
  a: number; b: number;  // node indices
  length: number;        // metres
  kind: WayKind;
  modes: WayModes;
  stepFree: boolean;
  roadClass: string | null;
  name: string | null;
};
export type Node = { id: number; coord: Position; xy: [number, number]; edges: number[] };
export type Graph = { nodes: Node[]; edges: Edge[]; origin: Position };

// ── local projection ────────────────────────────────────────────────────────

export function projector(origin: Position) {
  const kx = 111320 * Math.cos(origin[1] * Math.PI / 180), ky = 110540;
  return {
    toXY: (c: Position): [number, number] => [(c[0] - origin[0]) * kx, (c[1] - origin[1]) * ky],
    toLL: (p: [number, number]): Position => [Number((p[0] / kx + origin[0]).toFixed(7)), Number((p[1] / ky + origin[1]).toFixed(7))],
  };
}
const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Closest point on segment pq to r, with t in [0,1] along the segment. */
export function projectOnSegment(r: [number, number], p: [number, number], q: [number, number]) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / len2));
  const point: [number, number] = [p[0] + t * dx, p[1] + t * dy];
  return { t, point, distance: dist(r, point) };
}

function segmentIntersection(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null; // touching at ends is handled by the merge
  return { t, u, point: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] as [number, number] };
}

// ── grid index ──────────────────────────────────────────────────────────────

class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(private size: number) {}
  private key(x: number, y: number) { return `${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`; }
  insertBox(minX: number, minY: number, maxX: number, maxY: number, item: T) {
    for (let x = Math.floor(minX / this.size); x <= Math.floor(maxX / this.size); x++)
      for (let y = Math.floor(minY / this.size); y <= Math.floor(maxY / this.size); y++) {
        const k = `${x}:${y}`;
        const list = this.cells.get(k);
        if (list) list.push(item); else this.cells.set(k, [item]);
      }
  }
  near(x: number, y: number, radius: number): T[] {
    const out = new Set<T>();
    for (let gx = Math.floor((x - radius) / this.size); gx <= Math.floor((x + radius) / this.size); gx++)
      for (let gy = Math.floor((y - radius) / this.size); gy <= Math.floor((y + radius) / this.size); gy++)
        for (const item of this.cells.get(`${gx}:${gy}`) ?? []) out.add(item);
    return [...out];
  }
  boxKey(x: number, y: number) { return this.key(x, y); }
}

// ── build ───────────────────────────────────────────────────────────────────

type Line = { feature: WayFeature; xy: [number, number][]; splits: Map<number, { t: number; xy: [number, number] }[]> };

/** Bridges and tunnels are not marked in the mock data; walk-only paths never junction with motorways. */
const canJoin = (a: WayFeature, b: WayFeature) => !(a.properties.modes === 'drive' && b.properties.modes === 'walk')
  && !(a.properties.modes === 'walk' && b.properties.modes === 'drive');

export function buildGraph(features: WayFeature[], origin?: Position): Graph {
  const first = features[0]?.geometry.coordinates[0] ?? [0, 0];
  const o = origin ?? first;
  const { toXY, toLL } = projector(o);
  const lines: Line[] = features.map(feature => ({ feature, xy: feature.geometry.coordinates.map(toXY), splits: new Map() }));

  // segment index
  type SegRef = { line: number; seg: number };
  const segGrid = new Grid<SegRef>(25);
  lines.forEach((line, li) => {
    for (let s = 0; s < line.xy.length - 1; s++) {
      const [p, q] = [line.xy[s], line.xy[s + 1]];
      segGrid.insertBox(Math.min(p[0], q[0]) - TOLERANCE_M, Math.min(p[1], q[1]) - TOLERANCE_M,
        Math.max(p[0], q[0]) + TOLERANCE_M, Math.max(p[1], q[1]) + TOLERANCE_M, { line: li, seg: s });
    }
  });
  const addSplit = (line: Line, seg: number, t: number, xy: [number, number]) => {
    const list = line.splits.get(seg) ?? [];
    if (!list.some(s => Math.abs(s.t - t) < 1e-6)) list.push({ t, xy });
    line.splits.set(seg, list);
  };

  // 1. T-junctions: an end lands on another line's segment interior
  lines.forEach((line, li) => {
    for (const endIndex of [0, line.xy.length - 1]) {
      const end = line.xy[endIndex];
      let best: { ref: SegRef; t: number; xy: [number, number]; d: number } | null = null;
      for (const ref of segGrid.near(end[0], end[1], TOLERANCE_M)) {
        if (ref.line === li) continue;
        const other = lines[ref.line];
        if (!canJoin(line.feature, other.feature)) continue;
        const { t, point, distance } = projectOnSegment(end, other.xy[ref.seg], other.xy[ref.seg + 1]);
        if (distance >= TOLERANCE_M || t <= 0.001 || t >= 0.999) continue; // vertex-to-vertex is the merge's job
        if (!best || distance < best.d) best = { ref, t, xy: point, d: distance };
      }
      if (best) {
        addSplit(lines[best.ref.line], best.ref.seg, best.t, best.xy);
        line.xy[endIndex] = best.xy; // pull the end exactly onto the line
      }
    }
  });

  // 2. crossings in the middle of two segments
  const seen = new Set<string>();
  lines.forEach((line, li) => {
    for (let s = 0; s < line.xy.length - 1; s++) {
      const [p, q] = [line.xy[s], line.xy[s + 1]];
      for (const ref of segGrid.near((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, dist(p, q) / 2 + TOLERANCE_M)) {
        if (ref.line === li) continue;
        const pair = li < ref.line ? `${li}:${s}|${ref.line}:${ref.seg}` : `${ref.line}:${ref.seg}|${li}:${s}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        const other = lines[ref.line];
        if (!canJoin(line.feature, other.feature)) continue;
        const hit = segmentIntersection(p, q, other.xy[ref.seg], other.xy[ref.seg + 1]);
        if (!hit) continue;
        addSplit(line, s, hit.t, hit.point);
        addSplit(other, ref.seg, hit.u, hit.point);
      }
    }
  });

  // 3. merge vertices into nodes, emit edges
  const nodes: Node[] = [];
  const nodeGrid = new Grid<number>(TOLERANCE_M * 2);
  const nodeFor = (xy: [number, number]) => {
    let best = -1, bestD = TOLERANCE_M;
    for (const id of nodeGrid.near(xy[0], xy[1], TOLERANCE_M)) {
      const d = dist(xy, nodes[id].xy);
      if (d < bestD) { best = id; bestD = d; }
    }
    if (best >= 0) return best;
    const id = nodes.length;
    nodes.push({ id, coord: toLL(xy), xy, edges: [] });
    nodeGrid.insertBox(xy[0], xy[1], xy[0], xy[1], id);
    return id;
  };

  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  for (const line of lines) {
    const pts: [number, number][] = [];
    line.xy.forEach((p, s) => {
      pts.push(p);
      const splits = line.splits.get(s);
      if (splits && s < line.xy.length - 1) for (const sp of [...splits].sort((m, n) => m.t - n.t)) pts.push(sp.xy);
    });
    const props = line.feature.properties;
    let segIndex = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = nodeFor(pts[i]), b = nodeFor(pts[i + 1]);
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edgeKeys.has(key)) continue; // the same stretch drawn twice
      edgeKeys.add(key);
      const edge: Edge = {
        id: `${props.id}:${segIndex++}`, wayId: props.id, a, b,
        length: dist(nodes[a].xy, nodes[b].xy),
        kind: props.kind, modes: props.modes, stepFree: props.step_free,
        roadClass: props.road_class, name: props.name,
      };
      nodes[a].edges.push(edges.length);
      nodes[b].edges.push(edges.length);
      edges.push(edge);
    }
  }
  return { nodes, edges, origin: o };
}

// ── diagnostics (npm run graph:check) ───────────────────────────────────────

export function components(graph: Graph) {
  const comp = new Array<number>(graph.nodes.length).fill(-1);
  const sizes: number[] = [];
  for (const start of graph.nodes) {
    if (comp[start.id] >= 0) continue;
    const c = sizes.length; let size = 0;
    const stack = [start.id]; comp[start.id] = c;
    while (stack.length) {
      const n = stack.pop()!; size++;
      for (const e of graph.nodes[n].edges) {
        const edge = graph.edges[e];
        const m = edge.a === n ? edge.b : edge.a;
        if (comp[m] < 0) { comp[m] = c; stack.push(m); }
      }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

export function graphReport(graph: Graph, entranceNodes: Set<number> = new Set()) {
  const { sizes } = components(graph);
  const dangling = graph.nodes.filter(n => n.edges.length === 1 && !entranceNodes.has(n.id));
  const total = graph.edges.reduce((s, e) => s + e.length, 0);
  const largest = Math.max(0, ...sizes);
  return [
    `graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${(total / 1000).toFixed(2)} km`,
    `  connected pieces: ${sizes.length} (largest holds ${graph.nodes.length ? Math.round(largest / graph.nodes.length * 100) : 0}% of nodes)`,
    `  dead ends that are not entrances: ${dangling.length}${dangling.length ? ' — e.g. ' + dangling.slice(0, 5).map(n => n.coord.join(',')).join('  ') : ''}`,
  ].join('\n');
}
