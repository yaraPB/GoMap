/**
 * Ground-plane projection for AR guidance, without ARCore.
 *
 * World: local east/north/up metres around the user. Camera: at EYE_HEIGHT above the ground,
 * yaw = compass heading, pitch = how far the phone tilts down from the horizon (DeviceMotion),
 * roll = sideways tilt. A ground point is rotated into camera space and projected with a pinhole
 * model whose focal length comes from the camera's vertical field of view (the portrait preview
 * fills the screen height). Because every chevron corner is projected, arrows lie flat on the
 * paving and keep their place as the phone moves.
 */
import type { Position } from '../api/types';
import { angleDiff, bearing, distance, enu, lineLength, offset, pointAlong, snapToLine } from './geo';

export const EYE_HEIGHT = 1.4;           // metres, phone held at chest height
export const VFOV_DEG = 63;              // portrait preview vertical FOV of a typical main camera
export const NEAR_M = 1.5;               // closest arrow
export const FAR_M = 8;                  // arrows fade out past this
const rad = Math.PI / 180;

export type Pose = { heading: number; pitchDown: number; roll: number };
export type Screen = { width: number; height: number };
export type Projected = { x: number; y: number; depth: number };

/** GPS/compass projection is approximate; never draw ground arrows using stale or missing sensors. */
export function arReady(input: { simulated: boolean; accuracy: number | null; timestamp: number | null; now: number; heading: number | null; headingAccuracy: number | null; aligned: boolean; motion: boolean }) {
  const gps = input.simulated || (input.accuracy != null && input.accuracy <= 15 && input.timestamp != null && input.now - input.timestamp <= 15000);
  const compass = input.heading != null && (input.aligned || (input.headingAccuracy != null && input.headingAccuracy >= 2));
  return gps && compass && input.motion;
}

export function focalPx(screen: Screen) { return (screen.height / 2) / Math.tan((VFOV_DEG / 2) * rad); }
export function hfovDeg(screen: Screen) { return 2 * Math.atan((screen.width / 2) / focalPx(screen)) / rad; }

type Cam = [number, number, number]; // right, up, forward (metres)
const NEAR_Z = 0.3;

/** World point (east, north, up from the user's feet) → camera space. */
export function toCamera([e, n, u]: [number, number, number], pose: Pose): Cam {
  const h = pose.heading * rad, th = pose.pitchDown * rad;
  const p = [e, n, u - EYE_HEIGHT];
  const F = [Math.sin(h) * Math.cos(th), Math.cos(h) * Math.cos(th), -Math.sin(th)];
  const U = [Math.sin(h) * Math.sin(th), Math.cos(h) * Math.sin(th), Math.cos(th)];
  const R = [Math.cos(h), -Math.sin(h), 0];
  return [p[0] * R[0] + p[1] * R[1] + p[2] * R[2], p[0] * U[0] + p[1] * U[1] + p[2] * U[2], p[0] * F[0] + p[1] * F[1] + p[2] * F[2]];
}

function toScreen([x, y, z]: Cam, pose: Pose, screen: Screen): Projected {
  const f = focalPx(screen);
  let sx = f * x / z, sy = -f * y / z;
  if (pose.roll) { const r = -pose.roll * rad, c = Math.cos(r), s = Math.sin(r); [sx, sy] = [sx * c - sy * s, sx * s + sy * c]; }
  return { x: screen.width / 2 + sx, y: screen.height / 2 + sy, depth: z };
}

/**
 * Project a flat shape, cutting it at the near plane instead of dropping it: arrows right at
 * your feet stay visible (cut by the bottom of the screen) rather than vanishing.
 */
export function projectPolygon(points: [number, number, number][], pose: Pose, screen: Screen): Projected[] | null {
  const cam = points.map(p => toCamera(p, pose));
  const out: Cam[] = [];
  for (let i = 0; i < cam.length; i++) {
    const a = cam[i], b = cam[(i + 1) % cam.length];
    const ain = a[2] >= NEAR_Z, bin = b[2] >= NEAR_Z;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (NEAR_Z - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR_Z]); }
  }
  if (out.length < 3) return null;
  return out.map(c => toScreen(c, pose, screen));
}
const pts = (p: Projected[]) => p.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');

