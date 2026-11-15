import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCampus, usePerson, useServices } from '../api/hooks';
import type { NoteKind } from '../api/types';
import { useT } from '../i18n';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, T } from '../ui/kit';
import { NOTE_CHARACTERS, NotePicker, StickyNote } from '../ui/StickyNote';
import { color, shadow, type IconName } from '../ui/theme';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
function campusClock() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (k: string) => p.find(x => x.type === k)?.value ?? '';
  return { min: Number(get('hour')) * 60 + Number(get('minute')), weekend: ['Sat', 'Sun'].includes(get('weekday')) };
}

type Day = { icon: IconName; tint: string; title: string; line: string; vars?: Record<string, string>; progress: number; lunch?: [string, string]; state: string };

/** The campus day in one line: what is happening now. */
function useDay(): Day {
  const campus = useCampus();
  const t = useT();
  const [clock, setClock] = useState(campusClock);
  useEffect(() => { const id = setInterval(() => setClock(campusClock()), 30_000); return () => clearInterval(id); }, []);
  const c = campus.data;
  return useMemo(() => {
    const open = c ? toMin(c.open) : 540, close = c ? toMin(c.close) : 1050;
    const [ls, le] = c ? [toMin(c.lunch[0]), toMin(c.lunch[1])] : [780, 840];
    const m = clock.min;
    const dur = (mins: number) => (mins < 60 ? t('{n} min', { n: mins }) : t('{h} h {m} min', { h: Math.floor(mins / 60), m: mins % 60 }).replace(/ 0 min$/, ''));
    const base = { lunch: c?.lunch };
    if (clock.weekend) return { ...base, icon: 'sofa', tint: '#6D5BD0', title: 'Weekend', line: 'Offices are closed · dining is open', progress: 0, state: 'weekend' };
    if (m < open) return { ...base, icon: 'sunrise', tint: '#E0841F', title: 'Good morning', line: 'Offices open in {d}', vars: { d: dur(open - m) }, progress: 0, state: 'before' };
    if (m < ls) return { ...base, icon: 'sun', tint: '#D99A00', title: 'Offices are open', line: 'Lunch break in {d}', vars: { d: dur(ls - m) }, progress: (m - open) / (ls - open), state: 'morning' };
    if (m < le) return { ...base, icon: 'lunch', tint: '#E0841F', title: 'Lunch break', line: 'Offices reopen in {d}', vars: { d: dur(le - m) }, progress: (m - ls) / (le - ls), state: 'lunch' };
    if (m < close) return { ...base, icon: 'book', tint: '#2563EB', title: 'Afternoon', line: 'Offices close in {d}', vars: { d: dur(close - m) }, progress: (m - le) / (close - le), state: 'afternoon' };
    return { ...base, icon: 'moon', tint: '#4F46E5', title: 'Evening', line: 'Offices are closed · security is 24/7', progress: 1, state: 'after' };
  }, [c, clock, t]);
}

/** One widget per role, above the assistant pill. The chevron folds it into a chip. */
export default function RoleWidget({ bottom }: { bottom: number }) {
  const { user, firstSession } = useApp();
  const t = useT();
  const [open, setOpen] = useState(true);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? '90deg' : '-90deg', { duration: 220 }) }] }));
  // the first-visit tour offer sits in the same spot: show the widget once that is answered
  if (user.role === 'guest' || firstSession) return null;
  return (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOut} layout={LinearTransition.springify().damping(18)} style={[styles.wrap, { bottom }, !open && styles.folded]}>
      {user.role === 'faculty' ? <FacultyDoor open={open} /> : <CampusPulse open={open} staff={user.role === 'staff'} />}
      <Pressable accessibilityRole="button" accessibilityLabel={open ? t('Fold the widget') : t('Open the widget')} hitSlop={10} onPress={() => setOpen(!open)} style={styles.fold}>
        <Animated.View style={chevron}><Icon name="chevron" size={14} stroke={color.muted} /></Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function CampusPulse({ open, staff }: { open: boolean; staff: boolean }) {
  const day = useDay();
  const t = useT();
  const services = useServices();
  const { push } = usePanels();
  const openNow = (services.data ?? []).filter(s => s.open.state === 'open');
  const badge = <View style={[styles.badge, { backgroundColor: `${day.tint}1A` }]}><Icon name={day.icon} size={open ? 20 : 16} stroke={day.tint} /></View>;
  if (!open) return <View style={styles.row}>{badge}<T weight="semibold" style={{ fontSize: 13 }}>{t(day.title)}</T></View>;
  return (
    <View style={{ gap: 9 }}>
      <View style={styles.row}>
        {badge}
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 15 }}>{t(day.title)}</T>
          <T style={{ fontSize: 12.5, color: color.muted }}>{t(day.line, day.vars)}</T>
        </View>
      </View>
      {day.state !== 'weekend' && (
        <View style={styles.track} accessibilityLabel={t('Working day {p} percent done', { p: Math.round(day.progress * 100) })}>
          <View style={[styles.fill, { width: `${Math.round(Math.max(0.03, day.progress) * 100)}%`, backgroundColor: day.state === 'lunch' ? '#E0841F' : color.blue }]} />
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => push({ name: 'search', query: '' })} style={styles.row}>
        <View style={[styles.dot, { backgroundColor: openNow.length ? '#16A34A' : '#9CA3AF' }]} />
        <T style={{ flex: 1, fontSize: 12.5, color: color.ink2 }} numberOfLines={1}>
          {services.isLoading ? t('Checking offices…') : t('{a} of {b} offices open now', { a: openNow.length, b: services.data?.length ?? 0 })}{staff && day.lunch ? ` · ${t('lunch {from}–{to}', { from: day.lunch[0], to: day.lunch[1] })}` : ''}
        </T>
        <Icon name="chevron" size={13} stroke={color.muted} />
      </Pressable>
    </View>
  );
}

function FacultyDoor({ open }: { open: boolean }) {
  const { user } = useApp();
  const t = useT();
  const me = usePerson(user.person_id ?? user.id);
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (k: NoteKind | null) => api.setPresence(user.person_id ?? user.id, { status: 'keep', note_kind: k, note: k ? t(NOTE_CHARACTERS[k].label) : '' }),
    onSuccess: p => qc.setQueryData(['person', p.id], p),
  });
  const p = me.data;
  const badge = <View style={[styles.badge, { backgroundColor: '#E6F4EC' }]}><Icon name={p?.note_kind ? NOTE_CHARACTERS[p.note_kind].icon : 'door'} size={open ? 20 : 16} stroke="#0B6B3F" /></View>;
  if (!open) return <View style={styles.row}>{badge}<T weight="semibold" style={{ fontSize: 13 }}>{t('My door')}</T></View>;
  return (
    <View style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" onPress={() => router.push('/faculty-status')} style={styles.row}>
        {badge}
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 15 }}>{t('My door')}</T>
          <T style={{ fontSize: 12.5, color: color.muted }} numberOfLines={1}>{p ? t(p.availability.label) : t('Loading…')}</T>
        </View>
        <T weight="semibold" style={{ fontSize: 12.5, color: color.blue }}>{t('Status')}</T>
      </Pressable>
      {p && (p.note || p.note_kind) && <StickyNote small kind={p.note_kind} text={p.note} />}
      <NotePicker compact value={p?.note_kind ?? null} onPick={k => set.mutate(k)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 12, end: 78, padding: 12, paddingEnd: 30, borderRadius: 18, backgroundColor: '#fff', ...shadow.float },
  folded: { end: undefined, paddingVertical: 8 },
  fold: { position: 'absolute', top: 10, end: 8, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: color.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
