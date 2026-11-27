import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlaces } from '../api/hooks';
import { useT } from '../i18n';
import { useMap } from '../map/MapContext';
import { useApp, useLocation } from '../state/app';
import { useNav } from '../state/navigation';
import { mapFilter, useMapFilter } from '../state/mapFilter';
import { usePanels } from '../state/panels';
import { Chip, Icon, IconBtn, T, rise } from '../ui/kit';
import { categories, color, schools, shadow, type IconName } from '../ui/theme';
import RoleWidget from './RoleWidget';
import { useRoleEvents, whenText } from './Events';
import { useLang } from '../i18n';
import { ROLE_LOOK } from './Views';

const COUNT_LABEL: Record<string, string> = {
  academic: '{n} academic places', residential: '{n} residences', dining: '{n} dining places', athletics: '{n} sports facilities',
  admin: '{n} administrative offices', services: '{n} campus services', facilities: '{n} facilities and car parks',
};
const GUEST_CHIPS = [
  { id: 'facilities', name: 'Parking', icon: 'car' as const, color: '#6B7280' },
  { id: 'dining', name: 'Dining', icon: 'fork' as const, color: '#D1473F' },
  { id: 'services', name: 'Venues', icon: 'flag' as const, color: '#0E7490' },
];
/** Where visitors usually go: one tap starts the walk. */
const VISITOR_SPOTS: { id: string; name: string; icon: IconName }[] = [
  { id: 'building-14', name: 'Admissions', icon: 'door' },
  { id: 'building-17', name: 'Main Auditorium', icon: 'flag' },
  { id: 'building-15', name: 'Library', icon: 'book' },
  { id: 'cafeteria-newrest', name: 'Cafeteria', icon: 'fork' },
  { id: 'masjid-al-akhawayn', name: 'Mosque', icon: 'pin' },
  { id: 'car-park-a', name: 'Parking', icon: 'car' },
];

