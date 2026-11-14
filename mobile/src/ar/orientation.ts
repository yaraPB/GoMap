/**
 * Where the back camera is looking, from all the phone's sensors.
 *
 * The compass alone is jittery, and on Android it becomes unreliable when the phone is held
 * upright (exactly the AR pose). The motion sensor's attitude (gyroscope-fused) is smooth and
 * works at any tilt but may drift or use an arbitrary north (iOS). So:
 *
 *   camera yaw    = attitude yaw (smooth, fast)  + offset
 *   offset        → slowly pulled towards (compass − attitude yaw) while the compass is
 *                   trustworthy, and towards (walking course − attitude yaw) while walking
 *   manual align  = sets the offset directly ("point along the path and tap")
 *
 * Rotation angles follow the W3C DeviceOrientation convention that expo-sensors reports:
 * R = Rz(alpha) · Rx(beta) · Ry(gamma), device frame → earth frame (x east, y north, z up).
 */
const rad = Math.PI / 180;
const wrap = (d: number) => ((d % 360) + 360) % 360;
export const angleDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;

export type CameraPose = { yaw: number; pitchDown: number; roll: number };

/** alpha/beta/gamma in radians (expo DeviceMotion.rotation). */
export function cameraPose(alpha: number, beta: number, gamma: number): CameraPose {
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta), sb = Math.sin(beta), cg = Math.cos(gamma), sg = Math.sin(gamma);
  // the back camera looks along the device's −z axis
  const vx = -(ca * sg + sa * sb * cg);
  const vy = -(sa * sg - ca * sb * cg);
  const vz = -cb * cg;
  const yaw = wrap(Math.atan2(vx, vy) / rad);
  const pitchDown = Math.asin(Math.max(-1, Math.min(1, -vz))) / rad;
  // how far the screen is rotated around the viewing axis (keeps the drawn ground level)
  const roll = Math.atan2(-cb * sg, sb) / rad;
  return { yaw, pitchDown, roll };
}

export class HeadingFusion {
  private offset: number | null = null;
  private manual = false;
  private last = 0;

  /** Feed each attitude sample; returns the fused camera heading (true north) or null. */
  update(input: { yaw: number; pitchDown: number; compass: number | null; compassAccuracy: number | null; course: number | null; t: number; platform: string }): number | null {
    const dt = this.last ? Math.min(1, (input.t - this.last) / 1000) : 0;
    this.last = input.t;
    // Android's compass reads the top edge of the phone and degrades when upright; iOS fuses it.
    const compassOk = input.compass != null && (input.compassAccuracy ?? 0) >= 1 && (input.platform === 'ios' || input.pitchDown > 35 || (input.compassAccuracy ?? 0) >= 3);
    if (this.offset == null) {
      if (input.compass == null) return null;
      this.offset = angleDelta(input.yaw, input.compass); // first guess, even if rough
    }
    const pull = (target: number, tau: number) => { this.offset = wrap(this.offset! + angleDelta(this.offset!, target) * Math.min(1, dt / tau)); };
    if (input.course != null) pull(angleDelta(input.yaw, input.course), this.manual ? 12 : 5);   // walking: trust the path
    else if (compassOk && !this.manual) pull(angleDelta(input.yaw, input.compass!), 3);
    return wrap(input.yaw + this.offset);
  }

  /** "Align with the path": the camera is pointing along `bearing` right now. */
  align(yaw: number, bearing: number) { this.offset = angleDelta(yaw, bearing); this.manual = true; }
  get aligned() { return this.manual; }
  get correction() { return this.offset; }
}
