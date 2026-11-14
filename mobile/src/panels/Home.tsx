import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaces } from '../api/hooks';
import { t } from '../i18n/strings';
import { useMap } from '../map/MapContext';
import { useApp, useLocation } from '../state/app';
import { usePanels } from '../state/panels';
import { Chip, Icon, IconBtn, T, rise } from '../ui/kit';
import { categories, color, schools, shadow } from '../ui/theme';

const COUNT_LABEL: Record<string, (n: number) => string> = {
  academic: n => `${n} academic places`, residential: n => `${n} residences`, dining: n => `${n} dining places`, athletics: n => `${n} sports facilities`,
  admin: n => `${n} administrative offices`, services: n => `${n} campus services`, facilities: n => `${n} facilities and car parks`,
};
const GUEST_CHIPS = [
  { id: 'facilities', name: 'Parking', icon: 'car' as const, color: '#6B7280' },
  { id: 'dining', name: 'Dining', icon: 'fork' as const, color: '#D1473F' },
  { id: 'services', name: 'Venues', icon: 'flag' as const, color: '#0E7490' },
];

export default function Home({ chipsDelay }: { chipsDelay: number }) {
  const insets = useSafeAreaInsets();
  const { push } = usePanels();
  const map = useMap();
  const { lang, online, user } = useApp();
  const loc = useLocation();
  const places = usePlaces();
  const [category, setCategory] = useState<string>('all');
  const [school, setSchool] = useState<string>('all');
  const guest = user.role === 'guest';

  useEffect(() => { map.send({ type: 'filter', category, school, fit: true }); }, [category, school]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCategory('all'); setSchool('all'); }, [guest]);

  const count = useMemo(() => {
    const list = (places.data ?? []).filter(p => (category === 'all' || p.category === category) && (category !== 'academic' || school === 'all' || p.schools.includes(school as never)));
    return list.length;
  }, [places.data, category, school]);
  const rtl = lang === 'ar';
  const chips = guest ? GUEST_CHIPS : categories;
  const stripTop = insets.top + 8 + 54 + (category === 'academic' && !guest ? 48 : 0);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* chip rail: the chips ARE the filter */}
      <Animated.View entering={FadeIn.delay(chipsDelay).duration(380)} style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0 }} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, rtl && { flexDirection: 'row-reverse' }]} keyboardShouldPersistTaps="handled">
          <IconBtn icon="search" label="Search the campus" onPress={() => push({ name: 'search' })} />
          {chips.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.delay(chipsDelay + i * 40).duration(320)}>
              <Chip label={c.name} icon={c.icon} active={category === c.id} activeColor={c.color} onPress={() => { setCategory(category === c.id ? 'all' : c.id); setSchool('all'); }} />
            </Animated.View>
          ))}
        </ScrollView>
        {category === 'academic' && !guest && (
          <Animated.View entering={rise} exiting={FadeOut.duration(150)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingTop: 4, gap: 8 }]}>
              {schools.map(s => <Chip key={s.id} small light label={s.name} active={school === s.id} onPress={() => setSchool(s.id)} />)}
            </ScrollView>
          </Animated.View>
        )}
      </Animated.View>

      {/* result strip */}
      {category !== 'all' && (
        <Animated.View entering={rise} exiting={FadeOut.duration(150)} style={[styles.strip, { top: stripTop }]}>
          <T weight="medium" numberOfLines={1} style={{ flex: 1, color: '#fff', fontSize: 13 }}>{COUNT_LABEL[category]?.(count) ?? `${count} places`}</T>
          <Pressable accessibilityRole="button" onPress={() => { setCategory('all'); setSchool('all'); }} style={styles.clear}><T weight="semibold" style={{ color: '#fff', fontSize: 12 }}>Clear</T></Pressable>
        </Animated.View>
      )}

      {/* edge states, compact: they keep the map usable and say what is missing */}
      <View style={{ position: 'absolute', top: stripTop + (category !== 'all' ? 48 : 0), left: 14, right: 14, gap: 8 }} pointerEvents="box-none">
        {guest && <Banner icon="user" text="Visiting as a guest · offices, hours and procedures need a sign-in" />}
        {!online && <Banner icon="wifiOff" tone="dark" text="No connection · the map works, crowding, open-now and questions don't" />}
        {loc.reason === 'no-permission' && <Banner icon="locate" text="Turn on location for directions. Browsing works without it." action="Allow" onAction={loc.request} />}
        {loc.reason === 'off-campus' && <Banner icon="locate" tone="dark" text="You're away from AUI · routes start from the main plaza (demo position)" />}
      </View>

      {/* guest: the event they came for */}
      {guest && (
        <Animated.View entering={rise} style={[styles.event, { bottom: insets.bottom + 92 }]}>
          <T weight="bold" style={{ fontSize: 11, letterSpacing: 0.6, color: color.muted }}>TODAY ON CAMPUS</T>
          <T weight="bold" style={{ fontSize: 17, marginTop: 4 }}>[EVENT NAME · from the events feed]</T>
          <T style={{ fontSize: 13, color: color.muted, marginTop: 2 }}>Main Auditorium · parking at the south gate</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => push({ name: 'place', id: 'building-17' })} style={[styles.eventBtn, { backgroundColor: color.blue }]}><T weight="semibold" style={{ color: '#fff' }}>Take me there</T></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setCategory('facilities')} style={[styles.eventBtn, { borderWidth: 1, borderColor: color.line }]}><T weight="semibold">Parking</T></Pressable>
          </View>
        </Animated.View>
      )}

      {/* FAB stack */}
      <View style={[styles.fabs, { bottom: insets.bottom + 96 }, guest && { bottom: insets.bottom + 260 }]} pointerEvents="box-none">
        {!guest && <IconBtn icon="flame" label="Crowding by walkway" size={50} onPress={() => push({ name: 'crowding' })} />}
        <IconBtn icon="locate" label="Centre on my location" size={50} onPress={() => (loc.coord ? map.send({ type: 'locate' }) : loc.request())} />
        <IconBtn icon="layers" label="Map style and layers" size={50} bg="#23251F" stroke="#fff" onPress={() => push({ name: 'layers' })} />
      </View>

      {/* the assistant pill: type, or hold the mic */}
      <Animated.View entering={rise.delay(160)} style={[styles.pill, { bottom: insets.bottom + 20 }, rtl && { flexDirection: 'row-reverse' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t(lang, 'assistantTitle')} onPress={() => push({ name: 'assistant' })} style={[styles.pillText, rtl && { flexDirection: 'row-reverse' }]}>
          <Icon name="sparkle" size={20} stroke={color.blue} />
          <T numberOfLines={1} style={{ flex: 1, color: color.muted, fontSize: 14, textAlign: rtl ? 'right' : 'left' }}>{guest ? 'Ask where something is' : t(lang, 'askPlaceholder')}</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Ask by voice" onPress={() => push({ name: 'voice' })} style={styles.mic}>
          <Icon name="mic" size={20} stroke={color.ink} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Banner({ icon, text, tone = 'light', action, onAction }: { icon: 'user' | 'wifiOff' | 'locate'; text: string; tone?: 'light' | 'dark'; action?: string; onAction?: () => void }) {
  const dark = tone === 'dark';
  return (
    <Animated.View entering={rise} style={[styles.banner, { backgroundColor: dark ? 'rgba(21,23,26,0.88)' : '#fff' }]}>
      <Icon name={icon} size={16} stroke={dark ? '#fff' : color.ink} />
      <T style={{ flex: 1, fontSize: 12.5, color: dark ? '#fff' : color.ink }}>{text}</T>
      {action && <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}><T weight="bold" style={{ fontSize: 12.5, color: color.blue }}>{action}</T></Pressable>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: { paddingHorizontal: 14, gap: 10, alignItems: 'center', paddingBottom: 6 },
  strip: { position: 'absolute', left: 14, right: 14, height: 40, borderRadius: 12, backgroundColor: 'rgba(21,23,26,0.86)', flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, gap: 10 },
  clear: { height: 30, paddingHorizontal: 11, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, ...shadow.float },
  fabs: { position: 'absolute', right: 16, gap: 12 },
  pill: { position: 'absolute', left: 12, right: 12, height: 56, borderRadius: 999, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 6, ...shadow.pill },
  pillText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: '100%' },
  mic: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F2F0', alignItems: 'center', justifyContent: 'center' },
  event: { position: 'absolute', left: 12, right: 12, padding: 16, borderRadius: 18, backgroundColor: '#fff', ...shadow.float },
  eventBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
