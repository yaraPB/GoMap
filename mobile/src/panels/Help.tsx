import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePlaces } from '../api/hooks';
import type { Category } from '../api/types';
import { CAMPUS_CENTER } from '../map/mapHtml';
import { useMap, useMapEvent } from '../map/MapContext';
import { useApp } from '../state/app';
import { usePanels, type Panel } from '../state/panels';
import { Btn, Icon, IconBtn, T } from '../ui/kit';
import { categoryIcon, categoryName, type IconName } from '../ui/theme';

const STOPS: { title: string; body: string; icon: IconName; tint: string; ink: string }[] = [
  { title: 'What are you looking for?', body: 'Pick one below. Watch the map find your spots.', icon: 'map', tint: '#E8F3EB', ink: '#226348' },
  { title: 'Find your next stop', body: 'Tap a colored pin to take a closer look. Numbers open a group of places.', icon: 'pin', tint: '#FFF0DD', ink: '#95571A' },
  { title: 'Meet your guide', body: 'Find a place, an office, or your next step. Just ask.', icon: 'sparkle', tint: '#EDF1FF', ink: '#375ED1' },
];
const PICKS: { id: Category; label: string; icon: IconName }[] = [
  { id: 'dining', label: 'Food', icon: 'fork' },
  { id: 'academic', label: 'Study', icon: 'cap' },
  { id: 'athletics', label: 'Sports', icon: 'gym' },
];

