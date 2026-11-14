/**
 * GPS smoothing for people walking.
 *
 * Phones report fixes that jump 5–30 m between buildings. Three layers fix most of it:
 *  1. gating: fixes that are much worse than what we have, or would mean running at 25 km/h,
 *     are ignored (unless they keep coming, then we accept we really moved);
 *  2. a constant-velocity Kalman filter in local metres, trusting each fix by its accuracy;
 *  3. map matching: the result is pulled onto the nearest walkway when it is close enough.
 */
import type { Position } from '../api/types';

const R_EARTH = 6371008.8;
const rad = Math.PI / 180;

type Axis = { p: number; v: number; pp: number; pv: number; vv: number };

export type FilterOutput = { coord: Position; accuracy: number; speed: number; course: number | null; rejected: boolean };

export class WalkFilter {
  private origin: Position | null = null;
  private x: Axis | null = null;
  private y: Axis | null = null;
  private t = 0;
  private lastAcc = 99;
  private rejects = 0;

  constructor(private opts = { accelNoise: 0.9, maxSpeed: 3.2, minAcc: 3 }) {}

  private toLocal([lng, lat]: Position): [number, number] {
    const o = this.origin!;
    return [(lng - o[0]) * rad * R_EARTH * Math.cos(o[1] * rad), (lat - o[1]) * rad * R_EARTH];
  }
  private toGeo(e: number, n: number): Position {
    const o = this.origin!;
    return [o[0] + e / (R_EARTH * Math.cos(o[1] * rad)) / rad, o[1] + n / R_EARTH / rad];
  }

  reset() { this.origin = null; this.x = this.y = null; this.rejects = 0; }

  /** Feed one fix (accuracy in metres, t in ms). */
  update(coord: Position, accuracy: number | null, t: number): FilterOutput {
    const acc = Math.max(this.opts.minAcc, accuracy ?? 30);
    if (!this.origin || !this.x || !this.y) {
      this.origin = coord;
      this.x = { p: 0, v: 0, pp: acc * acc, pv: 0, vv: 4 };
      this.y = { p: 0, v: 0, pp: acc * acc, pv: 0, vv: 4 };
      this.t = t; this.lastAcc = acc;
      return { coord, accuracy: acc, speed: 0, course: null, rejected: false };
    }
    const dt = Math.min(10, Math.max(0.05, (t - this.t) / 1000));
    const [mx, my] = this.toLocal(coord);

    // predict
    const q = this.opts.accelNoise ** 2;
    for (const a of [this.x, this.y]) {
      a.p += a.v * dt;
      a.pp += dt * (2 * a.pv + dt * a.vv) + q * dt ** 4 / 4;
      a.pv += dt * a.vv + q * dt ** 3 / 2;
      a.vv += q * dt * dt;
    }

    // gate: a fix far outside both uncertainties, or implying a sprint, is probably a jump
    const dx = mx - this.x.p, dy = my - this.y.p;
    const s = this.x.pp + acc * acc;
    const d2 = (dx * dx + dy * dy) / s;
    const jump = Math.hypot(dx, dy);
    const sprint = jump / dt > this.opts.maxSpeed * 2.5 && jump > acc + Math.sqrt(this.x.pp) * 2;
    const muchWorse = acc > Math.max(25, this.lastAcc * 2.5);
    if ((d2 > 16 || sprint || muchWorse) && this.rejects < 3) {
      this.rejects++;
      this.t = t;
      return { ...this.output(), rejected: true };
    }
    if (this.rejects >= 3 && d2 > 16) {
      // it kept insisting: we really are somewhere else (left a building, GPS recovered)
      this.reset();
      return this.update(coord, accuracy, t);
    }
    this.rejects = 0;

    // correct
    const r = acc * acc;
    for (const [a, m] of [[this.x, mx], [this.y, my]] as [Axis, number][]) {
      const k0 = a.pp / (a.pp + r), k1 = a.pv / (a.pp + r);
      const innov = m - a.p;
      a.p += k0 * innov; a.v += k1 * innov;
      const pp = a.pp, pv = a.pv;
      a.pp = (1 - k0) * pp; a.pv = (1 - k0) * pv; a.vv -= k1 * pv;
    }
    // people do not walk at 15 km/h: cap the velocity estimate
    const sp = Math.hypot(this.x.v, this.y.v);
    if (sp > this.opts.maxSpeed) { this.x.v *= this.opts.maxSpeed / sp; this.y.v *= this.opts.maxSpeed / sp; }
    this.t = t; this.lastAcc = Math.min(acc, this.lastAcc * 1.3);
    return { ...this.output(), rejected: false };
  }

  private output(): Omit<FilterOutput, 'rejected'> {
    const x = this.x!, y = this.y!;
    const speed = Math.hypot(x.v, y.v);
    return {
      coord: this.toGeo(x.p, y.p), accuracy: Math.sqrt((x.pp + y.pp) / 2), speed,
      course: speed > 0.7 ? (Math.atan2(x.v, y.v) / rad + 360) % 360 : null,
    };
  }
}

/** Nearest point on a set of lines (flat-earth metres, fine at campus scale). */
export function snapToNetwork(p: Position, lines: Position[][], maxM: number): { coord: Position; dist: number } | null {
  const kx = 111320 * Math.cos(p[1] * rad), ky = 110540;
  let best: { coord: Position; dist: number } | null = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
      const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)) : 0;
      const cx = ax + vx * t, cy = ay + vy * t;
      const d = Math.hypot(cx, cy);
      if (d <= maxM && (!best || d < best.dist)) best = { coord: [p[0] + cx / kx, p[1] + cy / ky], dist: d };
    }
  }
  return best;
}
