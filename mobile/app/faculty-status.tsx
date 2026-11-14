import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/api/client';
import { usePerson } from '../src/api/hooks';
import { useApp } from '../src/state/app';
import { usePanels } from '../src/state/panels';
import { todayKey } from '../src/ui/bits';
import { Avatar, Btn, Icon, IconBtn, Label, Loading, Notice, T } from '../src/ui/kit';
import { color, type IconName } from '../src/ui/theme';

type Status = 'in' | 'busy' | 'out';
const STATES: { id: Status; name: string; colour: string; icon: IconName }[] = [
  { id: 'in', name: 'I am in', colour: '#0B6B3F', icon: 'check' },
  { id: 'busy', name: 'Busy', colour: '#8A5A00', icon: 'clock' },
  { id: 'out', name: 'Not in', colour: '#5F6368', icon: 'close' },
];
const REASONS = [['meeting', 'In a meeting'], ['teaching', 'Teaching'], ['campus', 'Elsewhere on campus'], ['away', 'Off campus'], ['none', 'Rather not say']] as const;
const DAY = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as const;

/** Until options: 30 min, the next two half-hours on the clock, rest of today. */
function untilOptions() {
  const now = new Date();
  const half = new Date(now); half.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
  const a = new Date(half.getTime() + 60 * 60000), b = new Date(half.getTime() + 150 * 60000);
  const hm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return [
    { id: '30', name: '30 min', iso: new Date(now.getTime() + 30 * 60000).toISOString() },
    { id: 'a', name: hm(a), iso: a.toISOString() },
    { id: 'b', name: hm(b), iso: b.toISOString() },
    { id: 'today', name: 'Rest of today', iso: null as string | null },
  ];
}

