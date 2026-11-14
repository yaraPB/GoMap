import React, { useDeferredValue, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePeople } from '../api/hooks';
import { usePanels } from '../state/panels';
import { shortStatus } from '../ui/bits';
import { Avatar, Empty, FilterPill, Icon, IconBtn, Loading, T } from '../ui/kit';
import { color, font } from '../ui/theme';

const DEPS = [['', 'All'], ['SBA', 'Business'], ['SSE', 'Science & Eng.'], ['SSAH', 'Humanities'], ['LC', 'Language Center']] as const;

/** Board 09: find a professor by name, see where and whether they are in. */
export default function People() {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const query = useDeferredValue(q.trim());
  const { data, isLoading } = usePeople(query);
  const list = (data ?? []).filter(p => (!dep || p.department?.id === dep) && (!openOnly || ['open', 'in'].includes(p.availability.state)));

  return (
    <Animated.View entering={SlideInRight.duration(240)} style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBtn icon="back" label="Back" onPress={pop} float={false} bg={color.surface} size={40} />
          <T weight="bold" style={{ fontSize: 18 }} accessibilityRole="header">Find a professor</T>
        </View>
        <View style={styles.search}>
          <Icon name="search" size={17} stroke={color.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Name, title or office" placeholderTextColor={color.muted} style={styles.input} accessibilityLabel="Search people" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
          <FilterPill label="Open now" active={openOnly} onPress={() => setOpenOnly(!openOnly)} />
          {DEPS.map(([id, name]) => <FilterPill key={id} label={name} active={dep === id} onPress={() => setDep(id)} />)}
        </ScrollView>
      </View>
      <FlatList
        data={list} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={isLoading ? <Loading /> : <Empty icon="user" title="Nobody matches" body="Names come from the school directories on aui.ma." />}
        renderItem={({ item: p }) => {
          const st = shortStatus(p);
          return (
            <Pressable accessibilityRole="button" onPress={() => push({ name: 'person', id: p.id })} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.page }]}>
              <Avatar name={p.name} tone={st.tone} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="semibold" numberOfLines={1} style={{ fontSize: 15 }}>{p.name}</T>
                <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted, marginTop: 2 }}>{p.place ? `${p.place.name}${p.office_number ? `, office ${p.office_number}` : ''}` : 'Office not published'} · {p.department?.id ?? ''}</T>
              </View>
              <T weight="semibold" style={{ fontSize: 11.5, color: { open: '#0B6B3F', busy: '#6B4A05', closed: '#5F6368', missing: '#9A2B23' }[st.tone] }}>{st.text}</T>
            </Pressable>
          );
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.hairline },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, height: 42, paddingHorizontal: 14, borderRadius: 12, backgroundColor: color.surface2 },
  input: { flex: 1, fontSize: 14, fontFamily: font.regular, color: color.ink, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F1F1EE' },
});
