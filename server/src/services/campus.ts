/**
 * Live routing state: the graph built from Mongo walkways, each place's entrances attached to
 * the network, and the set of edges closed by confirmed reports. `rebuild()` runs at boot and
 * whenever an admin confirms or resolves a closure, so the very next route avoids it.
 */
import type { FeatureCollection, Position } from 'geojson';
import { Entrance, Place, Report, Walkway } from '../db/mongo.js';
import { makeElevation, type Elevation } from '../geo/elevation.js';
import type { WayFeature } from '../geo/types.js';
import { CAMPUS_CENTER } from '../geo/types.js';
import { buildGraph, connectIslands, graphReport, projector, projectOnSegment, type Graph } from '../routing/graph.js';
import { buildRoute, edgeCost, GENTLE, haversine, nearestNode, nearestReachable, shortestPath, snap, STEEP, type RouteMode, type RouteResult } from '../routing/route.js';
import { loadContours } from '../seed/seed.js';

type Destination = { place_id: string | null; entrance: string | null; entrance_estimated: boolean; step_free: boolean };
export type CampusRoute = RouteResult & {
  approximate?: boolean; destination: Destination;
  /** drive routes: where to leave the car, and how the time splits */
  park?: { place_id: string; name: string; coordinates: Position; drive_s: number; walk_s: number; walk_m: number };
};

type EntranceInfo = { id: string; place_id: string; name: string; coord: Position; step_free: boolean; estimated: boolean; node: Record<RouteMode, number | null> };

export class Campus {
  graph: Graph = { nodes: [], edges: [], origin: CAMPUS_CENTER };
  closed = new Set<string>();
  entrances = new Map<string, EntranceInfo[]>();
  walkways: WayFeature[] = [];
  connectors: ReturnType<typeof connectIslands> = [];
  elevation: Elevation | null = null;
  parking: { id: string; name: string }[] = [];
  private slopesCache: FeatureCollection | null = null;

