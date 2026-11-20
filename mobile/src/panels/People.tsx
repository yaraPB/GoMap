import React, { useDeferredValue, useState } from 'react';
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePeople } from '../api/hooks';
import { usePanels } from '../state/panels';
import { shortStatus } from '../ui/bits';
import { Avatar, Empty, FilterPill, Icon, Loading, Sheet, T } from '../ui/kit';
import { color, font } from '../ui/theme';
import { useT } from '../i18n';
import { NoteTag } from '../ui/StickyNote';

const DEPS = [['', 'All'], ['SBA', 'Business'], ['SSE', 'Science & Engineering'], ['SSAH', 'Humanities'], ['LC', 'Language Center']] as const;

/** Board 09: find a professor by name, see where and whether they are in. */
export default function People() {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const t = useT();
  const [q, setQ] = useState('');
  const [dep, setDep] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const query = useDeferredValue(q.trim());
  const { data, isLoading } = usePeople(query);
  const list = (data ?? []).filter(p => (!dep || p.department?.id === dep) && (!openOnly || ['open', 'in'].includes(p.availability.state)));

  return (
    // a sheet over the dimmed map: tap above it, or swipe down, to go back
    <Sheet snaps={[0.9]} scrim onClose={() => { Keyboard.dismiss(); pop(); }}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T weight="bold" style={{ fontSize: 18 }} accessibilityRole="header">{t('Find a professor')}</T>
        </View>
        <View style={styles.search}>
          <Icon name="search" size={17} stroke={color.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t('Name, title or office')} placeholderTextColor={color.muted} style={styles.input} accessibilityLabel={t('Search people')} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
          <FilterPill label={t('Open now')} active={openOnly} onPress={() => setOpenOnly(!openOnly)} />
          {DEPS.map(([id, name]) => <FilterPill key={id} label={t(name)} active={dep === id} onPress={() => setDep(id)} />)}
        </ScrollView>
      </View>
      <FlatList
        data={list} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={isLoading ? <Loading /> : <Empty icon="user" title={t('Nobody matches')} body={t('Names come from the school directories on aui.ma.')} />}
        renderItem={({ item: p }) => {
          const st = shortStatus(p, t);
          return (
            <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); push({ name: 'person', id: p.id }); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.page }]}>
              <Avatar name={p.name} tone={st.tone} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T weight="semibold" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{p.name}</T>
                  <NoteTag kind={p.note_kind} text={p.note} />
                </View>
                <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted, marginTop: 2 }}>{p.place ? `${p.place.name}${p.office_number ? `, ${t('office {n}', { n: p.office_number })}` : ''}` : t('Office not published')} · {p.department?.id ?? ''}</T>
              </View>
              <T weight="semibold" style={{ fontSize: 11.5, color: { open: '#0B6B3F', busy: '#6B4A05', closed: '#5F6368', missing: '#9A2B23' }[st.tone] }}>{st.text}</T>
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.hairline },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, height: 42, paddingHorizontal: 14, borderRadius: 12, backgroundColor: color.surface2 },
  input: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: font.regular, color: color.ink, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F1F1EE' },
});
