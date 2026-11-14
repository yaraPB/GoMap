import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Btn, T } from '../ui/kit';
import { color } from '../ui/theme';

type Mark = { title: string; body: string; spot: (w: number, h: number, top: number, bottom: number) => { x: number; y: number; w: number; h: number; r: number } };
const MARKS: Mark[] = [
  { title: 'Filter with the chips', body: 'Tap Academic, Dining or any chip: the map shows only those places. Tap again to clear. Academic also lets you pick a school.', spot: (w, _h, top) => ({ x: 8, y: top + 4, w: w - 16, h: 52, r: 26 }) },
  { title: 'Tap a building', body: 'You get its hours, the walk time, and what is inside: departments, then offices by floor, then each professor.', spot: (w, h) => ({ x: w / 2 - 70, y: h / 2 - 90, w: 140, h: 140, r: 70 }) },
  { title: 'Ask GoMap', body: '“Where is the library?”, “How do I declare a minor?”, “Is Harit Satt in?” For a place, directions open by themselves.', spot: (w, h, _t, bottom) => ({ x: 8, y: h - bottom - 82, w: w - 70, h: 64, r: 32 }) },
  { title: 'Or just say it', body: 'Hold the mic, speak, release. You can switch between English, French and Arabic.', spot: (w, h, _t, bottom) => ({ x: w - 66, y: h - bottom - 82, w: 58, h: 64, r: 32 }) },
];

export default function Help({ step = 0 }: { step?: number }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { pop } = usePanels();
  const { finishOnboarding } = useApp();
  const [i, setI] = useState(step);
  const m = MARKS[i];
  const s = m.spot(width, height, insets.top + 8, insets.bottom + 20);
  const done = () => { finishOnboarding(); pop(); };
  const cardTop = s.y > height / 2 ? Math.max(insets.top + 20, s.y - 210) : s.y + s.h + 18;
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      {/* dim everything except the spotlight: four rectangles around it */}
      <View style={[styles.dim, { top: 0, left: 0, right: 0, height: s.y }]} />
      <View style={[styles.dim, { top: s.y + s.h, left: 0, right: 0, bottom: 0 }]} />
      <View style={[styles.dim, { top: s.y, left: 0, width: s.x, height: s.h }]} />
      <View style={[styles.dim, { top: s.y, left: s.x + s.w, right: 0, height: s.h }]} />
      <Animated.View layout={LinearTransition.duration(260)} pointerEvents="none" style={{ position: 'absolute', left: s.x - 3, top: s.y - 3, width: s.w + 6, height: s.h + 6, borderRadius: s.r + 3, borderWidth: 3, borderColor: '#fff' }} />
      <Animated.View layout={LinearTransition.duration(260)} style={[styles.card, { top: cardTop }]}>
        <T weight="bold" style={{ fontSize: 11, letterSpacing: 0.6, color: color.blue }}>{`STEP ${i + 1} OF ${MARKS.length}`}</T>
        <T weight="bold" style={{ fontSize: 18, marginTop: 4 }} accessibilityRole="header">{m.title}</T>
        <T style={{ fontSize: 14, lineHeight: 20, color: color.ink2, marginTop: 6 }}>{m.body}</T>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" onPress={done} hitSlop={10}><T weight="semibold" style={{ color: color.muted }}>Skip</T></Pressable>
          <View style={{ flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center' }}>
            {MARKS.map((_, k) => <View key={k} style={{ width: k === i ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: k === i ? color.blue : color.line }} />)}
          </View>
          <Btn title={i === MARKS.length - 1 ? 'Done' : 'Next'} small onPress={() => (i === MARKS.length - 1 ? done() : setI(i + 1))} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: 'rgba(10,12,16,0.72)' },
  card: { position: 'absolute', left: 16, right: 16, padding: 18, borderRadius: 18, backgroundColor: '#fff' },
});