/** Project a world point (east, north, up metres relative to the user's feet). */
export function project([e, n, u]: [number, number, number], pose: Pose, screen: Screen): Projected | null {
  const h = pose.heading * rad, th = pose.pitchDown * rad;
  const p = [e, n, u - EYE_HEIGHT];
  const F = [Math.sin(h) * Math.cos(th), Math.cos(h) * Math.cos(th), -Math.sin(th)];
  const U = [Math.sin(h) * Math.sin(th), Math.cos(h) * Math.sin(th), Math.cos(th)];
  const R = [Math.cos(h), -Math.sin(h), 0];
  const z = p[0] * F[0] + p[1] * F[1] + p[2] * F[2];
  if (z < 0.25) return null; // behind or too close to the lens
  const x = p[0] * R[0] + p[1] * R[1] + p[2] * R[2];
  const y = p[0] * U[0] + p[1] * U[1] + p[2] * U[2];
  const f = focalPx(screen);
  let sx = f * x / z, sy = -f * y / z;
  if (pose.roll) { // counter-rotate for sideways tilt so the ground stays level
    const r = -pose.roll * rad, c = Math.cos(r), s = Math.sin(r);
    [sx, sy] = [sx * c - sy * s, sx * s + sy * c];
  }
  return { x: screen.width / 2 + sx, y: screen.height / 2 + sy, depth: z };
}

/** A chevron lying on the ground at `centre`, pointing along `dirDeg`. Returns its polygon on screen. */
export function chevronPolygon(centre: [number, number], dirDeg: number, pose: Pose, screen: Screen, size = 1) {
  const d = [Math.sin(dirDeg * rad), Math.cos(dirDeg * rad)];
  const p = [d[1], -d[0]]; // to the right of travel
  const L = 0.55 * size, W = 0.42 * size, T = 0.2 * size;
  const at = (fwd: number, side: number): [number, number, number] => [centre[0] + d[0] * fwd + p[0] * side, centre[1] + d[1] * fwd + p[1] * side, 0];
  const pts = [at(L / 2, 0), at(-L / 2, W), at(-L / 2 + T, W), at(L / 2 - T * 1.15, 0), at(-L / 2 + T, -W), at(-L / 2, -W)]
    .map(v => project(v, pose, screen));
  if (pts.some(q => !q)) return null;
  return { points: pts as Projected[], depth: (pts as Projected[]).reduce((s, q) => s + q.depth, 0) / pts.length };
}

export type Chevron = { key: number; points: string; shadow: string | null; edge: string | null; opacity: number; dist: number };

/** Chevron outline on the ground (east/north metres), lifted by `up` metres. */
function chevronShape(centre: [number, number], dirDeg: number, size: number, up: number): [number, number, number][] {
  const d = [Math.sin(dirDeg * rad), Math.cos(dirDeg * rad)];
  const p = [d[1], -d[0]];
  const L = 0.6 * size, W = 0.45 * size, T = 0.22 * size;
  const at = (fwd: number, side: number): [number, number, number] => [centre[0] + d[0] * fwd + p[0] * side, centre[1] + d[1] * fwd + p[1] * side, up];
  return [at(L / 2, 0), at(-L / 2, W), at(-L / 2 + T, W), at(L / 2 - T * 1.15, 0), at(-L / 2 + T, -W), at(-L / 2, -W)];
}

/**
 * Chevrons along the route ahead, NEAR_M to FAR_M, lying on the paving. Each has a raised top,
 * a darker front edge (thickness) and a soft shadow, so it reads as an object on the floor.
 * `flow` (0–1) slides them forward along the path: the ar-flow animation.
 */
export function chevronsAhead(line: Position[], user: Position, pose: Pose, screen: Screen, count = 6, flow = 0): Chevron[] {
  if (line.length < 2 || count < 1) return [];
  const snap = snapToLine(line, user);
  const total = lineLength(line);
  const spacing = (FAR_M - NEAR_M) / Math.max(1, count - 1);
  const out: Chevron[] = [];
  for (let k = 0; k < count; k++) {
    const ahead = NEAR_M + (k + flow) * spacing;
    const along = snap.along + ahead;
    if (along >= total - 0.3) break;
    const c = pointAlong(line, along);
    const dir = bearing(c, pointAlong(line, Math.min(total, along + 0.8)));
    const local = enu(user, c) as [number, number];
    const top = projectPolygon(chevronShape(local, dir, 1, 0.06), pose, screen);
    if (!top) continue;
    const shadow = projectPolygon(chevronShape([local[0] + 0.06, local[1] - 0.06], dir, 1.05, 0), pose, screen);
    const base = projectPolygon(chevronShape(local, dir, 1, 0), pose, screen);
    // fade in at the near end (as it slides in) and out past FAR_M
    const fadeIn = k === 0 ? Math.min(1, flow * 2 + 0.2) : 1;
    const fadeOut = ahead > FAR_M - 2 ? Math.max(0, (FAR_M + spacing - ahead) / (2 + spacing)) : 1;
    out.push({ key: k, points: pts(top), shadow: shadow ? pts(shadow) : null, edge: base ? pts(base) : null, opacity: Math.max(0, Math.min(1, fadeIn * fadeOut)), dist: ahead });
  }
  return out;
}

