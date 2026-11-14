import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { RouteMode } from '../api/types';
import { fmtDistance, fmtMinutes } from '../ar/geo';
import { useApp, useLocation } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { ManeuverIcon } from '../ui/bits';
import { Btn, Icon, IconBtn, Label, Loading, Notice, Sheet, T, rise } from '../ui/kit';
import { color, shadow, type IconName } from '../ui/theme';

const arriveAt = (s: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + s * 1000));

/** Board 16 (+ board 13 when the assistant opened it): the route, its options, and Start. */
export function RoutePreview({ said, reply }: { said?: string; reply?: string }) {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const { replace, pop } = usePanels();
  const loc = useLocation();
  const r = nav.route;
  const close = () => { nav.stop(); pop(); };
  const startAR = () => { nav.start(); router.push('/ar'); replace({ name: 'go' }); };
  const modes: { id: RouteMode | 'indoor'; name: string; icon: IconName }[] = [
    { id: 'walk', name: 'Walk', icon: 'walk' }, { id: 'step_free', name: 'Step-free', icon: 'wheel' }, { id: 'indoor', name: 'Indoor', icon: 'building' },
  ];
  const [indoorNote, setIndoorNote] = useState(false);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* from / to, or the assistant's answer with the mode switch */}
      <Animated.View entering={rise} style={[styles.topCard, { top: insets.top + 8 }]}>
        {said ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={styles.spark}><Icon name="sparkle" size={16} stroke="#fff" /></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" style={{ fontSize: 14 }}>“{said}”</T>
                <T style={{ fontSize: 13, color: color.muted, marginTop: 2, lineHeight: 18 }}>{reply}</T>
              </View>
              <IconBtn icon="close" label="End directions" onPress={close} float={false} bg={color.surface} size={34} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {([['walk', 'Walk', 'walk'], ['ar', 'AR route', 'ar'], ['step_free', 'Step-free', 'wheel']] as const).map(([id, name, icon]) => {
                const on = id === 'ar' ? false : nav.mode === id;
                return (
                  <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => (id === 'ar' ? startAR() : nav.setMode(id))}
                    style={[styles.modeBtn, on ? { backgroundColor: color.ink, borderColor: color.ink } : null]}>
                    <Icon name={icon} size={16} stroke={on ? '#fff' : color.ink2} />
                    <T weight="semibold" style={{ fontSize: 12.5, color: on ? '#fff' : color.ink2 }}>{name}</T>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ alignItems: 'center', gap: 3 }}>
              <View style={[styles.fromDot]} /><View style={styles.dash} /><Icon name="pin" size={16} stroke={color.green} />
            </View>
            <View style={{ flex: 1, gap: 10 }}>
              <T style={{ fontSize: 14, color: color.muted }}>{nav.startedFromDemo ? 'Main plaza (demo position)' : 'Where you are now'}</T>
              <T weight="semibold" style={{ fontSize: 15 }} numberOfLines={1}>{nav.dest?.name ?? '…'}{r?.destination.entrance ? ` · ${r.destination.entrance}` : ''}</T>
            </View>
            <IconBtn icon="close" label="Close directions" onPress={close} float={false} bg={color.surface} size={36} />
          </View>
        )}
      </Animated.View>

      <Sheet snaps={[0.44, 0.86]}>
        {nav.status === 'loading' ? <Loading label="Finding the way" /> : nav.status === 'error' || !r ? (
          <View style={{ padding: 20, gap: 12 }}>
            <Notice tone="missing" icon="ban" text={nav.error ?? 'No route found on the mapped paths.'} />
            {nav.mode === 'step_free' && <Btn title="Show the walking route instead" kind="secondary" onPress={() => nav.setMode('walk')} />}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {modes.map(m => {
                const on = m.id === nav.mode;
                return (
                  <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: on, disabled: m.id === 'indoor' }}
                    onPress={() => (m.id === 'indoor' ? setIndoorNote(true) : nav.setMode(m.id))}
                    style={[styles.option, on && { backgroundColor: color.ink, borderColor: color.ink }, m.id === 'indoor' && { opacity: 0.55 }]}>
                    <Icon name={m.icon} size={17} stroke={on ? '#fff' : color.ink2} />
                    <T weight="semibold" style={{ fontSize: 13.5, color: on ? '#fff' : color.ink2 }}>{m.name}</T>
                  </Pressable>
                );
              })}
            </View>
            {indoorNote && <Notice tone="info" icon="building" text="Indoor shortcuts need ground-floor plans, which GoMap does not have yet. Walk and step-free routes stay outdoors." />}
            <Animated.View layout={LinearTransition} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <T weight="bold" style={{ fontSize: 28, letterSpacing: -0.6, color: color.greenDeep }}>{fmtMinutes(r.duration_s)}</T>
              <T style={{ fontSize: 14, color: color.muted }}>{fmtDistance(r.distance_m)} · arrive {arriveAt(r.duration_s)}</T>
            </Animated.View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {r.crossings.length > 0 && <Fact icon="crossing" text={`${r.crossings.length} road crossing${r.crossings.length > 1 ? 's' : ''} · cars`} />}
              {!r.uses_roads && <Fact icon="walk" text="Walkways the whole way" tone="green" />}
              {r.mode === 'step_free' && <Fact icon="wheel" text="No stairs on this route" tone="green" />}
              {r.destination.entrance && <Fact icon="door" text={`${r.destination.entrance}${r.destination.entrance_estimated ? ' (position estimated)' : ''}`} tone="blue" />}
            </View>
            {nav.startedFromDemo && <Notice tone="info" icon="locate" text={loc.reason === 'no-permission' ? 'Location is off, so this starts from the main plaza.' : 'You are away from AUI, so this starts from the main plaza. Use "Simulate walk" during the trip to try it.'} />}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Start" icon="arrowUp" kind="green" style={{ flex: 1 }} onPress={() => { nav.start(); replace({ name: 'go' }); }} />
              <Btn title="AR" icon="ar" kind="secondary" style={{ width: 96 }} onPress={startAR} />
            </View>
            <View>
              <Label style={{ marginBottom: 6 }}>Steps</Label>
              {r.steps.map((s, i) => (
                <View key={i} style={[styles.step, i === r.steps.length - 1 && { borderBottomWidth: 0 }]}>
                  <ManeuverIcon turn={s.turn} size={32} crossing={s.crossing} stairs={s.stairs} bg={s.turn === 'arrive' ? color.greenDeep : color.surface} />
                  <T style={{ flex: 1, fontSize: 14 }}>{s.text}</T>
                  {s.distance_m > 0 && <T weight="semibold" style={{ fontSize: 13, color: color.muted }}>{fmtDistance(s.distance_m)}</T>}
                </View>
              ))}
            </View>
            <T style={{ fontSize: 11, color: color.muted }}>Paths and roads © Mapbox © OpenStreetMap contributors. Check them on site: some campus paths may be missing.</T>
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

function Fact({ icon, text, tone = 'grey' }: { icon: IconName; text: string; tone?: 'grey' | 'green' | 'blue' }) {
  const [bg, fg] = { grey: ['#F2F3F0', '#3A3D42'], green: ['#E6F4EC', '#0B6B3F'], blue: ['#E8EEFB', '#2563EB'] }[tone];
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, height: 32, borderRadius: 9, backgroundColor: bg }}><Icon name={icon} size={15} stroke={fg} /><T weight="semibold" style={{ fontSize: 12.5, color: fg }}>{text}</T></View>;
}

