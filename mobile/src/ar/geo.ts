/** Small geodesy helpers shared by navigation and AR. Positions are [lng, lat]. */
import type { Position } from '../api/types';

const R = 6371008.8;
const rad = Math.PI / 180;

export function distance(a: Position, b: Position) {
  const φ1 = a[1] * rad, φ2 = b[1] * rad;
  const s = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Initial bearing from a to b, degrees clockwise from true north, 0–360. */
export function bearing(a: Position, b: Position) {
  const φ1 = a[1] * rad, φ2 = b[1] * rad, Δλ = (b[0] - a[0]) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Signed smallest difference b − a in degrees, −180…180 (positive = clockwise / to the right). */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Local east/north metres of b relative to a. Accurate to centimetres across a campus. */
export function enu(a: Position, b: Position): [number, number] {
  return [(b[0] - a[0]) * rad * R * Math.cos(a[1] * rad), (b[1] - a[1]) * rad * R];
}

export function offset(a: Position, eastM: number, northM: number): Position {
  return [a[0] + eastM / (R * Math.cos(a[1] * rad)) / rad, a[1] + northM / R / rad];
}

/** Closest point on a polyline: where you are along the route and how far off it. */
export function snapToLine(line: Position[], p: Position) {
  let best = { index: 0, t: 0, point: line[0], off: Infinity, along: 0 };
  let along = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ex, ny] = enu(line[i], line[i + 1]);
    const [px, py] = enu(line[i], p);
    const len2 = ex * ex + ny * ny;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ny) / len2));
    const cx = t * ex, cy = t * ny;
    const off = Math.hypot(px - cx, py - cy);
    const segLen = Math.sqrt(len2);
    if (off < best.off) best = { index: i, t, point: offset(line[i], cx, cy), off, along: along + t * segLen };
    along += segLen;
  }
  return best;
}

export function lineLength(line: Position[]) {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += distance(line[i - 1], line[i]);
  return d;
}

/** Point at `meters` along the polyline (clamped to its ends). */
export function pointAlong(line: Position[], meters: number): Position {
  if (meters <= 0) return line[0];
  let d = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = distance(line[i - 1], line[i]);
    if (d + seg >= meters) {
      const t = (meters - d) / seg;
      const [e, n] = enu(line[i - 1], line[i]);
      return offset(line[i - 1], e * t, n * t);
    }
    d += seg;
  }
  return line[line.length - 1];
}

/**
 * Low-pass filter for compass headings. Smoothing raw degrees breaks at the 359°→0° wrap
 * (the arrow spins the long way round), so we smooth the unit vector instead.
 */
export function createHeadingFilter(alpha = 0.15) {
  let sx = 0, sy = 0, init = false;
  return (deg: number) => {
    const x = Math.cos(deg * rad), y = Math.sin(deg * rad);
    if (!init) { sx = x; sy = y; init = true; } else { sx = sx * (1 - alpha) + x * alpha; sy = sy * (1 - alpha) + y * alpha; }
    return (Math.atan2(sy, sx) / rad + 360) % 360;
  };
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.max(1, Math.round(m / (m < 100 ? 5 : 10)) * (m < 100 ? 5 : 10))} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtMinutes = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
