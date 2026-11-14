import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { router } from 'expo-router';
import Svg, { Circle, Defs, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg';
import type { Position } from '../src/api/types';
import { angleDiff, bearing, enu, fmtDistance, fmtMinutes, pointAlong, snapToLine } from '../src/ar/geo';
import { arReady, chevronsAhead, labelFor, steerHint, type Pose } from '../src/ar/projection';
import { useApp, useLocation } from '../src/state/app';
import { useNav } from '../src/state/navigation';
import { ManeuverIcon } from '../src/ui/bits';
import { Btn, Icon, IconBtn, T } from '../src/ui/kit';
import { color } from '../src/ui/theme';

const GPS_LIMIT_M = 15;
const rad2deg = 180 / Math.PI;

/** Phone tilt from the motion sensor, smoothed. pitchDown: 0 = camera at the horizon, 90 = straight down. */
function usePose(enabled: boolean) {
  const [tilt, setTilt] = useState({ pitchDown: 20, roll: 0, ok: false });
  const sm = useRef({ p: 20, r: 0 });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let last = 0;
    let sub: { remove: () => void } | undefined;
    void (async () => {
      try {
        if (!(await DeviceMotion.isAvailableAsync())) return;
        const permission = await DeviceMotion.requestPermissionsAsync();
        if (!active || !permission.granted) return;
        DeviceMotion.setUpdateInterval(50);
        sub = DeviceMotion.addListener(m => {
          if (!m.rotation || !Number.isFinite(m.rotation.beta) || !Number.isFinite(m.rotation.gamma)) return;
          last = Date.now();
          const beta = m.rotation.beta * rad2deg;
          const gamma = m.rotation.gamma * rad2deg;
          const pitch = Math.max(-10, Math.min(80, 90 - beta));
          const roll = Math.max(-35, Math.min(35, gamma));
          sm.current = { p: sm.current.p * 0.75 + pitch * 0.25, r: sm.current.r * 0.8 + roll * 0.2 };
          setTilt({ pitchDown: sm.current.p, roll: sm.current.r, ok: true });
        });
      } catch { /* AR remains paused when motion data is unavailable. */ }
    })();
    const timer = setInterval(() => { if (last && Date.now() - last > 3000) setTilt(t => t.ok ? { ...t, ok: false } : t); }, 1000);
    return () => { active = false; sub?.remove(); clearInterval(timer); };
  }, [enabled]);
  return tilt;
}

