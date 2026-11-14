import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { NoteKind } from '../api/types';
import { T } from './kit';

/** The door-note characters a professor can pick. Each has a face, a colour and a default line. */
export const NOTE_CHARACTERS: Record<NoteKind, { face: string; prop: string; label: string; paper: string; ink: string }> = {
  sick: { face: '🤒', prop: '🌡️', label: 'Out sick today', paper: '#FFE0DC', ink: '#8A2A20' },
  online: { face: '🧑‍💻', prop: '💻', label: 'Online meetings today', paper: '#DDEBFF', ink: '#1E3A8A' },
  appointment: { face: '🗓️', prop: '✍️', label: 'Please take an appointment', paper: '#E6F4EC', ink: '#0B6B3F' },
  email: { face: '📮', prop: '✉️', label: 'Email me, I answer fast', paper: '#F1E8FF', ink: '#5B21B6' },
  back_soon: { face: '🏃', prop: '⏳', label: 'Back in a few minutes', paper: '#FFF4B8', ink: '#6B4A05' },
  custom: { face: '📝', prop: '📌', label: 'Note', paper: '#FFF4B8', ink: '#4A3B05' },
};
export const NOTE_ORDER: NoteKind[] = ['sick', 'online', 'appointment', 'email', 'back_soon'];

/** A sticky note on the office door: slightly tilted paper, a pin, a character that wiggles once. */
export function StickyNote({ kind, text, small, onPress }: { kind: NoteKind | null; text: string | null; small?: boolean; onPress?: () => void }) {
  const c = NOTE_CHARACTERS[kind ?? 'custom'];
  const wiggle = useSharedValue(0);
  useEffect(() => {
    wiggle.value = withSequence(withTiming(1, { duration: 140 }), withRepeat(withTiming(-1, { duration: 180, easing: Easing.inOut(Easing.quad) }), 3, true), withTiming(0, { duration: 140 }));
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const face = useAnimatedStyle(() => ({ transform: [{ rotate: `${wiggle.value * 12}deg` }] }));
  const body = (
    <View style={[styles.paper, { backgroundColor: c.paper, transform: [{ rotate: small ? '-1deg' : '-2deg' }] }, small && styles.small]}>
      <View style={styles.pin} />
      <Animated.Text style={[{ fontSize: small ? 22 : 30 }, face]} accessibilityElementsHidden>{c.face}</Animated.Text>
      <View style={{ flex: 1 }}>
        <T weight="semibold" style={{ color: c.ink, fontSize: small ? 13 : 15, lineHeight: small ? 17 : 20 }} numberOfLines={small ? 2 : 4}>{text || c.label}</T>
      </View>
      {!small && <T style={{ fontSize: 18 }} accessibilityElementsHidden>{c.prop}</T>}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Door note: ${text || c.label}`} onPress={onPress}>{body}</Pressable> : body;
}

/** A picker of characters (for the faculty status screen and the home widget). */
export function NotePicker({ value, onPick, compact }: { value: NoteKind | null; onPick: (k: NoteKind | null) => void; compact?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: compact ? 'nowrap' : 'wrap', gap: 8 }}>
      {NOTE_ORDER.map(k => {
        const c = NOTE_CHARACTERS[k];
        const on = value === k;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.label} onPress={() => onPick(on ? null : k)}
            style={[styles.pick, { backgroundColor: on ? c.paper : '#fff', borderColor: on ? c.ink : '#E2E3DE' }, compact && { paddingHorizontal: 8 }]}>
            <T style={{ fontSize: compact ? 20 : 22 }}>{c.face}</T>
            {!compact && <T weight="semibold" style={{ fontSize: 12, color: on ? c.ink : '#3A3D42' }} numberOfLines={2}>{c.label}</T>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingTop: 16, borderRadius: 6, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  small: { padding: 10, paddingTop: 12 },
  pin: { position: 'absolute', top: -5, left: '50%', marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: '#D1473F', borderWidth: 2, borderColor: '#fff' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, maxWidth: 170 },
});
