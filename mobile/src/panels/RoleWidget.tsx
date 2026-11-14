import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCampus, usePerson, useServices } from '../api/hooks';
import type { NoteKind } from '../api/types';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, T } from '../ui/kit';
import { NOTE_CHARACTERS, NotePicker, StickyNote } from '../ui/StickyNote';
import { color, shadow } from '../ui/theme';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
function campusClock() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return { min: Number(get('hour')) * 60 + Number(get('minute')), weekend: ['Sat', 'Sun'].includes(get('weekday')) };
}
const fmt = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());

/** The campus day as a character: what is happening now, in one line. */
function useDay() {
  const campus = useCampus();
  const [clock, setClock] = useState(campusClock);
  useEffect(() => { const id = setInterval(() => setClock(campusClock()), 30_000); return () => clearInterval(id); }, []);
  const c = campus.data;
  return useMemo(() => {
    const open = c ? toMin(c.open) : 540, close = c ? toMin(c.close) : 1050;
    const [ls, le] = c ? [toMin(c.lunch[0]), toMin(c.lunch[1])] : [780, 840];
    const m = clock.min;
    if (clock.weekend) return { face: '🛋️', title: 'Weekend', line: 'Offices are closed · dining is open', progress: 0, lunch: c?.lunch, state: 'weekend' as const };
    if (m < open) return { face: '🌅', title: 'Good morning', line: `Offices open in ${fmt(open - m)}`, progress: 0, lunch: c?.lunch, state: 'before' as const };
    if (m < ls) return { face: '☀️', title: 'Offices are open', line: `Lunch break in ${fmt(ls - m)}`, progress: (m - open) / (ls - open), lunch: c?.lunch, state: 'morning' as const };
    if (m < le) return { face: '🍲', title: 'Lunch break', line: `Offices reopen in ${fmt(le - m)}`, progress: (m - ls) / (le - ls), lunch: c?.lunch, state: 'lunch' as const };
    if (m < close) return { face: '📚', title: 'Afternoon', line: `Offices close in ${fmt(close - m)}`, progress: (m - le) / (close - le), lunch: c?.lunch, state: 'afternoon' as const };
    return { face: '🌙', title: 'Evening', line: 'Offices are closed · security is 24/7', progress: 1, lunch: c?.lunch, state: 'after' as const };
  }, [c, clock]);
}

/** One widget per role, above the assistant pill. Tap the chevron to fold it into a chip. */
export default function RoleWidget({ bottom }: { bottom: number }) {
  const { user, firstSession } = useApp();
  const [open, setOpen] = useState(true);
  // the first-visit tour offer sits in the same spot: show the widget once that is answered
  if (user.role === 'guest' || firstSession) return null;
  return (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOut} layout={LinearTransition} style={[styles.wrap, { bottom }, !open && styles.folded]}>
      {user.role === 'faculty' ? <FacultyDoor open={open} /> : <CampusPulse open={open} staff={user.role === 'staff'} />}
      <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Fold the widget' : 'Open the widget'} hitSlop={10} onPress={() => setOpen(!open)} style={styles.fold}>
        <View style={{ transform: [{ rotate: open ? '90deg' : '-90deg' }] }}><Icon name="chevron" size={14} stroke={color.muted} /></View>
      </Pressable>
    </Animated.View>
  );
}

function CampusPulse({ open, staff }: { open: boolean; staff: boolean }) {
  const day = useDay();
  const services = useServices();
  const { push } = usePanels();
  const openNow = (services.data ?? []).filter(s => s.open.state === 'open');
  if (!open) return <View style={styles.row}><T style={{ fontSize: 20 }}>{day.face}</T><T weight="semibold" style={{ fontSize: 13 }}>{day.title}</T></View>;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        <T style={{ fontSize: 28 }} accessibilityElementsHidden>{day.face}</T>
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 15 }}>{day.title}</T>
          <T style={{ fontSize: 12.5, color: color.muted }}>{day.line}</T>
        </View>
      </View>
      {/* the working day as a bar, lunch shaded */}
      {day.state !== 'weekend' && (
        <View style={styles.track} accessibilityLabel={`Working day ${Math.round(day.progress * 100)} percent done`}>
          <View style={[styles.fill, { width: `${Math.round(Math.max(0.03, day.progress) * 100)}%`, backgroundColor: day.state === 'lunch' ? '#E0841F' : color.blue }]} />
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => push({ name: 'search', query: '' })} style={styles.row}>
        <View style={[styles.dot, { backgroundColor: openNow.length ? '#16A34A' : '#9CA3AF' }]} />
        <T style={{ flex: 1, fontSize: 12.5, color: color.ink2 }} numberOfLines={1}>
          {services.isLoading ? 'Checking offices…' : `${openNow.length} of ${services.data?.length ?? 0} offices open now${staff && day.lunch ? ` · lunch ${day.lunch[0]}–${day.lunch[1]}` : ''}`}
        </T>
        <Icon name="chevron" size={13} stroke={color.muted} />
      </Pressable>
    </View>
  );
}

function FacultyDoor({ open }: { open: boolean }) {
  const { user } = useApp();
  const me = usePerson(user.person_id ?? user.id);
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (k: NoteKind | null) => api.setPresence(user.person_id ?? user.id, { status: 'keep', note_kind: k, note: k ? NOTE_CHARACTERS[k].label : '' }),
    onSuccess: p => qc.setQueryData(['person', p.id], p),
  });
  const p = me.data;
  if (!open) return <View style={styles.row}><T style={{ fontSize: 20 }}>{p?.note_kind ? NOTE_CHARACTERS[p.note_kind].face : '🚪'}</T><T weight="semibold" style={{ fontSize: 13 }}>My door</T></View>;
  return (
    <View style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" onPress={() => router.push('/faculty-status')} style={styles.row}>
        <T style={{ fontSize: 22 }}>🚪</T>
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 15 }}>My door</T>
          <T style={{ fontSize: 12.5, color: color.muted }} numberOfLines={1}>{p ? `${p.availability.label}${p.availability.detail ? ` · ${p.availability.detail}` : ''}` : 'Loading…'}</T>
        </View>
        <T weight="semibold" style={{ fontSize: 12.5, color: color.blue }}>Status</T>
      </Pressable>
      {p && (p.note || p.note_kind) && <StickyNote small kind={p.note_kind} text={p.note} />}
      <NotePicker compact value={p?.note_kind ?? null} onPick={k => set.mutate(k)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 78, padding: 12, paddingRight: 30, borderRadius: 18, backgroundColor: '#fff', ...shadow.float },
  folded: { right: undefined, paddingVertical: 8 },
  fold: { position: 'absolute', top: 10, right: 8, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { height: 6, borderRadius: 3, backgroundColor: color.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
