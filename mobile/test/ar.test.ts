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
  const chev = chevronsAhead(line, user, { heading: 0, pitchDown: 25, roll: 0 }, screen, 5);
  assert.equal(chev.length, 5);
  const width = (pts: string) => { const xs = pts.split(' ').map(p => Number(p.split(',')[0])); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(width(chev[0].points) > width(chev[4].points));
  assert.ok(chev[4].opacity < chev[1].opacity, 'fades past 8 m (the nearest one fades in as it slides forward)');
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

import { fromDeviceOrientation, guideRelative, tiltState, WrongWayDetector } from '../src/ar/guidance';
import { cameraPose } from '../src/ar/orientation';

test('tilt coach: floor → raise, sky → lower, chest height → fine', () => {
  assert.equal(tiltState(85), 'down');
  assert.equal(tiltState(-20), 'up');
  assert.equal(tiltState(25), 'ok');
});

test('the arrow at your feet points along the route: ahead, right, behind', () => {
  const north: [number, number][] = [user, offset(user, 0, 60)];
  assert.ok(Math.abs(guideRelative(north, user, 0, 60)!) < 3, 'facing the route: straight ahead');
  assert.ok(Math.abs(guideRelative(north, user, 270, 60)! - 90) < 3, 'facing west: turn right');
  assert.ok(Math.abs(Math.abs(guideRelative(north, user, 180, 60)!) - 180) < 3, 'facing south: behind');
  // a right turn 4 m ahead: the arrow aims at the corner, then swings right in the last metres
  const corner = offset(user, 0, 4);
  const turn: [number, number][] = [user, corner, offset(corner, 30, 0)];
  assert.ok(Math.abs(guideRelative(turn, user, 0, 4)!) < 3, 'aims at the corner');
  assert.ok(guideRelative(turn, offset(user, 0, 3), 0, 1)! > 20, 'leans right just before it');
});

test('"turn around" needs 1.5 s facing away, and clears as soon as you turn back', () => {
  const d = new WrongWayDetector(120, 1500);
  assert.equal(d.update(170, 0), false);
  assert.equal(d.update(170, 1000), false);
  assert.equal(d.update(-175, 1600), true);
  assert.equal(d.update(20, 1700), false);
  assert.equal(d.update(170, 1800), false, 'the clock restarts');
});

test('web sensors: a phone held upright facing north reads heading 0, camera level', () => {
  // W3C: alpha 0 (north), beta 90 (upright), gamma 0
  const r = fromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 })!;
  const pose = cameraPose(r.alpha, r.beta, r.gamma);
  assert.ok(Math.min(pose.yaw, 360 - pose.yaw) < 1, `yaw ${pose.yaw}`);
  assert.ok(Math.abs(pose.pitchDown) < 1, `pitch ${pose.pitchDown}`);
  // tipped forward 30° (top edge away from you): looking 30° down at the path
  const r2 = fromDeviceOrientation({ alpha: 0, beta: 60, gamma: 0 })!;
  assert.ok(Math.abs(cameraPose(r2.alpha, r2.beta, r2.gamma).pitchDown - 30) < 1);
  assert.equal(fromDeviceOrientation({ alpha: null, beta: 1, gamma: 1 }), null);
});
