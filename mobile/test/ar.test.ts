import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, bearing, createHeadingFilter, distance, offset, pointAlong, snapToLine } from '../src/ar/geo';
import { arReady, chevronsAhead, EYE_HEIGHT, focalPx, project, steerHint } from '../src/ar/projection';

const screen = { width: 390, height: 844 };
const user: [number, number] = [-5.1066, 33.5393];

test('heading filter does not spin the long way round at 359° → 0°', () => {
  const f = createHeadingFilter(0.5);
  f(358);
  const v = f(2);
  assert.ok(v > 355 || v < 5, `got ${v}`);
});

test('angleDiff is signed and wraps', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(0, 180), -180);
});

test('a point straight ahead on the horizon lands in the screen centre', () => {
  const p = project([0, 50, EYE_HEIGHT], { heading: 0, pitchDown: 0, roll: 0 }, screen)!;
  assert.ok(Math.abs(p.x - screen.width / 2) < 0.01);
  assert.ok(Math.abs(p.y - screen.height / 2) < 0.01);
});

test('looking down 30°, the ground point the camera aims at is the centre', () => {
  const d = EYE_HEIGHT / Math.tan(30 * Math.PI / 180);
  const p = project([0, d, 0], { heading: 0, pitchDown: 30, roll: 0 }, screen)!;
  assert.ok(Math.abs(p.y - screen.height / 2) < 0.5, `y=${p.y}`);
});

test('ground ahead projects below the horizon, nearer is lower; behind is hidden', () => {
  const pose = { heading: 90, pitchDown: 20, roll: 0 };
  const near = project([2, 0, 0], pose, screen)!;
  const far = project([8, 0, 0], pose, screen)!;
  assert.ok(near.y > far.y);
  assert.equal(project([-5, 0, 0], pose, screen), null);
  assert.ok(focalPx(screen) > 0);
});

test('chevrons follow the route ahead and shrink with distance', () => {
  const line: [number, number][] = [user, offset(user, 0, 30)]; // 30 m due north
  const chev = chevronsAhead(line, user, { heading: 0, pitchDown: 25, roll: 0 }, screen);
  assert.equal(chev.length, 5);
  const width = (pts: string) => { const xs = pts.split(' ').map(p => Number(p.split(',')[0])); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(width(chev[0].points) > width(chev[4].points));
  assert.ok(chev[4].opacity < chev[0].opacity, 'fades past 8 m');
});

test('steer hint points the way when the path is behind or to the side', () => {
  const line: [number, number][] = [user, offset(user, 30, 0)]; // due east
  assert.equal(steerHint(line, user, 90, screen), null);
  assert.equal(steerHint(line, user, 0, screen)?.side, 'right');
  assert.equal(steerHint(line, user, 270, screen)?.around, true);
});

test('route snapping and walking along it', () => {
  const line: [number, number][] = [user, offset(user, 0, 100)];
  const s = snapToLine(line, offset(user, 3, 40));
  assert.ok(Math.abs(s.along - 40) < 0.5);
  assert.ok(Math.abs(s.off - 3) < 0.2);
  assert.ok(Math.abs(distance(pointAlong(line, 25), user) - 25) < 0.2);
  assert.ok(Math.abs(bearing(user, offset(user, 10, 0)) - 90) < 0.5);
});

test('AR arrows require a fresh accurate fix, a usable compass and motion', () => {
  const good = { simulated: false, accuracy: 8, timestamp: 100_000, now: 105_000, heading: 90, headingAccuracy: 2, aligned: false, motion: true };
  assert.equal(arReady(good), true);
  assert.equal(arReady({ ...good, now: 116_000 }), false);
  assert.equal(arReady({ ...good, accuracy: 20 }), false);
  assert.equal(arReady({ ...good, headingAccuracy: 1 }), false);
  assert.equal(arReady({ ...good, headingAccuracy: 1, aligned: true }), true);
  assert.equal(arReady({ ...good, motion: false }), false);
  assert.equal(arReady({ ...good, simulated: true, accuracy: null, timestamp: null }), true);
});

test('AR projection handles a single arrow and does not steer at the destination', () => {
  const line: [number, number][] = [user, offset(user, 0, 20)];
  const arrows = chevronsAhead(line, user, { heading: 0, pitchDown: 25, roll: 0 }, screen, 1);
  assert.equal(arrows.length, 1);
  assert.doesNotMatch(arrows[0].points, /NaN/);
  assert.equal(steerHint(line, line[1], 180, screen), null);
});