/** Board 17: turn-by-turn on the 2D map. Shares progress with AR through the navigation session. */
export function TurnByTurn() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const loc = useLocation();
  const { reset, replace } = usePanels();
  const [showSteps, setShowSteps] = useState(false);
  const r = nav.route;
  useEffect(() => { if (nav.status === 'arrived') replace({ name: 'arrived' }); }, [nav.status, replace]);
  if (!r) return null;
  const step = r.steps[nav.progress.stepIndex] ?? r.steps.at(-1)!;
  const then = r.steps[nav.progress.stepIndex + 1];
  const end = () => { nav.stop(); reset(); };
  const rerouting = nav.progress.off > 25;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeInDown.duration(300)} style={[styles.banner, { top: insets.top + 8 }]} accessibilityLiveRegion="polite">
        <ManeuverIcon turn={step.turn} size={52} crossing={step.crossing} stairs={step.stairs} />
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 28, letterSpacing: -0.6, color: '#fff' }}>{fmtDistance(nav.progress.toNext)}</T>
          <T weight="medium" style={{ fontSize: 15, color: '#fff', marginTop: 1 }} numberOfLines={2}>{step.text}</T>
          {then && <T style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)', marginTop: 4 }} numberOfLines={1}>Then {then.text.toLowerCase()}{then.distance_m ? ` · ${fmtDistance(then.distance_m)}` : ''}</T>}
        </View>
      </Animated.View>
      {rerouting && <Animated.View entering={FadeIn} style={[styles.reroute, { top: insets.top + 132 }]}><T weight="semibold" style={{ color: color.warnText, fontSize: 12.5 }}>Off the route · finding a new way</T></Animated.View>}

      <View style={[styles.side, { top: insets.top + (rerouting ? 176 : 140) }]}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/ar')} style={styles.camBtn}>
          <Icon name="camera" size={18} stroke={color.ink} /><T weight="semibold" style={{ fontSize: 13 }}>Use camera</T>
        </Pressable>
        <IconBtn icon={nav.muted ? 'ban' : 'bolt'} label={nav.muted ? 'Unmute voice guidance' : 'Mute voice guidance'} onPress={() => nav.setMuted(!nav.muted)} size={44} />
        {loc.simulated && (
          <Pressable accessibilityRole="button" onPress={nav.toggleSimulate} style={[styles.camBtn, nav.simulating && { backgroundColor: color.ink }]}>
            <Icon name="walk" size={18} stroke={nav.simulating ? '#fff' : color.ink} />
            <T weight="semibold" style={{ fontSize: 13, color: nav.simulating ? '#fff' : color.ink }}>{nav.simulating ? 'Stop' : 'Simulate walk'}</T>
          </Pressable>
        )}
      </View>

      <Animated.View entering={FadeInUp.duration(300)} style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}>
        {showSteps && (
          <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {r.steps.map((s, i) => (
              <View key={i} style={[styles.step, i < nav.progress.stepIndex - 1 && { opacity: 0.4 }]}>
                <ManeuverIcon turn={s.turn} size={30} crossing={s.crossing} stairs={s.stairs} bg={i === nav.progress.stepIndex ? color.green : color.surface} />
                <T style={{ flex: 1, fontSize: 14 }}>{s.text}</T>
                {s.distance_m > 0 && <T weight="semibold" style={{ fontSize: 13, color: color.muted }}>{fmtDistance(s.distance_m)}</T>}
              </View>
            ))}
          </ScrollView>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T weight="bold" style={{ fontSize: 20, color: color.greenDeep }}>{fmtMinutes(nav.progress.remainingS)}</T>
            <T style={{ fontSize: 12.5, color: color.muted }}>{fmtDistance(nav.progress.remaining)} left · arrive {arriveAt(nav.progress.remainingS)}</T>
          </View>
          <Btn title={showSteps ? 'Hide' : 'Steps'} kind="secondary" small onPress={() => setShowSteps(!showSteps)} />
          <Btn title="End" kind="dark" small onPress={end} style={{ backgroundColor: color.danger }} />
        </View>
      </Animated.View>
    </View>
  );
}

