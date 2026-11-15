import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import type { NoteKind } from '../api/types';
import { useT } from '../i18n';
import { Icon, T } from './kit';
import type { IconName } from './icons';

/** The door notes a professor can pick: an icon, a paper colour and a default line. */
export const NOTE_CHARACTERS: Record<NoteKind, { icon: IconName; label: string; short: string; paper: string; ink: string }> = {
  sick: { icon: 'sick', label: 'Out sick today', short: 'Sick', paper: '#FFE3DF', ink: '#9A2B23' },
  online: { icon: 'laptop', label: 'Online meetings today', short: 'Online', paper: '#E0ECFF', ink: '#1E3A8A' },
  appointment: { icon: 'calendarClock', label: 'Please take an appointment', short: 'By appointment', paper: '#E3F3E9', ink: '#0B6B3F' },
  email: { icon: 'mail', label: 'Email me, I answer fast', short: 'Email me', paper: '#EFE6FF', ink: '#5B21B6' },
  back_soon: { icon: 'hourglass', label: 'Back in a few minutes', short: 'Back soon', paper: '#FFF4BF', ink: '#6B4A05' },
  teaching: { icon: 'faculty', label: 'Teaching now, back after class', short: 'Teaching', paper: '#E6F0FF', ink: '#1D4ED8' },
  conference: { icon: 'plane', label: 'At a conference this week', short: 'Conference', paper: '#F1E8FF', ink: '#6D28D9' },
  away_week: { icon: 'calendar', label: 'Not here this week', short: 'Away this week', paper: '#FFE8D6', ink: '#9A3412' },
  semester_off: { icon: 'leave', label: 'On leave this semester', short: 'Semester off', paper: '#E0F2F1', ink: '#115E59' },
  hours_moved: { icon: 'moved', label: 'Office hours moved this week, see my card', short: 'Hours moved', paper: '#FEF3C7', ink: '#92400E' },
  custom: { icon: 'note', label: 'Note', short: 'Note', paper: '#FFF4BF', ink: '#4A3B05' },
};
export const NOTE_ORDER: NoteKind[] = ['back_soon', 'teaching', 'appointment', 'email', 'online', 'sick', 'conference', 'away_week', 'semester_off', 'hours_moved'];
/** Notes that also mean you are away: picking one sets your status for the same length. */
export const NOTE_AWAY: Partial<Record<NoteKind, { reason: string; length: 'today' | 'week' | 'semester' }>> = {
  sick: { reason: 'sick', length: 'today' }, conference: { reason: 'conference', length: 'week' }, away_week: { reason: 'away', length: 'week' }, semester_off: { reason: 'leave', length: 'semester' },
};

/** A sticky note on the office door: tilted paper, a pin, the icon pops in once. */
export function StickyNote({ kind, text, small, onPress }: { kind: NoteKind | null; text: string | null; small?: boolean; onPress?: () => void }) {
  const t = useT();
  const c = NOTE_CHARACTERS[kind ?? 'custom'];
  const pop = useSharedValue(0.6);
  useEffect(() => { pop.value = withSequence(withTiming(0.6, { duration: 0 }), withSpring(1, { damping: 9, stiffness: 220 })); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const body = (
    <View style={[styles.paper, { backgroundColor: c.paper, transform: [{ rotate: small ? '-1.2deg' : '-2deg' }] }, small && styles.small]}>
      <View style={styles.pin} />
      <Animated.View style={[styles.icon, { backgroundColor: '#ffffffa8' }, small && { width: 30, height: 30, borderRadius: 10 }, iconStyle]}>
        <Icon name={c.icon} size={small ? 16 : 20} stroke={c.ink} />
      </Animated.View>
      <T weight="semibold" style={{ flex: 1, color: c.ink, fontSize: small ? 13 : 15, lineHeight: small ? 17 : 20 }} numberOfLines={small ? 2 : 4}>{text || t(c.label)}</T>
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={t('Door note: {note}', { note: text || t(c.label) })} onPress={onPress}>{body}</Pressable> : body;
}

/**
 * The note as a little tilted tag right next to a professor's name (search, office lists),
 * so students see it before they walk over.
 */
export function NoteTag({ kind, text }: { kind: NoteKind | null; text?: string | null }) {
  const t = useT();
  const c = NOTE_CHARACTERS[kind ?? 'custom'];
  const wiggle = useSharedValue(0);
  useEffect(() => { wiggle.value = withSequence(withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 6 })); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${-5 + wiggle.value * 6}deg` }] }));
  if (!kind && !text) return null;
  return (
    <Animated.View style={[styles.tag, { backgroundColor: c.paper }, style]} accessibilityLabel={t('Door note: {note}', { note: text || t(c.label) })}>
      <Icon name={c.icon} size={11} stroke={c.ink} width={2.4} />
      <T weight="bold" numberOfLines={1} style={{ fontSize: 10.5, color: c.ink, maxWidth: 110 }}>{kind && kind !== 'custom' ? t(c.short) : (text ?? t(c.short))}</T>
    </Animated.View>
  );
}

/** A picker of notes (faculty status screen and the home widget). */
export function NotePicker({ value, onPick, compact }: { value: NoteKind | null; onPick: (k: NoteKind | null) => void; compact?: boolean }) {
  const t = useT();
  const Wrap = compact
    ? ({ children }: { children: React.ReactNode }) => <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{children}</ScrollView>
    : ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
  return (
    <Wrap>
      {NOTE_ORDER.map(k => {
        const c = NOTE_CHARACTERS[k];
        const on = value === k;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={t(c.label)} onPress={() => onPick(on ? null : k)}
            style={({ pressed }) => [styles.pick, { backgroundColor: on ? c.paper : '#fff', borderColor: on ? c.ink : '#E2E3DE' }, compact && styles.pickCompact, pressed && { transform: [{ scale: 0.95 }] }]}>
            <Icon name={c.icon} size={compact ? 18 : 17} stroke={on ? c.ink : '#3A3D42'} />
            {!compact && <T weight="semibold" style={{ fontSize: 12, color: on ? c.ink : '#3A3D42' }} numberOfLines={2}>{t(c.label)}</T>}
          </Pressable>
        );
      })}
    </Wrap>
  );
}

const styles = StyleSheet.create({
  paper: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingTop: 16, borderRadius: 6, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  small: { padding: 10, paddingTop: 12 },
  pin: { position: 'absolute', top: -5, left: '50%', marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: '#D1473F', borderWidth: 2, borderColor: '#fff' },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1.5, maxWidth: 180 },
  pickCompact: { width: 44, height: 44, paddingHorizontal: 0, justifyContent: 'center' },
});
