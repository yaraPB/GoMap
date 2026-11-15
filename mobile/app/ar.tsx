import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Polyline, Stop } from 'react-native-svg';
import type { Position } from '../src/api/types';
import { bearing, enu, fmtDistance, fmtMinutes, pointAlong, snapToLine } from '../src/ar/geo';
import { chevronsAhead, labelFor, pathRibbon, turnMarker, type Pose } from '../src/ar/projection';
import { cameraPose, HeadingFusion } from '../src/ar/orientation';
import { useApp, useLocation } from '../src/state/app';
import { useNav } from '../src/state/navigation';
import { ManeuverIcon } from '../src/ui/bits';
import { Btn, Icon, IconBtn, T } from '../src/ui/kit';
import { useLang, useT, clock } from '../src/i18n';
import { trStep } from '../src/i18n/steps';
import { fmtDistanceT } from '../src/ar/geo';

const GPS_LIMIT_M = 15;      // arrows are exact-ish below this
const GPS_PAUSE_M = 40;      // above this they would point at the wrong path
const FLOW_MS = 1400;        // one chevron spacing per 1.4 s, about walking pace
const WRONG_WAY_DEG = 120;   // facing away from the route…
const WRONG_WAY_MS = 1500;   // …for this long: say "turn around"

/**
 * Where the camera looks, from every sensor: attitude (gyro-fused rotation) for smooth, instant
 * movement at any tilt; compass and walking course to keep it pointing at true north.
 * pitchDown: 0 = camera at the horizon, 90 = straight down.
 */
function usePose(compass: { heading: number | null; accuracy: number | null; course: number | null }) {
  const [pose, setPose] = useState({ heading: null as number | null, pitchDown: 20, roll: 0, yaw: 0, ok: false, t: 0 });
  const fusion = useRef(new HeadingFusion());
  const sensors = useRef(compass);
  sensors.current = compass;
  const sm = useRef({ p: 20, r: 0 });
  useEffect(() => {
    let active = true;
    let last = 0, drawn = 0;
    let sub: { remove: () => void } | undefined;
    void (async () => {
      try {
        if (!(await DeviceMotion.isAvailableAsync())) return;
        const permission = await DeviceMotion.requestPermissionsAsync();
        if (!active || !permission.granted) return;
        DeviceMotion.setUpdateInterval(33);
        sub = DeviceMotion.addListener(m => {
          const r = m.rotation;
          if (!r || !Number.isFinite(r.alpha) || !Number.isFinite(r.beta) || !Number.isFinite(r.gamma)) return;
          const now = Date.now();
          last = now;
          const cam = cameraPose(r.alpha, r.beta, r.gamma);
          const s = sensors.current;
          const heading = fusion.current.update({ yaw: cam.yaw, pitchDown: cam.pitchDown, compass: s.heading, compassAccuracy: s.accuracy, course: s.course, t: now, platform: Platform.OS });
          // light smoothing on tilt only: the gyro is already clean, heading is fused above
          sm.current = { p: sm.current.p * 0.6 + Math.max(-30, Math.min(89, cam.pitchDown)) * 0.4, r: sm.current.r * 0.6 + Math.max(-40, Math.min(40, cam.roll)) * 0.4 };
          if (now - drawn < 33) return; // ~30 fps is plenty for SVG
          drawn = now;
          setPose({ heading, pitchDown: sm.current.p, roll: sm.current.r, yaw: cam.yaw, ok: true, t: now });
        });
      } catch { /* AR remains paused when motion data is unavailable. */ }
    })();
    const timer = setInterval(() => { if (last && Date.now() - last > 3000) setPose(p => (p.ok ? { ...p, ok: false } : p)); }, 1000);
    return () => { active = false; sub?.remove(); clearInterval(timer); };
  }, []);
  return { ...pose, fusion: fusion.current };
}

/**
 * AR guidance, designed to need no explanation:
 *  - one instruction at the top, in words ("Turn left") with the distance under it, and what comes next;
 *  - green arrows on the paving, and a big arrow at your feet that always points the way;
 *  - a coach that tells you how to hold the phone, and "Turn around" when you face the wrong way;
 *  - at the bottom: stop, time and distance left, the map. Everything else is one tap away.
 */