/** Board 20: arrival, and written directions for the last bit inside (no floor plans). */
export function Arrived() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const { reset, push } = usePanels();
  const { user } = useApp();
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const r = nav.route;
  const dest = nav.dest;
  const done = () => { nav.stop(); reset(); };
  return (
    <Sheet snaps={[0.5]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.check}><Icon name="check" size={22} stroke="#fff" width={3} /></View>
          <View style={{ flex: 1 }}>
            <T weight="semibold" style={{ fontSize: 13, color: color.greenDeep }}>You have arrived</T>
            <T weight="bold" style={{ fontSize: 23, letterSpacing: -0.4 }} accessibilityRole="header">{dest?.name ?? 'Destination'}</T>
            {r && <T style={{ fontSize: 13, color: color.muted }}>{fmtMinutes(r.duration_s)} · {fmtDistance(r.distance_m)} walked</T>}
          </View>
        </View>
        {r?.destination.entrance && <Notice tone="info" icon="door" text={`${r.destination.entrance}${r.destination.step_free ? ' · step-free' : ''}${r.destination.entrance_estimated ? '. The door position is estimated until the campus office confirms it.' : '.'}`} />}
        <View>
          <Label style={{ marginBottom: 8 }}>The last bit, inside</Label>
          <View style={{ gap: 10 }}>
            <Row icon="door" text="Go in through the entrance in front of you" />
            <Row icon="stairs" text="Offices 1xx are on the first floor, 2xx on the second, 0xx and one- or two-digit rooms on the ground floor" />
            <Row icon="building" text="Indoor floor plans are not mapped yet. Door cards show the office numbers." />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {dest && user.role !== 'guest' && <Btn title="Offices here" kind="secondary" style={{ flex: 1 }} onPress={() => { const id = dest.placeId; done(); push({ name: 'offices', placeId: id }); }} />}
          <Btn title="Done" kind="dark" style={{ flex: 1 }} onPress={done} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.hairline }}>
          <T style={{ flex: 1, fontSize: 13, color: color.muted }}>{feedback ? (feedback === 'up' ? 'Thanks!' : 'Thanks — tell us what was wrong.') : 'Did the directions get it right?'}</T>
          <IconBtn icon="check" label="Yes" onPress={() => setFeedback('up')} size={38} float={false} bg={feedback === 'up' ? '#E6F4EC' : color.surface} stroke={color.greenDeep} />
          <IconBtn icon="close" label="No, report a problem" onPress={() => { setFeedback('down'); push({ name: 'report', at: r?.geometry.coordinates.at(-1) as [number, number] | undefined }); }} size={38} float={false} bg={color.surface} stroke={color.danger} />
        </View>
      </ScrollView>
    </Sheet>
  );
}
function Row({ icon, text }: { icon: IconName; text: string }) {
  return <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={17} stroke={color.ink2} /></View><T style={{ flex: 1, fontSize: 14, lineHeight: 19 }}>{text}</T></View>;
}

const styles = StyleSheet.create({
  topCard: { position: 'absolute', left: 12, right: 12, padding: 14, borderRadius: 18, backgroundColor: '#fff', ...shadow.float },
  spark: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.blue, alignItems: 'center', justifyContent: 'center' },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 11, borderWidth: 1, borderColor: '#E2E3DE', backgroundColor: '#fff' },
  fromDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.blue, borderWidth: 2, borderColor: '#fff', ...shadow.float },
  dash: { width: 2, height: 14, backgroundColor: color.line },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#E2E3DE' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  banner: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, backgroundColor: '#0B6B3F', ...shadow.float },
  reroute: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: color.warnBg },
  side: { position: 'absolute', right: 12, alignItems: 'flex-end', gap: 10 },
  camBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: '#fff', ...shadow.float },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 14, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, ...shadow.sheet },
  check: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' },
});
