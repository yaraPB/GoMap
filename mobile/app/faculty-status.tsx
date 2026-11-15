import React, { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../src/api/client';
import { usePerson } from '../src/api/hooks';
import type { NoteKind } from '../src/api/types';
import { dayName, shortDate, useLang, useT } from '../src/i18n';
import { useApp } from '../src/state/app';
import { usePanels } from '../src/state/panels';
import { todayKey } from '../src/ui/bits';
import { Avatar, Btn, Icon, IconBtn, Label, Loading, Notice, T } from '../src/ui/kit';
import { NOTE_CHARACTERS, NotePicker, StickyNote } from '../src/ui/StickyNote';
import { color, type IconName } from '../src/ui/theme';

type Status = 'in' | 'busy' | 'out';
const STATES: { id: Status; name: string; colour: string; icon: IconName }[] = [
  { id: 'in', name: 'I am in', colour: '#0B6B3F', icon: 'check' },
  { id: 'busy', name: 'Busy', colour: '#8A5A00', icon: 'clock' },
  { id: 'out', name: 'Away', colour: '#5F6368', icon: 'plane' },
];
const BUSY_REASONS = [['meeting', 'In a meeting'], ['teaching', 'Teaching'], ['campus', 'Elsewhere on campus'], ['none', 'Rather not say']] as const;
const AWAY_REASONS = [['sick', 'Sick'], ['conference', 'At a conference'], ['away', 'Off campus'], ['leave', 'On leave'], ['none', 'Rather not say']] as const;
const DAY_MS = 86400000;

/** Busy: 30 min, the next two half-hours on the clock, rest of today. */
function busyOptions() {
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
/** Back on the morning of a date (08:00 campus time ≈ 07:00 UTC). */
const backOn = (d: Date) => { const x = new Date(d); x.setUTCHours(7, 0, 0, 0); return x.toISOString(); };
/** End of the current semester: Fall → 20 Dec, Spring → 20 May, Summer → 15 Aug. */
function semesterEnd(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const end = m >= 8 ? new Date(Date.UTC(y, 11, 21)) : m <= 4 ? new Date(Date.UTC(y, 4, 21)) : new Date(Date.UTC(y, 7, 16));
  return backOn(end);
}

export default function FacultyStatus() {
  const t = useT();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const { push } = usePanels();
  const qc = useQueryClient();
  const personId = user.person_id ?? user.id;
  const { data: me, isLoading } = usePerson(user.role === 'faculty' ? personId : null);
  const [status, setStatus] = useState<Status>('in');
  const [busyReason, setBusyReason] = useState('meeting');
  const [awayReason, setAwayReason] = useState('away');
  const busy = useMemo(busyOptions, []);
  const [busyUntil, setBusyUntil] = useState('today');
  const [away, setAway] = useState<{ id: string; iso: string | null }>({ id: 'today', iso: null });
  const [note, setNote] = useState<string | null>(null);
  const [kind, setKind] = useState<NoteKind | null | undefined>(undefined);
  const [lunch, setLunch] = useState<[string, string] | null | undefined>(undefined);
  const today = todayKey();
  const todayHours = me?.hours?.[today];
  const inPostedHours = me?.open.state === 'open';
  const dates = useMemo(() => Array.from({ length: 21 }, (_, i) => new Date(Date.now() + (i + 1) * DAY_MS)), []);
  const locale = lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar-MA' : 'en-GB';
  const awayOptions = [
    { id: 'today', name: t('Rest of today'), iso: null as string | null },
    { id: 'tomorrow', name: t('Back tomorrow'), iso: backOn(new Date(Date.now() + DAY_MS)) },
    { id: '3d', name: t('3 days'), iso: backOn(new Date(Date.now() + 3 * DAY_MS)) },
    { id: 'week', name: t('A week'), iso: backOn(new Date(Date.now() + 7 * DAY_MS)) },
    { id: 'semester', name: t('This semester'), iso: semesterEnd() },
  ];

  const save = useMutation({
    mutationFn: (s: Status | 'clear') => {
      Keyboard.dismiss();
      const extra = { note: note ?? me?.note ?? '', note_kind: kind === undefined ? me?.note_kind ?? null : kind, ...(lunch !== undefined ? { lunch } : {}) };
      if (s === 'clear') return api.setPresence(personId, { status: 'clear', ...extra });
      if (s === 'in') return api.setPresence(personId, { status: 'in', reason: null, until: null, ...extra });
      if (s === 'busy') return api.setPresence(personId, { status: 'busy', reason: busyReason, until: busy.find(u => u.id === busyUntil)?.iso ?? null, ...extra });
      return api.setPresence(personId, { status: 'out', reason: awayReason, until: away.iso, ...extra });
    },
    onSuccess: p => { qc.setQueryData(['person', personId], p); qc.invalidateQueries({ queryKey: ['offices'] }); qc.invalidateQueries({ queryKey: ['people'] }); },
  });

  if (user.role !== 'faculty') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 20, padding: 24 }]}>
        <Notice text={t('This screen is for faculty. Switch the view to Faculty from the map.')} />
        <Btn title={t('Close')} kind="secondary" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }
  if (isLoading || !me) return <View style={[styles.root, { paddingTop: insets.top + 80 }]}><Loading /></View>;

  const busyLabel = BUSY_REASONS.find(r => r[0] === busyReason)?.[1] ?? 'Busy';
  const awayLabel = AWAY_REASONS.find(r => r[0] === awayReason)?.[1] ?? 'Away';
  const preview = status === 'in'
    ? { label: t('In the office now'), sub: me.email ? t('Knock, or email {email} if the door is shut.', { email: me.email }) : t('Knock if the door is open.'), bg: '#E6F4EC', fg: '#0B6B3F' }
    : status === 'busy'
      ? { label: `${t(busyReason === 'none' ? 'Busy' : busyLabel)} · ${busyUntil === 'today' ? t('for the rest of today') : t('until {time}', { time: busy.find(u => u.id === busyUntil)?.name ?? '' })}`, sub: t('Posted hours are shown as paused today. Email is the surer bet.'), bg: '#FFF3DB', fg: '#6B4A05' }
      : { label: `${t('Away')}${awayReason === 'none' ? '' : ` · ${t(awayLabel)}`}`, sub: away.iso ? t('Back {date}. Students are told to email instead of walking over.', { date: shortDate(away.iso, lang) }) : t('For the rest of today. Students are told to email instead of walking over.'), bg: '#F2F3F0', fg: '#5F6368' };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30, gap: 18 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={me.name} tone="busy" size={44} />
          <View style={{ flex: 1 }}>
            <T weight="bold" style={{ fontSize: 20 }} accessibilityRole="header">{t('Your office')}</T>
            <T style={{ fontSize: 13, color: color.muted }}>{dayName(today, lang, true)} · {todayHours === undefined ? t('no posted hours') : todayHours.length ? t('posted {hours}', { hours: todayHours.map(([a, b]) => `${a}–${b}`).join(', ') }) : t('no office hours today')}</T>
          </View>
          <IconBtn icon="close" label={t('Close')} onPress={() => router.back()} float={false} bg={color.surface} size={36} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
          {STATES.map(s => {
            const on = s.id === status;
            return (
              <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setStatus(s.id)}
                style={({ pressed }) => [styles.state, on ? { backgroundColor: s.colour, borderColor: s.colour } : null, pressed && { transform: [{ scale: 0.97 }] }]}>
                <Icon name={s.icon} size={24} stroke={on ? '#fff' : s.colour} width={2.2} />
                <T weight="semibold" style={{ fontSize: 13, color: on ? '#fff' : color.ink2, textAlign: 'center' }}>{t(s.name)}</T>
              </Pressable>
            );
          })}
        </View>

        {status === 'busy' && (
          <Animated.View entering={FadeInDown.duration(220)} layout={LinearTransition} style={{ gap: 14 }}>
            <View>
              <Label style={{ marginBottom: 8 }}>{t('Why, if you want to say')}</Label>
              <View style={styles.wrap}>{BUSY_REASONS.map(([id, name]) => <Choice key={id} label={t(name)} on={busyReason === id} onPress={() => setBusyReason(id)} />)}</View>
            </View>
            <View>
              <Label style={{ marginBottom: 8 }}>{t('Until')}</Label>
              <View style={styles.wrap}>{busy.map(u => <Choice key={u.id} label={u.id === 'today' ? t(u.name) : u.id === '30' ? t('30 min') : u.name} on={busyUntil === u.id} onPress={() => setBusyUntil(u.id)} />)}</View>
            </View>
          </Animated.View>
        )}

        {status === 'out' && (
          <Animated.View entering={FadeInDown.duration(220)} layout={LinearTransition} style={{ gap: 14 }}>
            <View>
              <Label style={{ marginBottom: 8 }}>{t('Why, if you want to say')}</Label>
              <View style={styles.wrap}>{AWAY_REASONS.map(([id, name]) => <Choice key={id} label={t(name)} on={awayReason === id} onPress={() => setAwayReason(id)} />)}</View>
            </View>
            <View>
              <Label style={{ marginBottom: 8 }}>{t('How long')}</Label>
              <View style={styles.wrap}>{awayOptions.map(o => <Choice key={o.id} label={o.name} on={away.id === o.id} onPress={() => setAway({ id: o.id, iso: o.iso })} />)}</View>
            </View>
            <View>
              <Label style={{ marginBottom: 8 }}>{t('Or pick the day you are back')}</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {dates.map(d => {
                  const iso = backOn(d);
                  const on = away.iso === iso && away.id === 'date';
                  return (
                    <Pressable key={iso} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setAway({ id: 'date', iso })}
                      style={[styles.date, on && { backgroundColor: color.ink, borderColor: color.ink }]}>
                      <T weight="semibold" style={{ fontSize: 11, color: on ? '#fff' : color.muted, textAlign: 'center' }}>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)}</T>
                      <T weight="bold" style={{ fontSize: 17, color: on ? '#fff' : color.ink, textAlign: 'center' }}>{d.getDate()}</T>
                      <T style={{ fontSize: 10.5, color: on ? '#fff' : color.muted, textAlign: 'center' }}>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(d)}</T>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            {away.iso && <Notice tone="info" icon="calendar" text={t('Your card says “Away, back {date}” until then. It does not clear at 18:30 like a one-day status.', { date: shortDate(away.iso, lang) })} />}
          </Animated.View>
        )}
        {status === 'in' && !inPostedHours && <Notice tone="info" icon="info" text={t('This is outside your posted hours. Students will see that you are in anyway, and your posted hours stay as they are.')} />}

        <View style={{ backgroundColor: '#FFFBEA', padding: 15, borderRadius: 14, gap: 10 }}>
          <T weight="bold">{t('A note on your door')}</T>
          <T style={{ fontSize: 12, color: color.muted }}>{t('It shows next to your name in search, in the office list and when students ask the assistant, until you remove it.')}</T>
          <NotePicker value={kind === undefined ? me.note_kind : kind} onPick={k => { setKind(k); setNote(k ? t(NOTE_CHARACTERS[k].label) : ''); }} />
          {((kind === undefined ? me.note_kind : kind) || (note ?? me.note)) && <Animated.View entering={FadeIn}><StickyNote kind={kind === undefined ? me.note_kind : kind} text={note ?? me.note} /></Animated.View>}
          <TextInput accessibilityLabel={t('Note for students')} multiline maxLength={500} value={note ?? me.note ?? ''} onChangeText={setNote} placeholder={t('Write your own note…')} blurOnSubmit returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
            style={{ minHeight: 64, padding: 10, backgroundColor: '#fff', borderRadius: 8, textAlignVertical: 'top', textAlign: lang === 'ar' ? 'right' : 'left' }} />
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>{t('Lunch break · shown as “At lunch” on your card')}</Label>
          <View style={styles.wrap}>
            {([null, ['12:00', '13:00'], ['12:30', '13:30'], ['13:00', '14:00'], ['14:00', '15:00']] as ([string, string] | null)[]).map(l => {
              const current = lunch === undefined ? (me.lunch_custom ? me.lunch : null) : lunch;
              const on = JSON.stringify(current) === JSON.stringify(l);
              return <Choice key={l ? l.join('-') : 'campus'} label={l ? `${l[0]}–${l[1]}` : `${t('Campus default')}${me.lunch_custom ? '' : ` (${me.lunch[0]}–${me.lunch[1]})`}`} on={on} onPress={() => setLunch(l)} />;
            })}
          </View>
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>{t('What students see right now')}</Label>
          <Animated.View layout={LinearTransition} style={styles.preview}>
            <T weight="bold" style={{ fontSize: 16 }}>{me.name}</T>
            <T style={{ fontSize: 13, color: color.muted }}>{me.place ? `${me.place.name}${me.office_number ? ` · ${t('Office {n}', { n: me.office_number })}` : ''}` : t('Office not published')}</T>
            <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: preview.bg }}>
              <T weight="semibold" style={{ color: preview.fg, fontSize: 14 }}>{preview.label}</T>
              <T style={{ color: preview.fg, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{preview.sub}</T>
            </View>
          </Animated.View>
        </View>

        {save.isError && <Notice tone="missing" text={save.error instanceof Error ? save.error.message : t('Could not save.')} />}
        {save.isSuccess && <Notice tone="info" icon="check" text={save.data.presence ? t('Published. Your card, the office list and the assistant all show it now.') : t('Cleared. Students see your posted hours again.')} />}
        <Btn title={t('Publish my status')} kind="dark" onPress={() => save.mutate(status)} loading={save.isPending} />
        {me.presence && <Btn title={t('Clear it now')} kind="ghost" onPress={() => save.mutate('clear')} />}

        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: color.hairline }}>
          <Icon name="clock" size={16} stroke={color.muted} />
          <T style={{ flex: 1, fontSize: 12.5, color: color.muted }}>{t('A one-day status clears itself at 18:30. Longer absences end on the day you are back. Your posted hours never change.')}</T>
        </View>
        <Btn title={t('Open my public card')} kind="secondary" onPress={() => { router.back(); push({ name: 'person', id: me.id }); }} />
      </ScrollView>
    </View>
  );
}

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={({ pressed }) => [styles.choice, on && { backgroundColor: color.ink, borderColor: color.ink }, pressed && { transform: [{ scale: 0.97 }] }]}>
      <T weight="semibold" style={{ fontSize: 13, color: on ? '#fff' : color.ink2 }}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  state: { flex: 1, height: 84, borderRadius: 14, borderWidth: 1, borderColor: '#E2E3DE', alignItems: 'center', justifyContent: 'center', gap: 7 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { height: 36, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: '#E2E3DE', justifyContent: 'center' },
  date: { width: 56, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E2E3DE', alignItems: 'center', gap: 1 },
  preview: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.page },
});