/** A live practice tour. Nothing covers or pretends to highlight the map. */
export default function Help({ step = 0 }: { step?: number }) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reset } = usePanels();
  const { finishOnboarding, reduceMotion } = useApp();
  const { send } = useMap();
  const places = usePlaces();
  const [i, setI] = useState(Math.max(0, Math.min(2, step)));
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [cardHeight, setCardHeight] = useState(300);
  const finishRef = useRef(finishOnboarding);
  finishRef.current = finishOnboarding;
  const m = STOPS[i];
  const list = (places.data ?? []).filter(p => category === 'all' || p.category === category);
  const place = places.data?.find(p => p.id === selected);
  const example = list.find(p => /library/i.test(p.name)) ?? list[0];
  const bottom = insets.bottom + 16;
  const mapBottom = Math.min(cardHeight + bottom + 20, height * 0.65);
  const feedback = () => { if (!reduceMotion) void Haptics.selectionAsync().catch(() => {}); };

  useEffect(() => () => {
    finishRef.current();
    send({ type: 'filter', category: 'all', school: 'all' });
    send({ type: 'select', id: null, fly: false });
    send({ type: 'camera', duration: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }, [send]);

  useEffect(() => {
    if (selected) {
      send({ type: 'select', id: selected, bottom: mapBottom, dim: false });
      return;
    }
    send({ type: 'filter', category, school: 'all', fit: true,
      padding: { top: insets.top + 88, bottom: mapBottom, left: 44, right: 44 } });
    if (category === 'all') send({ type: 'camera', center: CAMPUS_CENTER, zoom: 16.5, pitch: 45, bearing: -23,
      padding: { top: insets.top + 88, bottom: mapBottom, left: 24, right: 24 } });
  }, [send, category, selected, mapBottom, insets.top, places.data]);

  const choosePlace = (id: string) => { feedback(); setSelected(id); setI(1); };
  useMapEvent(e => { if (e.type === 'select' && i < 2) choosePlace(e.detail); });
  const done = (panel?: Panel) => { finishOnboarding(); reset(panel); };
  const next = () => { feedback(); setI(n => Math.min(2, n + 1)); };
  const enter = reduceMotion ? undefined : FadeInDown.duration(240);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { top: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.badge}>
          <Icon name="globe" size={17} stroke="#226348" />
          <T weight="semibold" style={styles.badgeText}>A little campus adventure</T>
        </View>
        <IconBtn icon="close" label="Leave the tour" size={44} float={false} onPress={() => done()} />
      </View>

      <Animated.View entering={enter} exiting={reduceMotion ? undefined : FadeOut.duration(150)}
        layout={reduceMotion ? undefined : LinearTransition.duration(220)}
        onLayout={e => setCardHeight(e.nativeEvent.layout.height)}
        style={[styles.card, { bottom, left: Math.max(12, (width - 480) / 2), right: Math.max(12, (width - 480) / 2), maxHeight: Math.max(200, (height - insets.top - insets.bottom) * (height < 700 ? 0.7 : 0.58)) }]}>
          <View style={styles.progressRow} accessibilityLabel={`Tour, ${i + 1} of 3`}>
            <View style={styles.tracks}>
              {STOPS.map((_, k) => <View key={k} style={[styles.track, { backgroundColor: k <= i ? m.ink : '#E8EBE6' }]} />)}
            </View>
            <T weight="semibold" style={styles.counter}>{i + 1} / 3</T>
            <Pressable accessibilityRole="button" onPress={() => done()} style={styles.skip}>
              <T weight="medium" style={styles.skipText}>Skip tour</T>
            </Pressable>
          </View>

        <ScrollView key={i} bounces={false} style={{ flexShrink: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
            <View style={styles.heading}>
              <View style={[styles.medallion, { backgroundColor: m.tint }]}><Icon name={m.icon} size={23} stroke={m.ink} /></View>
              <T weight="bold" accessibilityRole="header" style={styles.title}>{place && i === 1 ? 'There you go!' : m.title}</T>
            </View>
            <T style={styles.body}>{place && i === 1 ? 'This is your place. Open it for hours, directions, and what’s inside.' : m.body}</T>

            {i === 0 && <>
              <View style={styles.choices}>
                {PICKS.map(p => <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: category === p.id }}
                  onPress={() => { feedback(); setSelected(null); setCategory(category === p.id ? 'all' : p.id); }}
                  style={({ pressed }) => [styles.choice, category === p.id && styles.chosen, pressed && styles.pressed]}>
                  <Icon name={p.icon} size={20} stroke={category === p.id ? '#fff' : '#226348'} />
                  <T weight="semibold" style={[styles.choiceText, category === p.id && { color: '#fff' }]}>{p.label}</T>
                </Pressable>)}
              </View>
              <View style={styles.feedback} accessibilityLiveRegion="polite">
                <Icon name={category === 'all' ? 'locate' : 'check'} size={15} stroke="#226348" />
                <T style={styles.feedbackText}>{places.isError ? 'Places couldn’t load. You can still explore the tour.' : places.isPending ? 'Finding campus places…' : category === 'all' ? 'Try a category. Tap it again to show everything.' : `${list.length} ${list.length === 1 ? 'spot' : 'spots'} on the map. Pick another to switch it up.`}</T>
              </View>
            </>}

            {i === 1 && (place ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${place.name}`} onPress={() => done({ name: 'place', id: place.id })} style={({ pressed }) => [styles.place, pressed && styles.pressed]}>
                <View style={styles.placeIcon}><Icon name={categoryIcon(place.category)} size={22} stroke="#95571A" /></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <T weight="semibold" style={{ fontSize: 15 }} numberOfLines={2}>{place.name}</T>
                  <T style={styles.placeMeta}>{categoryName(place.category)} · Open place</T>
                </View>
                <Icon name="chevron" size={18} stroke="#95571A" />
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" disabled={!example} onPress={() => example && choosePlace(example.id)} style={({ pressed }) => [styles.example, pressed && styles.pressed]}>
                <Icon name="pin" size={18} stroke="#95571A" />
                <T weight="medium" style={styles.exampleText}>{example ? `Or try ${example.name}` : places.isError ? 'Places are unavailable right now. You can continue.' : 'Finding a place to try…'}</T>
                {example && <Icon name="chevron" size={17} stroke="#95571A" />}
              </Pressable>
            ))}

            {i === 2 && <View style={styles.askOptions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Ask GoMap: Where is the library?" onPress={() => done({ name: 'assistant', ask: 'Where is the library?' })}
                style={({ pressed }) => [styles.question, pressed && styles.pressed]}>
                <Icon name="sparkle" size={20} stroke="#375ED1" />
                <T weight="medium" style={styles.questionText}>Where is the library?</T>
                <Icon name="send" size={19} stroke="#375ED1" />
              </Pressable>
              <View style={styles.choices}>
                <Btn title="Type a question" icon="doc" kind="secondary" style={{ flex: 1 }} small onPress={() => done({ name: 'assistant' })} />
                <Btn title="Use my voice" icon="mic" kind="secondary" style={{ flex: 1 }} small onPress={() => done({ name: 'voice' })} />
              </View>
              <T style={styles.voiceHint}>English, French, or Arabic. Open the mic, then hold to talk.</T>
            </View>}
          </Animated.View>
        </ScrollView>

          <View style={styles.footer}>
            {i > 0 && <IconBtn icon="back" label="Previous tour step" size={44} float={false} bg="#F1F3EF" onPress={() => { feedback(); setI(n => n - 1); }} />}
            <Btn title={i === 0 ? 'Let’s find a place' : i === 1 ? 'Meet your guide' : 'Let’s explore'} icon={i === 2 ? 'check' : 'chevron'}
              kind="dark" style={{ flex: 1, borderRadius: 16 }} onPress={i === 2 ? () => done() : next} />
          </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  badge: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#F6FAF5', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 24, flexShrink: 1 },
  badgeText: { color: '#226348', fontSize: 12, flexShrink: 1 },
  card: { position: 'absolute', borderRadius: 26, backgroundColor: '#FEFFFC', borderWidth: 1, borderColor: '#fff', shadowColor: '#15251C', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 8, overflow: 'hidden' },
  content: { paddingHorizontal: 20, paddingBottom: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 6 },
  tracks: { flex: 1, flexDirection: 'row', gap: 5 },
  track: { flex: 1, height: 4, borderRadius: 2 },
  counter: { fontSize: 11, color: '#6A756C' },
  skip: { minHeight: 44, justifyContent: 'center', paddingLeft: 8 },
  skipText: { fontSize: 12, color: '#69756E' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medallion: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, lineHeight: 27, letterSpacing: -0.5, color: '#1E3026' },
  body: { fontSize: 14, lineHeight: 20, color: '#667168', marginTop: 12 },
  choices: { flexDirection: 'row', gap: 8, marginTop: 14 },
  choice: { flex: 1, minHeight: 54, padding: 10, borderRadius: 16, backgroundColor: '#EDF3ED', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chosen: { backgroundColor: '#226348' },
  choiceText: { fontSize: 13, color: '#226348' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  feedback: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 12, minHeight: 32 },
  feedbackText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#617368' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF4E7', padding: 14, borderRadius: 16, marginTop: 14 },
  placeIcon: { backgroundColor: '#FFE7C5', width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  placeMeta: { fontSize: 12, color: '#80664C' },
  example: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFF4E7', padding: 14, borderRadius: 16, marginTop: 14, minHeight: 52 },
  exampleText: { flex: 1, color: '#805B30', fontSize: 13, lineHeight: 18 },
  askOptions: { marginTop: 14 },
  question: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, backgroundColor: '#EDF1FF', minHeight: 58, padding: 14 },
  questionText: { flex: 1, fontSize: 14, color: '#324D99' },
  voiceHint: { fontSize: 12, lineHeight: 17, color: '#69756E', marginTop: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
});
