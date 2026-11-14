import test from 'node:test';
import assert from 'node:assert/strict';
import { WalkFilter, snapToNetwork } from '../src/location/kalman';
import { cameraPose, HeadingFusion, angleDelta } from '../src/ar/orientation';
import { distance, offset as shift } from '../src/ar/geo';

/** move m metres along a compass bearing */
const offset = (p: [number, number], bearingDeg: number, m: number) => shift(p, m * Math.sin(bearingDeg * Math.PI / 180), m * Math.cos(bearingDeg * Math.PI / 180));

const start: [number, number] = [-5.1066, 33.5393];
const deg = Math.PI / 180;

test('walk filter smooths jitter and ignores a 60 m jump', () => {
  const f = new WalkFilter();
  let out = f.update(start, 8, 0);
  // walking north at 1.3 m/s with ±6 m noise
  let worst = 0;
  for (let i = 1; i <= 30; i++) {
    const truth = offset(start, 0, i * 1.3);
    const noisy = offset(truth, (i * 137) % 360, 6 * Math.sin(i * 1.7));
    out = f.update(noisy, 8, i * 1000);
    if (i > 8) worst = Math.max(worst, distance(out.coord, truth));
  }
  assert.ok(worst < 6, `filtered error stays under the noise (${worst.toFixed(1)} m)`);
  assert.ok(out.course != null && Math.abs(angleDelta(out.course, 0)) < 25, 'course is north');
  const before = out.coord;
  const jump = f.update(offset(before, 90, 60), 10, 31000);
  assert.equal(jump.rejected, true);
  assert.ok(distance(jump.coord, before) < 5);
});

test('walk filter accepts a real move after repeated agreeing fixes', () => {
  const f = new WalkFilter();
  f.update(start, 5, 0);
  const far = offset(start, 90, 120);
  let out = f.update(far, 6, 1000);
  for (let i = 2; i < 6; i++) out = f.update(far, 6, i * 1000);
  assert.ok(distance(out.coord, far) < 10);
});

test('snap to network pulls a fix onto the nearest path, not beyond the limit', () => {
  const line: [number, number][] = [offset(start, 270, 50), offset(start, 90, 50)];
  const p = offset(start, 0, 4);
  const s = snapToNetwork(p, [line], 8)!;
  assert.ok(s.dist > 3.5 && s.dist < 4.5);
  assert.ok(distance(s.coord, start) < 0.5);
  assert.equal(snapToNetwork(offset(start, 0, 20), [line], 8), null);
});

test('camera pose: upright facing north/east, tilted down, flat', () => {
  const north = cameraPose(0, 90 * deg, 0);
  assert.ok(Math.abs(angleDelta(north.yaw, 0)) < 0.5);
  assert.ok(Math.abs(north.pitchDown) < 0.5);
  const east = cameraPose(-90 * deg, 90 * deg, 0);
  assert.ok(Math.abs(angleDelta(east.yaw, 90)) < 0.5);
  const down = cameraPose(0, 60 * deg, 0);
  assert.ok(Math.abs(down.pitchDown - 30) < 0.5, 'tilting the top back 30° points the camera 30° down');
  assert.ok(Math.abs(cameraPose(0, 0, 0).pitchDown - 90) < 0.5, 'flat on a table looks straight down');
  // an upright phone tilted 10° sideways decomposes to beta = 80°, gamma = -90°
  const tilted = cameraPose(0, 80 * deg, -90 * deg);
  assert.ok(Math.abs(tilted.roll - 10) < 0.5, 'sideways tilt shows as roll');
  assert.ok(Math.abs(tilted.pitchDown) < 0.5, 'and does not tip the camera down');
});

test('heading fusion starts from the compass, follows the gyro, trusts walking course', () => {
  const h = new HeadingFusion();
  // arbitrary attitude reference (iOS): attitude says 100°, compass says 10°
  let v = h.update({ yaw: 100, pitchDown: 5, compass: 10, compassAccuracy: 3, course: null, t: 0, platform: 'ios' })!;
  assert.ok(Math.abs(angleDelta(v, 10)) < 1);
  // turning 30° right: attitude moves at once, result follows without waiting for the compass
  v = h.update({ yaw: 130, pitchDown: 5, compass: 12, compassAccuracy: 3, course: null, t: 50, platform: 'ios' })!;
  assert.ok(Math.abs(angleDelta(v, 40)) < 3);
  // walking with a GPS course of 45° for 20 s pulls the correction towards it
  for (let t = 100; t < 20000; t += 100) v = h.update({ yaw: 130, pitchDown: 5, compass: 40, compassAccuracy: 3, course: 45, t, platform: 'ios' })!;
  assert.ok(Math.abs(angleDelta(v, 45)) < 2);
  h.align(130, 50);
  assert.ok(Math.abs(angleDelta(h.update({ yaw: 130, pitchDown: 5, compass: 0, compassAccuracy: 3, course: null, t: 20100, platform: 'ios' })!, 50)) < 1, 'manual alignment wins over the compass');
});
