/**
 * The AR screen's decisions, kept pure so they are tested (test/ar.test.ts):
 * how the phone is held, where the arrow at your feet points, and when to say "turn around".
 */
import type { Position } from '../api/types';
import { bearing, pointAlong, snapToLine } from './geo';

/** Arrows lie on the ground 1.5–8 m ahead: the camera has to see that strip. */
export const TILT_TOO_LOW = 72;   // pitchDown above this: the camera sees only your feet
export const TILT_TOO_HIGH = -8;  // below this: the camera looks at the sky
export function tiltState(pitchDown: number): 'ok' | 'down' | 'up' {
  return pitchDown > TILT_TOO_LOW ? 'down' : pitchDown < TILT_TOO_HIGH ? 'up' : 'ok';
}

/**
 * The way to go relative to where the camera points, in degrees (−180…180, positive = to the right).
 * Aims ~8 m ahead along the route, or at the next turn when it is closer; within ~2 m of the turn it
 * already points down the new path, so the arrow swings just before you need to turn.
 */
export function guideRelative(line: Position[], user: Position, heading: number, toNext: number): number | null {
  if (line.length < 2) return null;
  const s = snapToLine(line, user);
  const target = pointAlong(line, Math.min(s.along + 8, s.along + Math.max(2, toNext)));
  if (Math.hypot(target[0] - user[0], target[1] - user[1]) < 1e-9) return null;
  return ((bearing(user, target) - heading + 540) % 360) - 180;
}

/** Facing away from the route (beyond `deg`) for `ms` in a row: time to say "turn around". */
export class WrongWayDetector {
  private since: number | null = null;
  constructor(private deg = 120, private ms = 1500) {}
  update(rel: number | null, now: number): boolean {
    if (rel == null || Math.abs(rel) <= this.deg) { this.since = null; return false; }
    this.since ??= now;
    return now - this.since >= this.ms;
  }
}

/** W3C deviceorientation (degrees) → the radians expo-sensors' DeviceMotion.rotation reports on phones. */
export const fromDeviceOrientation = (e: { alpha: number | null; beta: number | null; gamma: number | null }) =>
  e.alpha == null || e.beta == null || e.gamma == null ? null : { alpha: e.alpha * Math.PI / 180, beta: e.beta * Math.PI / 180, gamma: e.gamma * Math.PI / 180 };
