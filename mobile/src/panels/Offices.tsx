import React, { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOffices, usePlace } from '../api/hooks';
import type { Person } from '../api/types';
import { usePanels } from '../state/panels';
import { shortStatus } from '../ui/bits';
import { Avatar, Empty, FilterPill, Icon, IconBtn, Loading, Notice, T } from '../ui/kit';
import { color, font } from '../ui/theme';
import { useT } from '../i18n';
import { NoteTag } from '../ui/StickyNote';

const FLOOR = (f: number | null): [string, Record<string, number>?] => (f === null ? ['Floor not published'] : f === 0 ? ['Ground floor'] : f === 1 ? ['First floor'] : f === 2 ? ['Second floor'] : f === 3 ? ['Third floor'] : ['Floor {n}', { n: f }]);

export default function Offices({ placeId, department }: { placeId: string; department?: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const place = usePlace(placeId);
  const { data, isLoading } = useOffices(placeId);
  const t = useT();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'faculty' | 'staff'>('all');
  const [dep, setDep] = useState(department);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.floors ?? []).map(g => ({
      floor: g.floor,
      people: g.people.filter(p => (!dep || p.department?.id === dep) && (!term || `${p.name} ${p.office_number ?? ''}`.toLowerCase().includes(term))
        && (filter === 'all' || (filter === 'open' && ['open', 'in'].includes(p.availability.state)) || (filter !== 'open' && p.role === filter))),
    })).filter(g => g.people.length);
  }, [data, q, filter, dep]);
  const all = (data?.floors ?? []).flatMap(f => f.people);
  const openNow = all.filter(p => ['open', 'in'].includes(p.availability.state)).length;
  const busy = all.filter(p => p.availability.state === 'busy').length;
  const shared = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of all) if (p.office_number) m.set(p.office_number, [...(m.get(p.office_number) ?? []), p]);
    return [...m.entries()].filter(([, list]) => list.length >= 3);
  }, [all]);

  return (
    <Animated.View entering={SlideInRight.duration(260)} exiting={SlideOutRight.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBtn icon="back" label={t('Back')} onPress={pop} float={false} bg={color.surface} size={40} />
          <View style={{ flex: 1 }}>
            <T weight="bold" style={{ fontSize: 18, letterSpacing: -0.3 }} accessibilityRole="header">{t('Offices in {place}', { place: place.data?.name ?? '…' })}</T>
            <T style={{ fontSize: 12.5, color: color.muted, marginTop: 1 }}>{t('{n} offices', { n: all.length })} · {t('{n} open now', { n: openNow })}{busy ? ` · ${t('{n} busy', { n: busy })}` : ''}</T>
          </View>
        </View>
        <View style={styles.search}>
          <Icon name="search" size={17} stroke={color.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={t('Name or office number')} placeholderTextColor={color.muted} style={styles.input} accessibilityLabel={t('Name or office number')} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
          <FilterPill label={t('All')} active={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterPill label={t('Open now')} active={filter === 'open'} onPress={() => setFilter('open')} />
          <FilterPill label={t('Faculty')} active={filter === 'faculty'} onPress={() => setFilter('faculty')} />
          <FilterPill label={t('Staff')} active={filter === 'staff'} onPress={() => setFilter('staff')} />
          {dep && <FilterPill label={`${dep} · ${t('only')} ✕`} active onPress={() => setDep(undefined)} />}
        </ScrollView>
      </View>
      {isLoading ? <Loading /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          {groups.map(g => (
            <View key={String(g.floor)}>
              <T weight="bold" style={styles.floor}>{t(...(FLOOR(g.floor) as [string])).toUpperCase()}</T>
              {g.people.map(p => {
                const st = shortStatus(p, t);
                return (
                  <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.office_number ? t('office {n}', { n: p.office_number }) : t('Office not published')}, ${st.text}`} onPress={() => { Keyboard.dismiss(); push({ name: 'person', id: p.id }); }}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.page }]}>
                    <Avatar name={p.name} tone={st.tone} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <T weight="semibold" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{p.name}</T>
                        <NoteTag kind={p.note_kind} text={p.note} />
                      </View>
                      <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted, marginTop: 2 }}>{p.title ?? (p.role === 'staff' ? t('Staff') : `${t('Faculty')}, ${p.department?.name ?? ''}`)}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <T weight="bold" style={{ fontSize: 13 }}>{p.office_number ?? '—'}</T>
                      <View style={[styles.badge, { backgroundColor: { open: '#E6F4EC', busy: '#FFF3DB', closed: '#F2F3F0', missing: '#FFF1F0' }[st.tone] }]}>
                        <T weight="semibold" style={{ fontSize: 11, color: { open: '#0B6B3F', busy: '#6B4A05', closed: '#5F6368', missing: '#9A2B23' }[st.tone] }}>{st.text}</T>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {!groups.length && <Empty title={t('No office matches')} body={t('Try another name or clear the filters.')} />}
          <View style={{ gap: 10, margin: 16 }}>
            {shared.map(([office, list]) => (
              <Notice key={office} text={t('Office {office} is shared by {n} people ({names}). Check the door card before knocking, or email ahead.', { office, n: list.length, names: list.map(p => p.name.split(' ')[0]).join(', ') })} />
            ))}
          </View>
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.hairline, backgroundColor: '#fff' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, height: 42, paddingHorizontal: 14, borderRadius: 12, backgroundColor: color.surface2 },
  input: { flex: 1, fontSize: 14, fontFamily: font.regular, color: color.ink, paddingVertical: 0 },
  floor: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, fontSize: 11, letterSpacing: 0.6, color: color.muted, backgroundColor: color.page },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F1F1EE' },
  badge: { height: 22, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center' },
});