export default function FacultyStatus() {
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const { push } = usePanels();
  const qc = useQueryClient();
  const { data: me, isLoading } = usePerson(user.role === 'faculty' ? user.id : null);
  const [status, setStatus] = useState<Status>('in');
  const [reason, setReason] = useState<string>('meeting');
  const untils = useMemo(untilOptions, []);
  const [until, setUntil] = useState('today');
  const [note, setNote] = useState<string | null>(null);
  const today = todayKey();
  const todayHours = me?.hours?.[today];
  const inPostedHours = me?.open.state === 'open';
  const save = useMutation({
    mutationFn: (s: Status | 'clear') => api.setPresence(user.id, s === 'clear' ? { status: 'clear', note: note ?? me?.note ?? '' } : { status: s, reason: s === 'in' ? null : reason, until: untils.find(u => u.id === until)?.iso ?? null, note: note ?? me?.note ?? '' }),
    onSuccess: p => { qc.setQueryData(['person', user.id], p); qc.invalidateQueries({ queryKey: ['offices'] }); qc.invalidateQueries({ queryKey: ['people'] }); },
  });

  if (user.role !== 'faculty') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 20, padding: 24 }]}>
        <Notice text="This screen is for faculty. Switch the demo account to Faculty in Map style and layers." />
        <Btn title="Close" kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }
  if (isLoading || !me) return <View style={[styles.root, { paddingTop: insets.top + 80 }]}><Loading /></View>;

  const reasonLabel = REASONS.find(r => r[0] === reason)?.[1] ?? 'Away';
  const untilWord = until === 'today' ? 'for the rest of today' : `until ${untils.find(u => u.id === until)?.name}`;
  const preview = status === 'in'
    ? { label: 'In the office now', sub: me.email ? `Knock, or email ${me.email} if the door is shut.` : 'Knock if the door is open.', bg: '#E6F4EC', fg: '#0B6B3F' }
    : status === 'busy' ? { label: `${reason === 'none' ? 'Busy' : reasonLabel} ${untilWord}`, sub: 'Posted hours are shown as paused today. Email is the surer bet.', bg: '#FFF3DB', fg: '#6B4A05' }
    : { label: `Not in ${untilWord}`, sub: `${reason === 'none' ? '' : reasonLabel + '. '}Students are told to email instead of walking over.`, bg: '#F2F3F0', fg: '#5F6368' };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={me.name} tone="busy" size={44} />
          <View style={{ flex: 1 }}>
            <T weight="bold" style={{ fontSize: 20 }} accessibilityRole="header">Your office today</T>
            <T style={{ fontSize: 13, color: color.muted }}>{DAY[today]} · {todayHours === undefined ? 'no posted hours' : todayHours.length ? `posted ${todayHours.map(([a, b]) => `${a}–${b}`).join(' and ')}` : 'no office hours today'}</T>
          </View>
          <IconBtn icon="close" label="Close" onPress={() => router.back()} float={false} bg={color.surface} size={36} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
          {STATES.map(s => {
            const on = s.id === status;
            return (
              <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setStatus(s.id)}
                style={[styles.state, on ? { backgroundColor: s.colour, borderColor: s.colour } : null]}>
                <Icon name={s.icon} size={24} stroke={on ? '#fff' : s.colour} width={2.4} />
                <T weight="semibold" style={{ fontSize: 13, color: on ? '#fff' : color.ink2 }}>{s.name}</T>
              </Pressable>
            );
          })}
        </View>

        {status !== 'in' && (
          <Animated.View entering={FadeIn} layout={LinearTransition} style={{ gap: 14 }}>
            <View>
              <Label style={{ marginBottom: 8 }}>Why, if you want to say</Label>
              <View style={styles.wrap}>{REASONS.map(([id, name]) => <Choice key={id} label={name} on={reason === id} onPress={() => setReason(id)} />)}</View>
            </View>
            <View>
              <Label style={{ marginBottom: 8 }}>Until</Label>
              <View style={styles.wrap}>{untils.map(u => <Choice key={u.id} label={u.name} on={until === u.id} onPress={() => setUntil(u.id)} />)}</View>
            </View>
          </Animated.View>
        )}
        {status === 'in' && !inPostedHours && <Notice tone="info" icon="info" text="This is outside your posted hours. Students will see that you are in anyway, and your posted hours stay as they are." />}

        <View style={{ backgroundColor: '#FFF4C7', padding: 15, borderRadius: 12, gap: 8 }}>
          <T weight="bold">A note for students</T>
          <T style={{ fontSize: 12, color: color.muted }}>This stays on your public card until you edit or remove it.</T>
          <View style={styles.wrap}>{['In a meeting, back soon', 'Online meetings today', 'Please email me', 'Please make an appointment', 'Out sick today'].map(text => <Choice key={text} label={text} on={note === text} onPress={() => setNote(text)} />)}</View>
          <TextInput accessibilityLabel="Note for students" multiline maxLength={500} value={note ?? me.note ?? ''} onChangeText={setNote} placeholder="Write your own note…" style={{ minHeight: 70, padding: 10, backgroundColor: '#fff', borderRadius: 8, textAlignVertical: 'top' }} />
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>What students see right now</Label>
          <Animated.View layout={LinearTransition} style={styles.preview}>
            <T weight="bold" style={{ fontSize: 16 }}>{me.name}</T>
            <T style={{ fontSize: 13, color: color.muted }}>{me.place ? `${me.place.name}${me.office_number ? ` · Office ${me.office_number}` : ''}` : 'Office not published'}</T>
            <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: preview.bg }}>
              <T weight="semibold" style={{ color: preview.fg, fontSize: 14 }}>{preview.label}</T>
              <T style={{ color: preview.fg, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{preview.sub}</T>
            </View>
          </Animated.View>
        </View>

        {save.isError && <Notice tone="missing" text={save.error instanceof Error ? save.error.message : 'Could not save.'} />}
        {save.isSuccess && <Notice tone="info" icon="check" text={save.data.presence ? 'Published. Your card, the office list and the assistant all show it now.' : 'Cleared. Students see your posted hours again.'} />}
        <Btn title="Publish my status" kind="dark" onPress={() => save.mutate(status)} loading={save.isPending} />
        {me.presence && <Btn title="Clear it now" kind="ghost" onPress={() => save.mutate('clear')} />}

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: color.hairline }}>
          <Icon name="clock" size={16} stroke={color.muted} />
          <T style={{ flex: 1, fontSize: 12.5, color: color.muted }}>Clears by itself at 18:30, so you never leave a stale status up. It never edits your posted hours.</T>
        </View>
        <Btn title="Open my public card" kind="secondary" onPress={() => { router.back(); push({ name: 'person', id: me.id }); }} />
      </ScrollView>
    </View>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.choice, on && { backgroundColor: color.ink, borderColor: color.ink }]}>
      <T weight="semibold" style={{ fontSize: 13, color: on ? '#fff' : color.ink2 }}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  state: { flex: 1, height: 84, borderRadius: 14, borderWidth: 1, borderColor: '#E2E3DE', alignItems: 'center', justifyContent: 'center', gap: 7 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { height: 36, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: '#E2E3DE', justifyContent: 'center' },
  preview: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.page },
});
