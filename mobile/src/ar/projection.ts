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

export function focalPx(screen: Screen) { return (screen.height / 2) / Math.tan((VFOV_DEG / 2) * rad); }
export function hfovDeg(screen: Screen) { return 2 * Math.atan((screen.width / 2) / focalPx(screen)) / rad; }

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

export type Chevron = { key: number; points: string; opacity: number; dist: number };

/**
 * Chevrons along the route ahead of the user, from NEAR_M to FAR_M.
 * `line` is the route geometry; arrows follow its bends, so a turn shows up as arrows curving away.
 */
export function chevronsAhead(line: Position[], user: Position, pose: Pose, screen: Screen, count = 5): Chevron[] {
  if (line.length < 2) return [];
  const snap = snapToLine(line, user);
  const total = lineLength(line);
  const out: Chevron[] = [];
  for (let k = 0; k < count; k++) {
    const ahead = NEAR_M + (k * (FAR_M - NEAR_M)) / (count - 1);
    const along = snap.along + ahead;
    if (along > total) break;
    const c = pointAlong(line, along);
    const next = pointAlong(line, Math.min(total, along + 0.8));
    const dir = bearing(c, next);
    const local = enu(user, c);
    const poly = chevronPolygon(local, dir, pose, screen, 1);
    if (!poly) continue;
    const fade = ahead > FAR_M - 2 ? Math.max(0, (FAR_M - ahead) / 2) * 0.8 + 0.2 : 1;
    out.push({ key: k, points: poly.points.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '), opacity: fade, dist: ahead });
  }
  return out;
}

/** Where to point the user when the path ahead is off-screen. */
export function steerHint(line: Position[], user: Position, heading: number, screen: Screen) {
  const snap = snapToLine(line, user);
  const target = pointAlong(line, snap.along + 6);
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