/** raised: a card sits at the bottom (the first-visit welcome), so the round buttons move above it */
export default function Home({ chipsDelay, raised = 0 }: { chipsDelay: number; raised?: number }) {
  const insets = useSafeAreaInsets();
  const { push } = usePanels();
  const map = useMap();
  const nav = useNav();
  const t = useT();
  const { online, user } = useApp();
  const loc = useLocation();
  const places = usePlaces();
  // shared with the assistant: "where can I eat?" switches these chips too
  const { category, school } = useMapFilter();
  const setCategory = mapFilter.setCategory, setSchool = mapFilter.setSchool;
  const guest = user.role === 'guest';
  const density = map.layers.crowding;

  // a filter never swings the camera: it only glides when most results are off screen
  useEffect(() => { map.send({ type: 'filter', category, school, fit: 'gentle' }); }, [category, school]); // eslint-disable-line react-hooks/exhaustive-deps
  const lang = useLang();
  const events = useRoleEvents();
  const upcoming = events.data ?? [];
  const nextUp = upcoming.find(e => e.state === 'now' || e.state === 'today') ?? null;
  // a visitor and a student see different chips: start clean when the role changes (not on every mount,
  // or a filter the assistant just switched on would be cleared)
  const wasGuest = useRef(guest);
  useEffect(() => { if (wasGuest.current !== guest) { wasGuest.current = guest; mapFilter.clear(); } }, [guest]);

  const count = useMemo(() => (places.data ?? []).filter(p => (category === 'all' || p.category === category) && (category !== 'academic' || school === 'all' || p.schools.includes(school as never))).length, [places.data, category, school]);
  const chips = guest ? GUEST_CHIPS : categories;
  const stripTop = insets.top + 8 + 54 + (category === 'academic' && !guest ? 48 : 0);
  const look = ROLE_LOOK[user.role] ?? ROLE_LOOK.student;
  const spots = VISITOR_SPOTS.filter(s => places.data?.some(p => p.id === s.id));

  /** Visitors: straight to the route, no intermediate sheet. */
  const goTo = async (id: string) => {
    const p = places.data?.find(x => x.id === id);
    if (!p) return;
    const ok = await nav.preview({ placeId: p.id, name: p.name, coordinates: p.coordinates, category: p.category });
    push(ok ? { name: 'route' } : { name: 'place', id });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* chip rail: the chips ARE the filter; tap a selected chip again to clear it */}
      <Animated.View entering={FadeIn.delay(chipsDelay).duration(380)} style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0 }} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" accessibilityLabel={t('View: {role}. Tap to switch.', { role: t(look.title) })} onPress={() => push({ name: 'views' })} style={[styles.role, { backgroundColor: look.tint }]}>
            <Icon name={look.icon} size={21} stroke={look.ink} />
          </Pressable>
          <IconBtn icon="search" label={t('Search the campus')} onPress={() => push({ name: 'search' })} />
          {!!upcoming.length && <Chip label={t('Events')} icon="events" activeColor="#A21CAF" onPress={() => push({ name: 'events' })} />}
          {chips.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.delay(chipsDelay + i * 40).duration(320)}>
              <Chip label={t(c.name)} icon={c.icon} active={category === c.id} activeColor={c.color} onPress={() => { setCategory(category === c.id ? 'all' : c.id); setSchool('all'); }} />
            </Animated.View>
          ))}
        </ScrollView>
        {category === 'academic' && !guest && (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.rail, { paddingTop: 4, gap: 8 }]}>
              {schools.map(s => <Chip key={s.id} small light label={t(s.name)} active={school === s.id} onPress={() => setSchool(school === s.id ? 'all' : s.id)} />)}
            </ScrollView>
          </Animated.View>
        )}
      </Animated.View>

      {/* how many places the filter shows (clearing = tapping the chip again) */}
      {category !== 'all' && (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={[styles.strip, { top: stripTop }]} pointerEvents="none">
          <Icon name={chips.find(c => c.id === category)?.icon ?? 'pin'} size={15} stroke="#fff" />
          <T weight="medium" numberOfLines={1} style={{ flex: 1, color: '#fff', fontSize: 13 }}>{t(COUNT_LABEL[category] ?? '{n} places', { n: count })}</T>
        </Animated.View>
      )}

      {/* edge states, compact: they keep the map usable and say what is missing */}
      <View style={{ position: 'absolute', top: stripTop + (category !== 'all' ? 48 : 0), left: 14, right: 14, gap: 8 }} pointerEvents="box-none">
        {!online && <Banner icon="wifiOff" tone="dark" text={t("No connection · the map works, crowding, open-now and questions don't")} />}
        {loc.reason === 'no-permission' && (loc.insecureWeb
          ? <Banner icon="locate" text={t('This browser blocks location on a network address. Open GoMap in Expo Go, or on localhost.')} />
          : <Banner icon="locate" text={loc.blocked ? t('Location is turned off for this app. Turn it on in Settings for directions.') : t('Turn on location for directions. Browsing works without it.')} action={loc.blocked ? t('Open settings') : t('Allow')} onAction={loc.request} />)}
        {loc.reason === 'imprecise' && <Banner icon="locate" tone="dark" text={t('This device can only guess your location (about ±{m} m), so it is not shown and routes start from the main plaza. On a phone, GPS is accurate to a few metres.', { m: Math.round((loc.rawAccuracy ?? 0) / 10) * 10 })} />}
        {loc.reason === 'off-campus' && <Banner icon="locate" tone="dark" text={t("You're away from AUI · routes start from the main plaza (demo position)")} />}
        {!guest && nextUp && category === 'all' && (
          <Animated.View entering={FadeIn.duration(260)} exiting={FadeOut.duration(150)}>
            <Pressable accessibilityRole="button" onPress={() => push({ name: 'events', id: nextUp.id })} style={[styles.banner, { backgroundColor: '#fff' }]}>
              <View style={styles.evDot}><Icon name="events" size={14} stroke="#fff" /></View>
              <T numberOfLines={1} style={{ flex: 1, fontSize: 12.5 }}><T weight="bold" style={{ fontSize: 12.5 }}>{nextUp.title}</T> · {whenText(nextUp, lang, t)}{nextUp.place ? ` · ${nextUp.place.name}` : ''}</T>
              <Icon name="chevron" size={14} stroke={color.muted} />
            </Pressable>
          </Animated.View>
        )}
        {density && (
          <Animated.View entering={rise} exiting={FadeOut.duration(150)}>
            <Pressable accessibilityRole="button" onPress={() => push({ name: 'crowding' })} style={[styles.banner, { backgroundColor: '#fff' }]}>
              <View style={styles.legend}>{['#FDE68A', '#F59E0B', '#B45309'].map(c => <View key={c} style={[styles.legendDot, { backgroundColor: c }]} />)}</View>
              <T style={{ flex: 1, fontSize: 12.5 }}>{t('Busy paths right now · quiet paths are left as they are')}</T>
              <T weight="bold" style={{ fontSize: 12.5, color: color.blue }}>{t('By hour')}</T>
            </Pressable>
          </Animated.View>
        )}
      </View>

      {/* visitors: a welcome with the places people come for, one tap to walk there */}
      {guest && (
        <Animated.View entering={rise} layout={LinearTransition} style={[styles.visitor, { bottom: insets.bottom + 88 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.visitorIcon]}><Icon name="visitor" size={20} stroke="#0E7490" /></View>
            <View style={{ flex: 1 }}>
              <T weight="bold" style={{ fontSize: 16 }}>{t('Welcome to Al Akhawayn')}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{t('Where would you like to go? We will walk you there.')}</T>
            </View>
          </View>
          {upcoming[0] && (
            <Pressable accessibilityRole="button" onPress={() => push({ name: 'events', id: upcoming[0].id })} style={({ pressed }) => [styles.visitorEvent, pressed && { opacity: 0.85 }]}>
              <View style={styles.evDot}><Icon name="events" size={14} stroke="#fff" /></View>
              <View style={{ flex: 1 }}>
                <T weight="bold" numberOfLines={1} style={{ fontSize: 14 }}>{upcoming[0].title}</T>
                <T numberOfLines={1} style={{ fontSize: 12, color: '#86198F' }}>{whenText(upcoming[0], lang, t)}{upcoming[0].place ? ` · ${upcoming[0].place.name}` : ''}</T>
              </View>
              <T weight="bold" style={{ fontSize: 12.5, color: '#A21CAF' }}>{upcoming.length > 1 ? t('+{n} more', { n: upcoming.length - 1 }) : t('Details')}</T>
            </Pressable>
          )}
          <View style={styles.spots}>
            {spots.map((s, i) => (
              <Animated.View key={s.id} entering={FadeInDown.delay(80 + i * 40).duration(260)} style={styles.spotWrap}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Walk to {place}', { place: t(s.name) })} onPress={() => goTo(s.id)} style={({ pressed }) => [styles.spot, pressed && { transform: [{ scale: 0.97 }], backgroundColor: '#EAF6F8' }]}>
                  <Icon name={s.icon} size={18} stroke="#0E7490" />
                  <T weight="semibold" numberOfLines={1} style={{ fontSize: 13, flexShrink: 1 }}>{t(s.name)}</T>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      )}

      {/* role widget: campus pulse, lunch, or the professor's door */}
      <RoleWidget bottom={insets.bottom + 88} />

      {/* FAB stack */}
      <View style={[styles.fabs, { bottom: insets.bottom + 96 + raised }, guest && { bottom: insets.bottom + (upcoming[0] ? 392 : 330) + raised }]} pointerEvents="box-none">
        {!guest && (
          <IconBtn icon="flame" label={density ? t('Hide busy paths') : t('Show busy paths now')} size={50}
            bg={density ? '#B45309' : undefined} stroke={density ? '#fff' : undefined} onPress={() => map.setLayers({ crowding: !density })} />
        )}
        <IconBtn icon="locate" label={t('Centre on my location')} size={50} onPress={() => (loc.coord ? map.send({ type: 'locate' }) : loc.request())} />
        <IconBtn icon="layers" label={t('Map style and layers')} size={50} bg="#23251F" stroke="#fff" onPress={() => push({ name: 'layers' })} />
      </View>

      {/* the assistant pill: type, or hold the mic */}
      <Animated.View entering={rise.delay(160)} style={[styles.pill, { bottom: insets.bottom + 20 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Ask GoMap')} onPress={() => push({ name: 'assistant' })} style={styles.pillText}>
          <Icon name="sparkle" size={20} stroke={color.blue} />
          <T numberOfLines={1} style={{ flex: 1, color: color.muted, fontSize: 14 }}>{guest ? t('Ask where something is') : t('Ask GoMap · where is, how do I…')}</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Ask by voice')} onPress={() => push({ name: 'voice' })} style={styles.mic}>
          <Icon name="mic" size={20} stroke={color.ink} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function Banner({ icon, text, tone = 'light', action, onAction }: { icon: IconName; text: string; tone?: 'light' | 'dark'; action?: string; onAction?: () => void }) {
  const dark = tone === 'dark';
  return (
    <Animated.View entering={rise} exiting={FadeOut.duration(150)} style={[styles.banner, { backgroundColor: dark ? 'rgba(21,23,26,0.88)' : '#fff' }]}>
      <Icon name={icon} size={16} stroke={dark ? '#fff' : color.ink} />
      <T style={{ flex: 1, fontSize: 12.5, color: dark ? '#fff' : color.ink }}>{text}</T>
      {action && <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}><T weight="bold" style={{ fontSize: 12.5, color: color.blue }}>{action}</T></Pressable>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  role: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', ...shadow.float },
  rail: { paddingHorizontal: 14, gap: 10, alignItems: 'center', paddingBottom: 6 },
  strip: { position: 'absolute', left: 14, right: 14, height: 40, borderRadius: 12, backgroundColor: 'rgba(21,23,26,0.86)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, ...shadow.float },
  legend: { flexDirection: 'row', gap: 3 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  fabs: { position: 'absolute', end: 16, gap: 12 },
  pill: { position: 'absolute', left: 12, right: 12, height: 56, borderRadius: 999, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingStart: 16, paddingEnd: 6, gap: 6, ...shadow.pill },
  pillText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: '100%' },
  mic: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F2F0', alignItems: 'center', justifyContent: 'center' },
  visitor: { position: 'absolute', left: 12, right: 12, padding: 14, borderRadius: 20, backgroundColor: '#fff', gap: 12, ...shadow.float },
  visitorIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#EAF6F8', alignItems: 'center', justifyContent: 'center' },
  spots: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  evDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#C026D3', alignItems: 'center', justifyContent: 'center' },
  visitorEvent: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: '#FDF4FF', borderWidth: 1, borderColor: '#F5D0FE' },
  spotWrap: { width: '50%', padding: 4 },
  spot: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#F3FAFB', borderWidth: 1, borderColor: '#D6EEF2' },
});