  async rebuild() {
    const docs = await Walkway.find().lean();
    this.walkways = docs.map(d => ({
      type: 'Feature', geometry: d.geometry as WayFeature['geometry'],
      properties: { id: String(d._id), kind: d.kind, modes: d.modes, step_free: d.step_free ?? true, lit: d.lit ?? null, covered: d.covered ?? null, name: d.name ?? null, road_class: d.road_class ?? null, source: d.source },
    }) as WayFeature);
    // with the contour lines, every path gets a slope (estimated) for step-free routes and honest times
    this.graph = buildGraph(this.walkways, CAMPUS_CENTER, { elevation: this.elevation ??= makeElevation(loadContours()) });
    this.slopesCache = null;
    this.parking = (await Place.find({ _id: /^car-park-/ }, { name: 1 }).lean()).map(p => ({ id: String(p._id), name: p.name }));
    // every building must be reachable: join path islands to the main network
    // (80 m cap: a longer straight line would cut through buildings; route() falls back instead)
    this.connectors = connectIslands(this.graph, 80);
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

  route(from: Position, to: { placeId?: string; coord?: Position }, mode: RouteMode): CampusRoute | { error: string; status: number } {
    if (mode === 'drive') return this.drive(from, to);
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
    let found = shortestPath(this.graph, start, targets.map(t => t.node), mode, this.closed);
    let target = found ? targets.find(t => t.node === found!.path.at(-1)!.node)! : null;
    let approximate = false;
    if (!found && !this.closed.size) {
      // The door is on a piece of path we cannot reach (unmapped gap). Walk to the closest point we
      // CAN reach and finish the last stretch straight to the door, flagged as approximate.
      const goal = targets[0];
      const near = nearestReachable(this.graph, start, goal.coord, mode, this.closed);
      if (near != null) {
        found = shortestPath(this.graph, start, [near], mode, this.closed);
        target = { ...goal, node: near };
        approximate = true;
      }
    }
    if (!found || !target) {
      return { error: this.closed.size ? 'No route: a closure blocks every way there. Try another route type.' : 'No route found on the mapped paths.', status: 404 };
    }
    const endNode = this.graph.nodes[target.node].coord;
    const end = haversine(endNode, target.coord) > 1 ? target.coord : null;
    const result = buildRoute(this.graph, start, from, found.path, end, mode);
    return {
      ...result,
      approximate,
      destination: {
        place_id: to.placeId ?? null, entrance: target.entrance?.name ?? null,
        entrance_estimated: (target.entrance?.estimated ?? false) || approximate, step_free: target.entrance?.step_free ?? true,
      },
    };
  }

  /**
   * By car: cars cannot reach a door on a footpath, so a drive route is drive to a car park, park,
   * walk the rest. The car park is the one with the best total (drive + walk) time, usually the
   * closest to the door rather than the first one on the way.
   */
  private drive(from: Position, to: { placeId?: string; coord?: Position }): CampusRoute | { error: string; status: number } {
    const start = snap(this.graph, from, 'drive', this.closed, 600);
    if (!start) return { error: 'There is no road near you to start driving from.', status: 422 };
    let best: { park: { id: string; name: string }; coord: Position; node: number; drive: NonNullable<ReturnType<typeof shortestPath>>; walk: CampusRoute | null; total: number } | null = null;
    for (const park of this.parking) {
      const door = (this.entrances.get(park.id) ?? []).find(e => e.node.drive != null);
      if (!door) continue;
      const drive = shortestPath(this.graph, start, [door.node.drive!], 'drive', this.closed);
      if (!drive) continue;
      // driving to the destination itself (it is a car park): no walk after
      const walk = to.placeId === park.id ? null : this.route(door.coord, to, 'walk');
      if (walk && 'error' in walk) continue;
      const total = drive.cost / 5.5 + (walk?.duration_s ?? 0);
      if (!best || total < best.total) best = { park, coord: door.coord, node: door.node.drive!, drive, walk, total };
    }
    if (!best) return { error: this.parking.length ? 'No car park can be reached by road from here.' : 'No car park is on the map yet.', status: 404 };

    const driveLeg = buildRoute(this.graph, start, from, best.drive.path, null, 'drive');
    const parkAt = this.graph.nodes[best.node].coord;
    const steps = driveLeg.steps.filter(s => s.turn !== 'arrive');
    steps.push({ turn: 'straight', distance_m: 0, at: parkAt, bearing: steps.at(-1)?.bearing ?? 0, crossing: false, stairs: false, on: null, kind: 'road', text: `Park at ${best.park.name}` });
    const walk = best.walk;
    return {
      mode: 'drive',
      distance_m: driveLeg.distance_m + (walk?.distance_m ?? 0),
      duration_s: driveLeg.duration_s + (walk?.duration_s ?? 0),
      geometry: { type: 'LineString', coordinates: [...driveLeg.geometry.coordinates, ...(walk?.geometry.coordinates ?? [])] },
      steps: walk ? [...steps, ...walk.steps] : [...steps, { turn: 'arrive', distance_m: 0, at: parkAt, bearing: 0, crossing: false, stairs: false, on: null, kind: 'road', text: 'You have arrived' }],
      crossings: walk?.crossings ?? [],
      uses_roads: true,
      segments: [...driveLeg.segments, ...(walk?.segments ?? [])],
      slope: walk?.slope ?? null,
      approximate: walk?.approximate,
      destination: walk?.destination ?? { place_id: best.park.id, entrance: null, entrance_estimated: false, step_free: true },
      park: { place_id: best.park.id, name: best.park.name, coordinates: best.coord, drive_s: driveLeg.duration_s, walk_s: walk?.duration_s ?? 0, walk_m: walk?.distance_m ?? 0 },
    };
  }

  /**
   * Every walkable stretch with how hard it is on wheels, for the app's step-free view:
   * gentle (≤ 5 %), moderate (≤ 8.3 %, ramp-like), steep (more than a ramp), stairs.
   * Consecutive pieces of one path in the same class are joined into one line.
   */
  slopes(): FeatureCollection {
    if (this.slopesCache) return this.slopesCache;
    const features: { type: 'Feature'; properties: { class: string; grade: number; kind: string }; geometry: { type: 'LineString'; coordinates: Position[] } }[] = [];
    let last: { wayId: string; node: number; class: string } | null = null;
    for (const e of this.graph.edges) {
      if (!Number.isFinite(edgeCost(e, 'walk', new Set())) || e.wayId === 'connector') { last = null; continue; }
      const grade = e.rise == null ? 0 : Math.abs(e.rise) / Math.max(e.length, 1);
      const cls = e.kind === 'stairs' || !e.stepFree ? 'stairs' : grade <= GENTLE ? 'gentle' : grade <= STEEP ? 'moderate' : 'steep';
      const a = this.graph.nodes[e.a].coord, b = this.graph.nodes[e.b].coord;
      const prev = features.at(-1);
      if (prev && last && last.wayId === e.wayId && last.class === cls && last.node === e.a) {
        prev.geometry.coordinates.push(b);
        prev.properties.grade = Math.max(prev.properties.grade, Math.round(grade * 1000) / 10);
      } else {
        features.push({ type: 'Feature', properties: { class: cls, grade: Math.round(grade * 1000) / 10, kind: e.kind }, geometry: { type: 'LineString', coordinates: [a, b] } });
      }
      last = { wayId: e.wayId, node: e.b, class: cls };
    }
    this.slopesCache = { type: 'FeatureCollection', features } as FeatureCollection;
    return this.slopesCache;
  }

  report() {
    const entranceNodes = new Set<number>();
    for (const list of this.entrances.values()) for (const e of list) if (e.node.walk != null) entranceNodes.add(e.node.walk);
    return graphReport(this.graph, entranceNodes);
  }
}