/** The route painted on the ground as a translucent band, so the way is clear between arrows. */
export function pathRibbon(line: Position[], user: Position, pose: Pose, screen: Screen, from = 0.4, to = 30, width = 1.2): { points: string; opacity: number }[] {
  if (line.length < 2) return [];
  const snap = snapToLine(line, user);
  const total = lineLength(line);
  const out: { points: string; opacity: number }[] = [];
  const step = 1.5;
  let prev: [number, number, number][] | null = null;
  for (let s = from; s <= to && snap.along + s < total; s += step) {
    const c = pointAlong(line, snap.along + s);
    const dir = bearing(c, pointAlong(line, Math.min(total, snap.along + s + 0.6))) * rad;
    const [e, n] = enu(user, c);
    const px = Math.cos(dir) * width / 2, py = -Math.sin(dir) * width / 2;
    const edge: [number, number, number][] = [[e - px, n - py, 0.01], [e + px, n + py, 0.01]];
    if (prev) {
      const poly = projectPolygon([prev[0], prev[1], edge[1], edge[0]], pose, screen);
      if (poly) out.push({ points: pts(poly), opacity: Math.max(0.05, 1 - s / to) });
    }
    prev = edge;
  }
  return out;
}

/** A big arrow on the ground at the next turn, pointing the new way, when it is close. */
export function turnMarker(line: Position[], user: Position, turnAt: Position, pose: Pose, screen: Screen) {
  const snap = snapToLine(line, user);
  const t = snapToLine(line, turnAt);
  const ahead = t.along - snap.along;
  if (ahead < 2 || ahead > 25) return null;
  const total = lineLength(line);
  const dir = bearing(pointAlong(line, t.along), pointAlong(line, Math.min(total, t.along + 4)));
  const local = enu(user, pointAlong(line, Math.min(total, t.along + 1.2))) as [number, number];
  const top = projectPolygon(chevronShape(local, dir, 2.2, 0.08), pose, screen);
  const shadow = projectPolygon(chevronShape([local[0] + 0.1, local[1] - 0.1], dir, 2.3, 0), pose, screen);
  return top ? { points: pts(top), shadow: shadow ? pts(shadow) : null, dist: ahead } : null;
}

/** Where to point the user when the path ahead is off-screen. */
export function steerHint(line: Position[], user: Position, heading: number, screen: Screen) {
  if (line.length < 2) return null;
  const snap = snapToLine(line, user);
  const target = pointAlong(line, snap.along + 6);
  if (distance(user, target) < 1) return null;
  const rel = angleDiff(heading, bearing(user, target));
  const half = hfovDeg(screen) / 2;
  if (Math.abs(rel) <= half) return null;
  return { side: rel > 0 ? 'right' as const : 'left' as const, rel, around: Math.abs(rel) > 135 };
}

/** Floating destination label, anchored a few metres up above the entrance. */
export function labelFor(dest: Position, user: Position, pose: Pose, screen: Screen) {
  const [e, n] = enu(user, dest);
  const dist = distance(user, dest);
  const p = project([e, n, Math.min(6, 2.5 + dist * 0.02)], pose, screen);
  if (!p) return { visible: false as const, dist };
  const margin = 70;
  return { visible: true as const, dist, x: Math.max(margin, Math.min(screen.width - margin, p.x)), y: Math.max(130, Math.min(screen.height - 220, p.y)), clamped: p.x < margin || p.x > screen.width - margin };
}

/** Heading drift check: compass versus the direction you actually walked (GPS course). */
export function courseFrom(history: { coord: Position; t: number }[]) {
  if (history.length < 2) return null;
  const a = history[0], b = history[history.length - 1];
  const d = distance(a.coord, b.coord);
  const dt = (b.t - a.t) / 1000;
  if (d < 6 || dt <= 0 || d / dt < 0.7) return null; // need real walking to trust the course
  return bearing(a.coord, b.coord);
}

export { offset };