export default function ARGuidance() {
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [camera, requestCamera] = useCameraPermissions();
  const requestedCamera = useRef(false);
  const loc = useLocation();
  const nav = useNav();
  const { reduceMotion } = useApp();
  const tilt = usePose(true);
  const [offset, setOffset] = useState(0);               // manual compass correction from "Align with the path"
  const [calibrating, setCalibrating] = useState(false);
  const [aligned, setAligned] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { if (camera && !camera.granted && camera.canAskAgain && !requestedCamera.current) { requestedCamera.current = true; requestCamera(); } }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const route = nav.route;
  const line = route?.geometry.coordinates ?? [];
  const user = loc.coord ?? line[0] ?? null;
  const heading = loc.heading != null ? (loc.heading + offset + 360) % 360 : null;
  const pose: Pose | null = heading != null ? { heading, pitchDown: tilt.pitchDown, roll: tilt.roll } : null;
  const view = { width: screen.width, height: screen.height };

  const chevrons = useMemo(() => (pose && user && line.length ? chevronsAhead(line, user, pose, view) : []), [pose?.heading, pose?.pitchDown, pose?.roll, user?.[0], user?.[1], line, screen.width, screen.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const steer = pose && user && line.length ? steerHint(line, user, pose.heading, view) : null;
  const dest = line.at(-1);
  const label = pose && user && dest ? labelFor(dest, user, pose, view) : null;

  // Expo reports a calibration level from 0 to 3 on both iOS and Android.
  const headingWeak = loc.headingAccuracy == null || loc.headingAccuracy < 2;
  const gpsBad = !loc.simulated && (loc.accuracy == null || loc.accuracy > GPS_LIMIT_M || loc.timestamp == null || now - loc.timestamp > 15000);
  const needsCalibration = !arReady({ simulated: loc.simulated, accuracy: loc.accuracy, timestamp: loc.timestamp, now, heading, headingAccuracy: loc.headingAccuracy, aligned, motion: tilt.ok });
  const step = route?.steps[nav.progress.stepIndex];
  const onRoad = useMemo(() => {
    if (!user || !line.length) return null;
    const s = snapToLine(line, user);
    return route?.steps[Math.max(0, nav.progress.stepIndex - 1)]?.kind === 'road' ? 'Road · watch for cars' : s.off < 10 ? 'Pedestrian path' : null;
  }, [user?.[0], user?.[1], nav.progress.stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Point the phone along the path ahead and tap: the difference becomes the compass correction. */
  const alignWithPath = () => {
    if (!user || !line.length || loc.heading == null) return;
    const s = snapToLine(line, user);
    const ahead = bearing(pointAlong(line, s.along), pointAlong(line, s.along + 8));
    setOffset(angleDiff(loc.heading, ahead));
    setAligned(true);
    setCalibrating(false);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const pulse = (i: number) => (reduceMotion ? 1 : 0.5 + 0.5 * Math.max(0, Math.sin((Date.now() / 2100) * Math.PI * 2 - i * 0.7)));

  if (!route) {
    return (
      <View style={[styles.root, styles.center, { padding: 28 }]}>
        <T weight="bold" style={{ color: '#fff', fontSize: 20, textAlign: 'center' }}>Choose a destination first</T>
        <T style={{ color: '#C2C6CB', textAlign: 'center', marginTop: 8 }}>AR guidance follows a route. Pick a building and tap the AR button.</T>
        <Btn title="Back to the map" kind="secondary" onPress={back} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {camera?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : (
        <View style={[StyleSheet.absoluteFill, styles.center, { padding: 28, backgroundColor: '#0F1419' }]}>
          <Icon name="camera" size={36} stroke="#fff" />
          <T weight="bold" style={{ color: '#fff', fontSize: 18, marginTop: 12, textAlign: 'center' }}>Camera access is off</T>
          <T style={{ color: '#C2C6CB', textAlign: 'center', marginTop: 6 }}>AR draws the arrows over the camera view. The 2D route works without it.</T>
          <Btn title="Allow camera" onPress={requestCamera} style={{ marginTop: 18, alignSelf: 'stretch' }} />
          <Btn title="Use the 2D map instead" kind="secondary" onPress={back} style={{ marginTop: 10, alignSelf: 'stretch' }} />
        </View>
      )}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}>
        <View style={styles.gradTop} /><View style={styles.gradBottom} />
      </View>

      {/* arrows laid on the paving, 1.5 to 8 m ahead, fading past 8 m */}
      {!needsCalibration && camera?.granted && (
        <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="chev" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#22C55E" /><Stop offset="1" stopColor="#16A34A" /></LinearGradient>
          </Defs>
          {[...chevrons].reverse().map(c => (
            <Polygon key={c.key} points={c.points} fill="url(#chev)" fillOpacity={c.opacity * pulse(c.key)} stroke="#FFFFFF" strokeOpacity={0.55 * c.opacity} strokeWidth={1.5} strokeLinejoin="round" />
          ))}
        </Svg>
      )}

      {/* destination anchored to the building */}
      {camera?.granted && label?.visible && !needsCalibration && (
        <View pointerEvents="none" style={[styles.label, { left: label.x - 90, top: label.y - 46 }]}>
          <View style={styles.labelPill}>
            <Icon name="flagEnd" size={14} stroke="#fff" />
            <T weight="semibold" style={{ color: '#fff', fontSize: 13 }} numberOfLines={1}>{nav.dest?.name ?? 'Destination'} · {fmtDistance(label.dist)}</T>
          </View>
          {!label.clamped && <View style={styles.labelStem} />}
        </View>
      )}

      {/* when the path is off-screen, point the way to turn */}
      {camera?.granted && steer && !needsCalibration && (
        <Animated.View entering={FadeIn} exiting={FadeOut} pointerEvents="none" style={[styles.steer, steer.side === 'left' ? { left: 12 } : { right: 12 }]}>
          <View style={{ transform: [{ rotate: steer.around ? '180deg' : steer.side === 'left' ? '-90deg' : '90deg' }] }}><Icon name="arrowUp" size={30} stroke="#fff" width={3} /></View>
          <T weight="bold" style={{ color: '#fff', fontSize: 13, marginTop: 4 }}>{steer.around ? 'Turn around' : `Turn ${steer.side}`}</T>
        </Animated.View>
      )}

      {/* maneuver banner */}
      {camera?.granted && <Animated.View entering={FadeInDown.duration(300)} style={[styles.banner, { top: insets.top + 6 }]} accessibilityLiveRegion="polite">
        {step && <ManeuverIcon turn={step.turn} size={44} crossing={step.crossing} stairs={step.stairs} />}
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 22, letterSpacing: -0.5, color: '#fff' }}>{nav.status === 'arrived' ? 'Arrived' : fmtDistance(nav.progress.toNext)}</T>
          <T style={{ fontSize: 13.5, color: '#C2C6CB' }} numberOfLines={2}>{nav.status === 'arrived' ? route.steps.at(-1)?.text : step?.text ?? 'Follow the green arrows'}</T>
        </View>
        <IconBtn icon="close" label="Stop AR guidance" onPress={back} size={34} bg="rgba(255,255,255,0.16)" stroke="#fff" float={false} />
      </Animated.View>}

      {/* honest status */}
      {camera?.granted && <View style={[styles.pills, { top: insets.top + 92 }]}>
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: loc.simulated ? '#60A5FA' : gpsBad ? '#F59E0B' : '#4ADE80' }]} />
          <T weight="semibold" style={styles.pillText}>{loc.simulated ? 'Demo position' : loc.accuracy != null ? `GPS ±${Math.round(loc.accuracy)} m` : 'Finding GPS'}</T>
        </View>
        {onRoad && <View style={styles.pill}><Icon name={onRoad.startsWith('Road') ? 'car' : 'walk'} size={13} stroke="#E6E7E4" /><T weight="semibold" style={styles.pillText}>{onRoad}</T></View>}
        {offset !== 0 && <View style={styles.pill}><Icon name="calibrate" size={13} stroke="#E6E7E4" /><T weight="semibold" style={styles.pillText}>Aligned {offset > 0 ? '+' : ''}{Math.round(offset)}°</T></View>}
        {!tilt.ok && Platform.OS !== 'web' && <View style={styles.pill}><T weight="semibold" style={styles.pillText}>Motion sensor unavailable</T></View>}
      </View>}

      {camera?.granted && needsCalibration && !calibrating && <Pressable accessibilityRole="button" onPress={() => setCalibrating(true)} style={[styles.warning, { top: insets.top + 132 }]}>
        <T weight="semibold" style={{ color: '#fff' }}>Arrows paused · {gpsBad ? 'waiting for a better GPS fix' : !tilt.ok ? 'waiting for motion sensors' : 'align the compass'}</T>
        <T style={{ color: '#D2DAE5', fontSize: 12, marginTop: 3 }}>Tap for options. The camera and 2D route remain available.</T>
      </Pressable>}

      {/* bottom dock: the 2D route is one tap away */}
      {camera?.granted && <View style={[styles.dock, { bottom: insets.bottom + 18 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Switch back to the 2D map" onPress={back} style={styles.thumb}>
          <MiniRoute line={line} user={user} heading={heading ?? 0} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 17, color: '#fff' }}>{fmtMinutes(nav.progress.remainingS)} · {fmtDistance(nav.progress.remaining)}</T>
          <T style={{ fontSize: 12.5, color: '#A7ACB4' }}>{nav.status === 'arrived' ? 'You have arrived' : loc.simulated ? 'Demo overlay · not your real location' : 'Approximate overlay · check the path ahead'}</T>
        </View>
        {loc.simulated && <IconBtn icon="walk" label={nav.simulating ? 'Stop the simulated walk' : 'Simulate walking the route'} onPress={nav.toggleSimulate} size={44} bg={nav.simulating ? color.green : 'rgba(255,255,255,0.12)'} stroke="#fff" float={false} />}
        <IconBtn icon="calibrate" label="Recalibrate" onPress={() => setCalibrating(true)} size={44} bg="rgba(255,255,255,0.12)" stroke="#fff" float={false} />
      </View>}

      {/* board 19: calibration and the honest fallback */}
      {calibrating && camera?.granted && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut} style={[StyleSheet.absoluteFill, styles.calib]}>
          <View style={styles.calibCard}>
            <Icon name="calibrate" size={32} stroke="#fff" />
            <T weight="bold" style={{ color: '#fff', fontSize: 22, marginTop: 12 }} accessibilityRole="header">Line up the arrows</T>
            <T style={{ color: '#C2C6CB', fontSize: 14, lineHeight: 20, marginTop: 8 }}>
              Point the phone along the route ahead and tap “Align with the path”. The overlay is approximate and may shift; check the real path as you walk.
            </T>
            {(
              <View style={styles.meter}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T weight="semibold" style={{ color: '#fff' }}>GPS accuracy {loc.accuracy != null ? `±${Math.round(loc.accuracy)} m` : '—'}</T>
                  <T style={{ color: '#A7ACB4' }}>needs ±{GPS_LIMIT_M} m</T>
                </View>
                <View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${Math.max(8, Math.min(100, (GPS_LIMIT_M / Math.max(GPS_LIMIT_M, loc.accuracy ?? 60)) * 100))}%`, backgroundColor: gpsBad ? '#F59E0B' : '#4ADE80' }]} /></View>
                <T style={{ color: '#A7ACB4', fontSize: 12, marginTop: 8 }}>Accuracy is usually worse next to tall buildings and indoors. The 2D route keeps working either way.</T>
              </View>
            )}
            <Btn title="Use the 2D map instead" onPress={back} style={{ marginTop: 18 }} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Btn title="Align with the path" kind="secondary" small style={{ flex: 1 }} onPress={alignWithPath} disabled={loc.heading == null} />
              <Btn title="Back to camera" kind="ghost" small style={{ flex: 1 }} onPress={() => setCalibrating(false)} />
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/** The 2D route in miniature, rotated so up is the way you face. */
function MiniRoute({ line, user, heading }: { line: Position[]; user: Position | null; heading: number }) {
  const size = 64, scale = 0.7; // px per metre
  if (!user || line.length < 2) return <View style={{ flex: 1, backgroundColor: '#3E4C44' }} />;
  const h = heading * Math.PI / 180;
  const pts = line.map(p => {
    const [e, n] = enu(user, p);
    const x = e * Math.cos(h) - n * Math.sin(h), y = e * Math.sin(h) + n * Math.cos(h);
    return `${(size / 2 + x * scale).toFixed(1)},${(size / 2 - y * scale).toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={size} height={size} style={{ backgroundColor: '#3E4C44' }}>
      <Polyline points={pts} fill="none" stroke="#16A34A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={size / 2} cy={size / 2} r={5} fill="#2563EB" stroke="#fff" strokeWidth={2} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1419' },
  center: { alignItems: 'center', justifyContent: 'center' },
  gradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(8,11,14,0.28)' },
  gradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(8,11,14,0.3)' },
  banner: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: 'rgba(10,14,18,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  pills: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warning: { position: 'absolute', left: 12, right: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(10,14,18,0.82)' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(10,14,18,0.74)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  pillText: { fontSize: 11.5, color: '#E6E7E4' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { position: 'absolute', width: 180, alignItems: 'center' },
  labelPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(11,107,63,0.95)', maxWidth: 220 },
  labelStem: { width: 2, height: 26, backgroundColor: 'rgba(11,107,63,0.8)' },
  steer: { position: 'absolute', top: '45%', alignItems: 'center', padding: 12, borderRadius: 18, backgroundColor: 'rgba(22,163,74,0.9)' },
  dock: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: 'rgba(10,14,18,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  thumb: { width: 64, height: 64, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  calib: { backgroundColor: 'rgba(8,10,14,0.82)', justifyContent: 'center', padding: 20 },
  calibCard: { padding: 4 },
  meter: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 10, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
});
