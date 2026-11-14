import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOffices, usePlace } from '../api/hooks';
import type { Person } from '../api/types';
import { usePanels } from '../state/panels';
import { shortStatus } from '../ui/bits';
import { Avatar, Empty, FilterPill, Icon, IconBtn, Loading, Notice, T } from '../ui/kit';
import { color, font } from '../ui/theme';

const FLOOR = (f: number | null) => (f === null ? 'Floor not published' : f === 0 ? 'Ground floor' : f === 1 ? 'First floor' : f === 2 ? 'Second floor' : f === 3 ? 'Third floor' : `Floor ${f}`);

export default function Offices({ placeId, department }: { placeId: string; department?: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const place = usePlace(placeId);
  const { data, isLoading } = useOffices(placeId);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'faculty' | 'staff'>('all');
  const [dep, setDep] = useState(department);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.floors ?? []).map(g => ({
      floor: g.floor,
      people: g.people.filter(p => (!dep || p.department?.id === dep) && (!t || `${p.name} ${p.office_number ?? ''}`.toLowerCase().includes(t))
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
    <Animated.View entering={SlideInRight.duration(260)} style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBtn icon="back" label={`Back to ${place.data?.name ?? 'the building'}`} onPress={pop} float={false} bg={color.surface} size={40} />
          <View style={{ flex: 1 }}>
            <T weight="bold" style={{ fontSize: 18, letterSpacing: -0.3 }} accessibilityRole="header">Offices in {place.data?.name ?? '…'}</T>
            <T style={{ fontSize: 12.5, color: color.muted, marginTop: 1 }}>{all.length} offices · {openNow} open now{busy ? ` · ${busy} busy` : ''}</T>
          </View>
        </View>
        <View style={styles.search}>
          <Icon name="search" size={17} stroke={color.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Name or office number" placeholderTextColor={color.muted} style={styles.input} accessibilityLabel="Find a person or an office number" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
          <FilterPill label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          <FilterPill label="Open now" active={filter === 'open'} onPress={() => setFilter('open')} />
          <FilterPill label="Faculty" active={filter === 'faculty'} onPress={() => setFilter('faculty')} />
          <FilterPill label="Staff" active={filter === 'staff'} onPress={() => setFilter('staff')} />
          {dep && <FilterPill label={`${dep} only ✕`} active onPress={() => setDep(undefined)} />}
        </ScrollView>
      </View>
      {isLoading ? <Loading /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {groups.map(g => (
            <View key={String(g.floor)}>
              <T weight="bold" style={styles.floor}>{FLOOR(g.floor).toUpperCase()}</T>
              {g.people.map(p => {
                const st = shortStatus(p);
                return (
                  <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, office ${p.office_number ?? 'not published'}, ${st.text}`} onPress={() => push({ name: 'person', id: p.id })}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.page }]}>
                    <Avatar name={p.name} tone={st.tone} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T weight="semibold" numberOfLines={1} style={{ fontSize: 15 }}>{p.name}</T>
                      <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted, marginTop: 2 }}>{p.title ?? (p.role === 'staff' ? 'Staff' : `Faculty, ${p.department?.name ?? ''}`)}</T>
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
          {!groups.length && <Empty title="No office matches" body="Try another name or clear the filters." />}
          <View style={{ gap: 10, margin: 16 }}>
            {shared.map(([office, list]) => (
              <Notice key={office} text={`Office ${office} is shared by ${list.length} people (${list.map(p => p.name.split(' ')[0]).join(', ')}). Check the door card before knocking, or email ahead.`} />
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
