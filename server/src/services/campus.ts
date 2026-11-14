/**
 * Live routing state: the graph built from Mongo walkways, each place's entrances attached to
 * the network, and the set of edges closed by confirmed reports. `rebuild()` runs at boot and
 * whenever an admin confirms or resolves a closure, so the very next route avoids it.
 */
import type { Position } from 'geojson';
import { Entrance, Place, Report, Walkway } from '../db/mongo.js';
import type { WayFeature } from '../geo/types.js';
import { CAMPUS_CENTER } from '../geo/types.js';
import { buildGraph, graphReport, projector, projectOnSegment, type Graph } from '../routing/graph.js';
import { buildRoute, haversine, nearestNode, shortestPath, snap, type RouteMode, type RouteResult } from '../routing/route.js';

type EntranceInfo = { id: string; place_id: string; name: string; coord: Position; step_free: boolean; estimated: boolean; node: Record<RouteMode, number | null> };

export class Campus {
  graph: Graph = { nodes: [], edges: [], origin: CAMPUS_CENTER };
  closed = new Set<string>();
  entrances = new Map<string, EntranceInfo[]>();
  walkways: WayFeature[] = [];

  async rebuild() {
    const docs = await Walkway.find().lean();
    this.walkways = docs.map(d => ({
      type: 'Feature', geometry: d.geometry as WayFeature['geometry'],
      properties: { id: String(d._id), kind: d.kind, modes: d.modes, step_free: d.step_free ?? true, lit: d.lit ?? null, covered: d.covered ?? null, name: d.name ?? null, road_class: d.road_class ?? null, source: d.source },
    }) as WayFeature);
    this.graph = buildGraph(this.walkways, CAMPUS_CENTER);
    await this.ensureEntrances();
    await this.loadEntrances();
    await this.refreshClosures();
  }

  /** Every place gets at least one entrance. Until someone maps real doors, it is the point
   *  where the walkway network comes closest to the building, flagged as estimated. */
  private async ensureEntrances() {
    const places = await Place.find({}, { _id: 1, location: 1, footprint: 1 }).lean();
    const have = new Set((await Entrance.distinct('place_id')).map(String));
    const { toXY, toLL } = projector(this.graph.origin);
    const missing = places.filter(p => !have.has(String(p._id)));
    const docs = [];
    for (const p of missing) {
      const pin = p.location!.coordinates as Position;
      const s = snap(this.graph, pin, 'walk', new Set(), 250);
      let coord = s?.point ?? pin;
      // with a footprint, nudge from the path to the building edge (the door is on the wall)
      const ring = (p.footprint?.type === 'Polygon' ? (p.footprint.coordinates as Position[][])[0] : null);
      if (ring && s) {
        const at = toXY(s.point);
        let best: { point: [number, number]; distance: number } | null = null;
        for (let i = 0; i < ring.length - 1; i++) {
          const hit = projectOnSegment(at, toXY(ring[i]), toXY(ring[i + 1]));
          if (!best || hit.distance < best.distance) best = hit;
        }
        if (best && best.distance < 25) coord = toLL(best.point);
      }
      docs.push({ _id: `${p._id}-main`, place_id: String(p._id), name: 'Main entrance', location: { type: 'Point', coordinates: coord }, step_free: true, estimated: true });
    }
    if (docs.length) await Entrance.insertMany(docs);
  }

  private async loadEntrances() {
    this.entrances.clear();
    for (const e of await Entrance.find().lean()) {
      const coord = e.location!.coordinates as Position;
      const info: EntranceInfo = {
        id: String(e._id), place_id: e.place_id, name: e.name, coord, step_free: e.step_free ?? true, estimated: e.estimated ?? true,
        node: { walk: nearestNode(this.graph, coord, 'walk'), step_free: nearestNode(this.graph, coord, 'step_free'), drive: nearestNode(this.graph, coord, 'drive') },
      };
      this.entrances.set(e.place_id, [...(this.entrances.get(e.place_id) ?? []), info]);
    }
  }

  /** Confirmed, currently-active closures block every edge within their radius. */
  async refreshClosures(now = new Date()) {
    const iso = now.toISOString();
    const active = await Report.find({ status: 'confirmed', closure: { $ne: null } }).lean();
    const { toXY } = projector(this.graph.origin);
    const closed = new Set<string>();
    for (const r of active) {
      const c = r.closure!;
      if ((c.from && c.from > iso) || (c.until && c.until < iso)) continue;
      const p = toXY(r.location!.coordinates as Position);
      const radius = c.radius_m ?? 15;
      for (const e of this.graph.edges) {
        if (projectOnSegment(p, this.graph.nodes[e.a].xy, this.graph.nodes[e.b].xy).distance <= radius) closed.add(e.id);
      }
    }
    this.closed = closed;
  }

  route(from: Position, to: { placeId?: string; coord?: Position }, mode: RouteMode): (RouteResult & { destination: { place_id: string | null; entrance: string | null; entrance_estimated: boolean; step_free: boolean } }) | { error: string; status: number } {
    const start = snap(this.graph, from, mode, this.closed);
    if (!start) return { error: 'You seem to be off campus or away from any mapped path.', status: 422 };
    let targets: { node: number; entrance: EntranceInfo | null; coord: Position }[] = [];
    if (to.placeId) {
      const list = (this.entrances.get(to.placeId) ?? []).filter(e => mode !== 'step_free' || e.step_free);
      targets = list.filter(e => e.node[mode] != null).map(e => ({ node: e.node[mode]!, entrance: e, coord: e.coord }));
      if (!targets.length) return { error: mode === 'step_free' ? 'No step-free entrance is recorded for this place.' : 'This place has no entrance on the map yet.', status: 404 };
    } else if (to.coord) {
      const n = nearestNode(this.graph, to.coord, mode, this.closed);
      if (n == null) return { error: 'That point is too far from any mapped path.', status: 422 };
      targets = [{ node: n, entrance: null, coord: to.coord }];
    }
    const found = shortestPath(this.graph, start, targets.map(t => t.node), mode, this.closed);
    if (!found) {
      return { error: this.closed.size ? 'No route: a closure blocks every way there. Try another route type.' : 'No route found on the mapped paths.', status: 404 };
    }
    const target = targets.find(t => t.node === found.path.at(-1)!.node)!;
    const endNode = this.graph.nodes[target.node].coord;
    const end = haversine(endNode, target.coord) > 1 ? target.coord : null;
    const result = buildRoute(this.graph, start, from, found.path, end, mode);
    return {
      ...result,
      destination: {
        place_id: to.placeId ?? null, entrance: target.entrance?.name ?? null,
        entrance_estimated: target.entrance?.estimated ?? false, step_free: target.entrance?.step_free ?? true,
      },
    };
  }

  report() {
    const entranceNodes = new Set<number>();
    for (const list of this.entrances.values()) for (const e of list) if (e.node.walk != null) entranceNodes.add(e.node.walk);
    return graphReport(this.graph, entranceNodes);
  }
}