export default function ARGuidance() {
  const t = useT();
  const lang = useLang();
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [camera, requestCamera] = useCameraPermissions();
  const requestedCamera = useRef(false);
  const loc = useLocation();
  const nav = useNav();
  const { reduceMotion } = useApp();
  const sensed = usePose({ heading: loc.rawHeading, accuracy: loc.headingAccuracy, course: loc.course });
  const [calibrating, setCalibrating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [coached, setCoached] = useState(false);
  const [now, setNow] = useState(Date.now());

  // the camera opens at once: ask on arrival, no intermediate screen
  useEffect(() => { if (!requestedCamera.current && camera && !camera.granted && camera.canAskAgain) { requestedCamera.current = true; requestCamera(); } }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const route = nav.route;
  const line = route?.geometry.coordinates ?? [];
  // stand on the route when we are close to it: GPS error then shifts arrows along the path, not sideways off it
  const onRoute = nav.progress.snapped && nav.progress.off < 15 ? nav.progress.snapped : null;
  const user = onRoute ?? loc.coord ?? line[0] ?? null;
  const heading = sensed.heading ?? loc.heading;
  const pose: Pose | null = heading != null && sensed.ok ? { heading, pitchDown: sensed.pitchDown, roll: sensed.roll } : null;
  const view = { width: screen.width, height: screen.height };
  const flow = reduceMotion ? 0 : (sensed.t % FLOW_MS) / FLOW_MS;

  const step = route?.steps[nav.progress.stepIndex];
  const nextStep = route?.steps[nav.progress.stepIndex + 1];
  const ribbon = useMemo(() => (pose && user && line.length ? pathRibbon(line, user, pose, view) : []), [pose?.heading, pose?.pitchDown, pose?.roll, user?.[0], user?.[1], line, screen.width, screen.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const chevrons = pose && user && line.length ? chevronsAhead(line, user, pose, view, 6, flow) : [];
  const turn = pose && user && step && step.turn !== 'straight' && step.turn !== 'arrive' ? turnMarker(line, user, step.at, pose, view) : null;
  const dest = line.at(-1);
  const label = pose && user && dest ? labelFor(dest, user, pose, view) : null;

  const stale = loc.timestamp == null || now - loc.timestamp > 20000;
  const gpsBad = !loc.simulated && (loc.accuracy == null || loc.accuracy > GPS_LIMIT_M || stale);
  const gpsLost = !loc.simulated && (loc.accuracy == null || loc.accuracy > GPS_PAUSE_M || stale);
  const needsCalibration = !pose;
  const arrowAlpha = gpsLost ? 0.45 : gpsBad ? 0.7 : 1;
  const arrived = nav.status === 'arrived';

  /** The way to go relative to where the camera points: drives the big arrow at your feet. */
  const guideRel = pose && user && line.length ? (() => {
    const sn = snapToLine(line, user);
    const target = pointAlong(line, Math.min(sn.along + 8, sn.along + Math.max(2, nav.progress.toNext)));
    return ((bearing(user, target) - pose.heading + 540) % 360) - 180;
  })() : null;

  // how the phone is held: the arrows need the camera on the path ahead
  const tilt: 'ok' | 'down' | 'up' = !pose ? 'ok' : pose.pitchDown > 72 ? 'down' : pose.pitchDown < -8 ? 'up' : 'ok';
  useEffect(() => { if (pose && tilt === 'ok' && !coached) { const id = setTimeout(() => setCoached(true), 1800); return () => clearTimeout(id); } }, [!!pose, tilt, coached]); // eslint-disable-line react-hooks/exhaustive-deps

  // facing away from the route for a moment: one clear "turn around", with a buzz
  const awaySince = useRef<number | null>(null);
  const [wrongWay, setWrongWay] = useState(false);
  useEffect(() => {
    const away = guideRel != null && Math.abs(guideRel) > WRONG_WAY_DEG && !arrived;
    if (!away) { awaySince.current = null; if (wrongWay) setWrongWay(false); return; }
    awaySince.current ??= Date.now();
    if (!wrongWay && Date.now() - awaySince.current > WRONG_WAY_MS) {
      setWrongWay(true);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }, [guideRel != null && Math.abs(guideRel) > WRONG_WAY_DEG, now]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Point the phone along the path ahead and tap: the difference becomes the compass correction. */
  const alignWithPath = () => {
    if (!user || !line.length || !sensed.ok) return;
    const s = snapToLine(line, user);
    const ahead = bearing(pointAlong(line, s.along), pointAlong(line, s.along + 8));
    sensed.fusion.align(sensed.yaw, ahead);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCalibrating(false);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const pulse = (i: number) => (reduceMotion ? 1 : 0.5 + 0.5 * Math.max(0, Math.sin((Date.now() / 2100) * Math.PI * 2 - i * 0.7)));
  const eta = new Date(Date.now() + nav.progress.remainingS * 1000).toISOString();

  if (!route) {
    return (
      <View style={[styles.root, styles.center, { padding: 28 }]}>
        <T weight="bold" style={{ color: '#fff', fontSize: 20, textAlign: 'center' }}>{t('Choose a destination first')}</T>
        <T style={{ color: '#C2C6CB', textAlign: 'center', marginTop: 8 }}>{t('AR guidance follows a route. Pick a building and tap the AR button.')}</T>
        <Btn title={t('Back to the map')} kind="secondary" onPress={back} style={{ marginTop: 20 }} />
      </View>
    );
  }

  // instruction in words first, distance second ("Turn left" / "in 20 m")
  const instruction = arrived ? t('You have arrived') : step ? trStep(step.text, t) : t('Follow the green arrows');
  const distLine = arrived ? (trStep(route.steps.at(-1)?.text ?? '', t) || (nav.dest?.name ?? '')) : step?.turn === 'arrive' ? t('{d} to the entrance', { d: fmtDistanceT(nav.progress.toNext, t) }) : t('in {d}', { d: fmtDistanceT(nav.progress.toNext, t) });

  return (
    <View style={styles.root}>
      {camera?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" animateShutter={false} /> : !camera || camera.canAskAgain && !requestedCamera.current ? null : (
        <View style={[StyleSheet.absoluteFill, styles.center, { padding: 28, backgroundColor: '#0F1419' }]}>
          <Icon name="camera" size={36} stroke="#fff" />
          <T weight="bold" style={{ color: '#fff', fontSize: 18, marginTop: 12, textAlign: 'center' }}>{t('Camera access is off')}</T>
          <T style={{ color: '#C2C6CB', textAlign: 'center', marginTop: 6 }}>{t('AR draws the arrows over the camera view. The 2D route works without it.')}</T>
          <Btn title={t('Allow camera')} onPress={requestCamera} style={{ marginTop: 18, alignSelf: 'stretch' }} />
          <Btn title={t('Use the 2D map instead')} kind="secondary" onPress={back} style={{ marginTop: 10, alignSelf: 'stretch' }} />
        </View>
      )}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={styles.gradTop} /><View style={styles.gradBottom} /></View>

      {/* arrows laid on the paving, 1.5 to 8 m ahead, fading past 8 m */}
      {!needsCalibration && camera?.granted && !arrived && (
        <Svg width={screen.width} height={screen.height} style={StyleSheet.absoluteFill} pointerEvents="none" opacity={arrowAlpha}>
          <Defs>
            <LinearGradient id="chev" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#4ADE80" /><Stop offset="1" stopColor="#16A34A" /></LinearGradient>
            <LinearGradient id="turn" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#60A5FA" /><Stop offset="1" stopColor="#2563EB" /></LinearGradient>
          </Defs>
          {ribbon.map((r, i) => <Polygon key={`r${i}`} points={r.points} fill="#22C55E" fillOpacity={0.24 * r.opacity} />)}
          {[...chevrons].reverse().map(c => (
            <React.Fragment key={c.key}>
              {c.shadow && <Polygon points={c.shadow} fill="#000" fillOpacity={0.28 * c.opacity} />}
              {c.edge && <Polygon points={c.edge} fill="#0B6B3F" fillOpacity={0.9 * c.opacity} />}
              <Polygon points={c.points} fill="url(#chev)" fillOpacity={c.opacity} stroke="#FFFFFF" strokeOpacity={0.7 * c.opacity} strokeWidth={1.5} strokeLinejoin="round" />
            </React.Fragment>
          ))}
          {turn && (
            <>
              {turn.shadow && <Polygon points={turn.shadow} fill="#000" fillOpacity={0.3} />}
              <Polygon points={turn.points} fill="url(#turn)" fillOpacity={0.5 + 0.5 * pulse(0)} stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
            </>
          )}
        </Svg>
      )}

      {/* destination anchored to the building */}
      {camera?.granted && label?.visible && !needsCalibration && (
        <View pointerEvents="none" style={[styles.label, { left: label.x - 90, top: label.y - 46 }]}>
          <View style={styles.labelPill}>
            <Icon name="flagEnd" size={14} stroke="#fff" />
            <T weight="semibold" style={{ color: '#fff', fontSize: 13 }} numberOfLines={1}>{nav.dest?.name ?? t('Destination')} · {fmtDistanceT(label.dist, t)}</T>
          </View>
          {!label.clamped && <View style={styles.labelStem} />}
        </View>
      )}

      {/* the big arrow at your feet: always visible, always points the way to go */}
      {camera?.granted && guideRel != null && !arrived && !wrongWay && (
        <View pointerEvents="none" style={[styles.guide, { bottom: insets.bottom + (mapOpen ? 300 : 120) }]}>
          <View style={{ transform: [{ perspective: 700 }, { rotateX: '58deg' }, { rotateZ: `${Math.max(-150, Math.min(150, guideRel))}deg` }] }}>
            <GuideArrow dim={gpsLost} />
          </View>
        </View>
      )}

      {/* one instruction, in words */}
      {camera?.granted && (
        <Animated.View key={`${nav.progress.stepIndex}-${arrived}`} entering={FadeInDown.duration(280)} style={[styles.banner, { top: insets.top + 8 }]} accessibilityLiveRegion="polite">
          <View style={styles.bannerMain}>
            {step && !arrived ? <ManeuverIcon turn={step.turn} size={48} crossing={step.crossing} stairs={step.stairs} /> : <View style={styles.doneDot}><Icon name="check" size={26} stroke="#fff" width={3} /></View>}
            <View style={{ flex: 1 }}>
              <T weight="bold" numberOfLines={2} style={{ fontSize: 22, lineHeight: 27, letterSpacing: -0.4, color: '#fff' }}>{instruction}</T>
              <T weight="semibold" numberOfLines={1} style={{ fontSize: 14.5, color: '#9BE7B5', marginTop: 2 }}>{distLine}</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={nav.muted ? t('Turn voice guidance on') : t('Turn voice guidance off')} onPress={() => nav.setMuted(!nav.muted)} hitSlop={8} style={styles.mute}>
              <Icon name={nav.muted ? 'mute' : 'volume'} size={18} stroke="#fff" />
            </Pressable>
          </View>
          {nextStep && !arrived && nextStep.turn !== 'arrive' && (
            <View style={styles.bannerNext}>
              <T style={{ color: '#A7ACB4', fontSize: 12.5 }}>{t('Then')}</T>
              <ManeuverIcon turn={nextStep.turn} size={18} crossing={nextStep.crossing} stairs={nextStep.stairs} />
              <T numberOfLines={1} style={{ flex: 1, color: '#E6E7E4', fontSize: 12.5 }}>{trStep(nextStep.text, t)}</T>
            </View>
          )}
        </Animated.View>
      )}

      {/* honest, quiet status: one pill; tap it for the details and calibration */}
      {camera?.granted && !arrived && (
        <Pressable accessibilityRole="button" accessibilityLabel={t('Accuracy and calibration')} onPress={() => setCalibrating(true)} style={[styles.status, { top: insets.top + (nextStep ? 132 : 104) }]}>
          <View style={[styles.dot, { backgroundColor: loc.simulated ? '#60A5FA' : gpsBad ? '#F59E0B' : '#4ADE80' }]} />
          <T weight="semibold" style={styles.statusText}>
            {loc.simulated ? t('Demo position') : loc.accuracy != null ? t('GPS ±{n} m', { n: Math.round(loc.accuracy) }) : t('Finding GPS')}
            {gpsBad && !loc.simulated ? ` · ${t('Arrows approximate')}` : ''}{sensed.fusion.aligned ? ` · ${t('Aligned with the path')}` : ''}
          </T>
        </Pressable>
      )}

      {/* coach: how to hold the phone (first seconds, and whenever it points at the floor or the sky) */}
      {camera?.granted && !arrived && !calibrating && (needsCalibration || !coached || tilt !== 'ok') && (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(200)} pointerEvents="none" style={[styles.coach, { top: screen.height * 0.36 }]}>
          <View style={[styles.coachPhone, { transform: [{ rotate: tilt === 'down' ? '-28deg' : tilt === 'up' ? '28deg' : '0deg' }] }]}><Icon name="phone2" size={30} stroke="#fff" /></View>
          <T weight="bold" style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>
            {needsCalibration ? (!sensed.ok ? t('Waiting for the motion sensors…') : t('Waiting for the compass…'))
              : tilt === 'down' ? t('Raise your phone a little') : tilt === 'up' ? t('Lower your phone a little') : t('Hold your phone up, camera on the path ahead')}
          </T>
          <T style={{ color: '#D2DAE5', fontSize: 12.5, textAlign: 'center', marginTop: 4 }}>{t('The arrows lie on the ground in front of you.')}</T>
        </Animated.View>
      )}

      {/* facing the wrong way */}
      {camera?.granted && wrongWay && (
        <Animated.View entering={ZoomIn.duration(220)} exiting={FadeOut.duration(200)} pointerEvents="none" style={[styles.wrong, { top: screen.height * 0.34 }]}>
          <Icon name="turnAround" size={44} stroke="#fff" width={2.6} />
          <T weight="bold" style={{ color: '#fff', fontSize: 22, marginTop: 8 }}>{t('Turn around')}</T>
          <T style={{ color: '#FDE2CC', fontSize: 13, marginTop: 2 }}>{t('The route is behind you')}</T>
        </Animated.View>
      )}

      {/* arrived */}
      {camera?.granted && arrived && (
        <Animated.View entering={FadeInUp.duration(320)} style={[styles.arrived, { bottom: insets.bottom + 18 }]}>
          <View style={styles.arrivedIcon}><Icon name="flagEnd" size={26} stroke="#fff" /></View>
          <T weight="bold" style={{ color: '#fff', fontSize: 22, marginTop: 10 }}>{nav.dest?.name ?? t('Destination')}</T>
          <T style={{ color: '#C2C6CB', fontSize: 14, marginTop: 4, textAlign: 'center' }}>{trStep(route.steps.at(-1)?.text ?? 'You have arrived', t)}</T>
          <Btn title={t('Done')} onPress={back} style={{ alignSelf: 'stretch', marginTop: 16 }} />
        </Animated.View>
      )}

      {/* the map, bigger, when you want it */}
      {camera?.granted && mapOpen && !arrived && (
        <Animated.View entering={FadeInUp.duration(240)} exiting={FadeOut.duration(180)} style={[styles.mapCard, { bottom: insets.bottom + 100 }]}>
          <MiniRoute line={line} user={user} heading={heading ?? 0} size={screen.width - 24} height={180} scale={1.1} />
        </Animated.View>
      )}

      {/* bottom bar: stop · time and distance left · map */}
      {camera?.granted && !arrived && (
        <View style={[styles.dock, { bottom: insets.bottom + 18 }]}>
          <IconBtn icon="close" label={t('Stop AR guidance')} onPress={back} size={48} bg="rgba(255,255,255,0.12)" stroke="#fff" float={false} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T weight="bold" style={{ fontSize: 22, color: '#9BE7B5', letterSpacing: -0.3 }}>{fmtMinutes(nav.progress.remainingS)}</T>
            <T style={{ fontSize: 12.5, color: '#C2C6CB' }}>{fmtDistance(nav.progress.remaining)} · {t('arrive {time}', { time: clock(eta, lang) })}</T>
          </View>
          {loc.simulated && <IconBtn icon="walk" label={nav.simulating ? t('Stop the simulated walk') : t('Simulate walking the route')} onPress={nav.toggleSimulate} size={48} bg={nav.simulating ? '#16A34A' : 'rgba(255,255,255,0.12)'} stroke="#fff" float={false} />}
          <IconBtn icon="map" label={mapOpen ? t('Hide the map') : t('Show the map')} onPress={() => setMapOpen(o => !o)} size={48} bg={mapOpen ? '#16A34A' : 'rgba(255,255,255,0.12)'} stroke="#fff" float={false} />
        </View>
      )}

      {/* board 19: calibration and the honest fallback */}
      {calibrating && camera?.granted && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut} style={[StyleSheet.absoluteFill, styles.calib]}>
          <View style={styles.calibCard}>
            <Icon name="calibrate" size={32} stroke="#fff" />
            <T weight="bold" style={{ color: '#fff', fontSize: 22, marginTop: 12 }} accessibilityRole="header">{t('Line up the arrows')}</T>
            <T style={{ color: '#C2C6CB', fontSize: 14, lineHeight: 20, marginTop: 8 }}>{t('Point the phone along the path ahead and tap “Align with the path”. The overlay is approximate; check the real path as you walk.')}</T>
            <View style={styles.meter}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T weight="semibold" style={{ color: '#fff' }}>{t('GPS accuracy')} {loc.accuracy != null ? `±${Math.round(loc.accuracy)} m` : '—'}</T>
                <T style={{ color: '#A7ACB4' }}>{t('needs ±{n} m', { n: GPS_LIMIT_M })}</T>
              </View>
              <View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${Math.max(8, Math.min(100, (GPS_LIMIT_M / Math.max(GPS_LIMIT_M, loc.accuracy ?? 60)) * 100))}%`, backgroundColor: gpsBad ? '#F59E0B' : '#4ADE80' }]} /></View>
              <T style={{ color: '#A7ACB4', fontSize: 12, marginTop: 8 }}>{t('Accuracy is usually worse next to tall buildings and indoors. The 2D route keeps working either way.')}</T>
            </View>
            <Btn title={t('Align with the path')} onPress={alignWithPath} disabled={!sensed.ok} style={{ marginTop: 18 }} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Btn title={t('Use the 2D map instead')} kind="secondary" small style={{ flex: 1 }} onPress={back} />
              <Btn title={t('Back to camera')} kind="ghost" small style={{ flex: 1 }} onPress={() => setCalibrating(false)} />
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/** A thick 3D-looking arrow (top face + darker side + shadow), drawn flat and tilted onto the floor by the parent. */
function GuideArrow({ dim }: { dim: boolean }) {
  const top = 'M60 6 L108 62 L78 62 L78 120 L42 120 L42 62 L12 62 Z';
  return (
    <Svg width={120} height={140} viewBox="0 0 120 140" opacity={dim ? 0.55 : 0.95}>
      <Defs>
        <LinearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#4ADE80" /><Stop offset="1" stopColor="#16A34A" /></LinearGradient>
      </Defs>
      <Path d={top} transform="translate(5 12)" fill="#000" fillOpacity={0.28} />
      <Path d={top} transform="translate(0 8)" fill="#0B6B3F" />
      <Path d={top} fill="url(#ga)" stroke="#fff" strokeWidth={3} strokeLinejoin="round" />
    </Svg>
  );
}

/** The 2D route in miniature, rotated so up is the way you face. */
function MiniRoute({ line, user, heading, size = 64, height, scale = 0.7 }: { line: Position[]; user: Position | null; heading: number; size?: number; height?: number; scale?: number }) {
  const h2 = height ?? size;
  if (!user || line.length < 2) return <View style={{ width: size, height: h2, backgroundColor: '#3E4C44' }} />;
  const h = heading * Math.PI / 180;
  const pts = line.map(p => {
    const [e, n] = enu(user, p);
    const x = e * Math.cos(h) - n * Math.sin(h), y = e * Math.sin(h) + n * Math.cos(h);
    return `${(size / 2 + x * scale).toFixed(1)},${(h2 * 0.62 - y * scale).toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={size} height={h2} style={{ backgroundColor: '#2F3B35' }}>
      <Polyline points={pts} fill="none" stroke="#0B4D23" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points={pts} fill="none" stroke="#22C55E" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={size / 2} cy={h2 * 0.62} r={7} fill="#2563EB" stroke="#fff" strokeWidth={2.5} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F1419' },
  center: { alignItems: 'center', justifyContent: 'center' },
  gradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 220, backgroundColor: 'rgba(8,11,14,0.28)' },
  gradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(8,11,14,0.3)' },
  banner: { position: 'absolute', left: 12, right: 12, borderRadius: 22, backgroundColor: 'rgba(10,14,18,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  bannerMain: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  bannerNext: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  doneDot: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  mute: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  status: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(10,14,18,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  statusText: { fontSize: 11.5, color: '#E6E7E4' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { position: 'absolute', width: 180, alignItems: 'center' },
  labelPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(11,107,63,0.95)', maxWidth: 220 },
  labelStem: { width: 2, height: 26, backgroundColor: 'rgba(11,107,63,0.8)' },
  guide: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  coach: { position: 'absolute', left: 32, right: 32, alignItems: 'center', padding: 18, borderRadius: 22, backgroundColor: 'rgba(10,14,18,0.72)' },
  coachPhone: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  wrong: { position: 'absolute', alignSelf: 'center', alignItems: 'center', paddingVertical: 20, paddingHorizontal: 28, borderRadius: 26, backgroundColor: 'rgba(194,65,12,0.92)' },
  arrived: { position: 'absolute', left: 12, right: 12, alignItems: 'center', padding: 22, borderRadius: 24, backgroundColor: 'rgba(10,14,18,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  arrivedIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  mapCard: { position: 'absolute', left: 12, right: 12, height: 180, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  dock: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 24, backgroundColor: 'rgba(10,14,18,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  calib: { backgroundColor: 'rgba(8,10,14,0.86)', justifyContent: 'center', padding: 20 },
  calibCard: { padding: 4 },
  meter: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 10, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
});
