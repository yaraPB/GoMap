import React, { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { usePlaces } from '../api/hooks';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Empty, Icon, IconBtn, Label, Loading, T } from '../ui/kit';
import { categoryColor, categoryIcon, categoryName, color, font } from '../ui/theme';
import { availabilityTone, shortStatus } from '../ui/bits';

type Row = { key: string; kind: 'place' | 'person' | 'procedure' | 'header'; title: string; sub?: string; id?: string; tint?: string; icon?: Parameters<typeof Icon>[0]['name']; status?: { tone: ReturnType<typeof availabilityTone>; text: string } };

export default function Search({ initial }: { initial?: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const { user } = useApp();
  const [q, setQ] = useState(initial ?? '');
  const query = useDeferredValue(q.trim());
  const places = usePlaces();
  const people = useQuery({ queryKey: ['search-people', query], queryFn: () => api.people({ q: query, limit: 8 }), enabled: query.length >= 2 && user.role !== 'guest' });
  const procs = useQuery({ queryKey: ['search-procs', query], queryFn: () => api.procedures(query), enabled: query.length >= 3 && user.role !== 'guest' });

  const rows = useMemo<Row[]>(() => {
    const t = query.toLowerCase();
    const list = places.data ?? [];
    const matches = t ? list.filter(p => `${p.name} ${p.number ?? ''} ${p.aliases.join(' ')}`.toLowerCase().includes(t)).slice(0, 12)
      : list.filter(p => ['building-11', 'building-15', 'cafeteria-newrest', 'building-2', 'student-center', 'building-8b'].includes(p.id));
    const out: Row[] = [];
    if (matches.length) {
      out.push({ key: 'h-p', kind: 'header', title: t ? 'Places' : 'Popular places' });
      for (const p of matches) out.push({ key: p.id, kind: 'place', id: p.id, title: p.name, sub: `${categoryName(p.category)}${p.status === 'closed' ? ' · closed' : ''}${p.people_count ? ` · ${p.people_count} offices` : ''}`, tint: categoryColor(p.category), icon: categoryIcon(p.category) });
    }
    if (people.data?.length) {
      out.push({ key: 'h-pe', kind: 'header', title: 'People' });
      for (const p of people.data) out.push({ key: p.id, kind: 'person', id: p.id, title: p.name, sub: [p.title, p.place ? `${p.place.name}${p.office_number ? `, ${p.office_number}` : ''}` : 'Office not published'].filter(Boolean).join(' · '), status: shortStatus(p) });
    }
    if (procs.data?.length) {
      out.push({ key: 'h-pr', kind: 'header', title: 'How do I…' });
      for (const p of procs.data.slice(0, 4)) out.push({ key: p.id, kind: 'procedure', id: p.id, title: p.title, sub: p.owner_office, icon: 'doc', tint: '#6D5BD0' });
    }
    return out;
  }, [query, places.data, people.data, procs.data]);

  const open = (r: Row) => {
    if (r.kind === 'place') push({ name: 'place', id: r.id! });
    if (r.kind === 'person') push({ name: 'person', id: r.id! });
    if (r.kind === 'procedure') push({ name: 'assistant', ask: r.title });
  };
  const loading = places.isLoading || people.isFetching || procs.isFetching;

  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <IconBtn icon="back" label="Back to the map" onPress={pop} float={false} bg={color.surface} size={40} />
        <View style={styles.input}>
          <Icon name="search" size={18} stroke={color.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder={user.role === 'guest' ? 'A building, parking, food…' : 'A place, a professor, a procedure'}
            placeholderTextColor={color.muted} style={styles.text} returnKeyType="search" accessibilityLabel="Search the campus" />
          {!!q && <Pressable accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={10}><Icon name="close" size={16} stroke={color.muted} /></Pressable>}
        </View>
      </View>
      {user.role !== 'guest' && !query && (
        <Pressable accessibilityRole="button" onPress={() => push({ name: 'people' })} style={styles.shortcut}>
          <Icon name="user" size={18} stroke={color.blue} />
          <T weight="semibold" style={{ flex: 1, color: color.blue }}>Find a professor or an office</T>
          <Icon name="chevron" size={16} stroke={color.blue} />
        </Pressable>
      )}
      <FlatList
        data={rows} keyExtractor={r => r.key} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderItem={({ item: r }) => r.kind === 'header'
          ? <Label style={styles.header}>{r.title}</Label>
          : (
            <Pressable accessibilityRole="button" onPress={() => open(r)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.page }]}>
              <View style={[styles.icon, { backgroundColor: r.kind === 'person' ? color.surface : r.tint }]}>
                {r.kind === 'person' ? <Icon name="user" size={18} stroke={color.ink2} /> : <Icon name={r.icon!} size={17} stroke="#fff" />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="semibold" numberOfLines={1} style={{ fontSize: 15 }}>{r.title}</T>
                {r.sub && <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted, marginTop: 1 }}>{r.sub}</T>}
              </View>
              {r.status && <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 999, justifyContent: 'center', backgroundColor: { open: '#E6F4EC', busy: '#FFF3DB', closed: '#F2F3F0', missing: '#FFF1F0' }[r.status.tone] }}>
                <T weight="semibold" style={{ fontSize: 11, color: { open: '#0B6B3F', busy: '#6B4A05', closed: '#5F6368', missing: '#9A2B23' }[r.status.tone] }}>{r.status.text}</T>
              </View>}
            </Pressable>
          )}
        ListEmptyComponent={loading ? <Loading /> : query ? (
          <Empty title="Nothing on campus matches that" body="Place names are indexed in English for now. You can describe it to GoMap instead." action="Ask GoMap" onAction={() => push({ name: 'assistant', ask: query })} />
        ) : undefined}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  input: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: color.surface2 },
  text: { flex: 1, fontSize: 15, fontFamily: font.regular, color: color.ink, paddingVertical: 0 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: '#EEF4FF' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
