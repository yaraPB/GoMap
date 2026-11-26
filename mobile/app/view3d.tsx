import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { usePlaces } from '../src/api/hooks';
import type { RouteSegment } from '../src/api/types';
import { useT } from '../src/i18n';
import Campus3D, { type Campus3DEvent, type Campus3DHandle } from '../src/map/Campus3D';
import { useLocation } from '../src/state/app';
import { useNav } from '../src/state/navigation';
import { usePanels } from '../src/state/panels';
import { Icon, Loading, Notice, T } from '../src/ui/kit';
import { categoryColor, categoryName, color, shadow } from '../src/ui/theme';

const ROUTE_COLOR = (s: RouteSegment) => (s.steep ? '#D97706' : s.kind === 'drive' ? '#2563EB' : s.kind === 'stairs' ? '#EA580C' : '#16A34A');

/**
 * Campus as Google photographed it, in 3D: look around, find a building by what it looks like.
 * Tap a pin for its card; tap the card to open it on the map; tap anywhere else to put it away.
 * Opened from Map style and layers, or from a place ("See it in 3D"), which it flies to.
 */
export default function View3D() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { place: initial } = useLocalSearchParams<{ place?: string }>();
  const places = usePlaces();
  const loc = useLocation();
  const nav = useNav();
  const { push } = usePanels();
  const page = useRef<Campus3DHandle>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const picked = places.data?.find(p => p.id === selected) ?? null;

  const onEvent = (e: Campus3DEvent) => {
    if (e.type === 'ready') setReady(true);
    if (e.type === 'error') setError(String(e.detail ?? ''));
    if (e.type === 'select') setSelected(String(e.detail));
    if (e.type === 'tapMap') setSelected(null);
  };

  // keep the page in step: pins, the selected one, you, and the route if one is open
  useEffect(() => {
    if (ready && places.data) page.current?.send({ type: 'places', list: places.data.map(p => ({ id: p.id, name: p.name, coordinates: p.coordinates, color: categoryColor(p.category) })) });
  }, [ready, places.data]);
  useEffect(() => { if (ready) page.current?.send({ type: 'select', id: selected }); }, [ready, selected, places.data]);
  useEffect(() => { if (ready) page.current?.send({ type: 'user', coord: loc.coord }); }, [ready, loc.coord]);
  useEffect(() => {
    if (!ready) return;
    const r = nav.route;
    const segments = r?.segments?.length ? r.segments.map(s => ({ color: ROUTE_COLOR(s), coordinates: s.coordinates })) : r ? [{ color: '#16A34A', coordinates: r.geometry.coordinates }] : [];
    page.current?.send({ type: 'route', segments });
  }, [ready, nav.route]);

  const openOnMap = () => {
    if (!picked) return;
    router.back();
    push({ name: 'place', id: picked.id });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#14211b' }}>
      <Campus3D ref={page} onEvent={onEvent} />

      {!ready && !error && <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none"><Loading label={t('Loading campus in 3D')} /></View>}
      {error && <View style={[styles.error, { top: insets.top + 64 }]}><Notice tone="missing" icon="map" text={t('The 3D view could not load. Check the connection and the Google Map Tiles key.')} /></View>}

      {/* the way back: this view fills the screen, so there is no "outside" to tap */}
      <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel={t('Back to the map')} onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Icon name="back" size={18} stroke={color.ink} />
          <T weight="semibold" style={{ fontSize: 14 }}>{t('Map')}</T>
        </Pressable>
        {ready && !picked && <Animated.View entering={FadeIn.delay(400)} exiting={FadeOut} style={styles.hint}><T style={{ fontSize: 12.5, color: '#fff' }}>{t('Drag to look around · tap a pin')}</T></Animated.View>}
      </View>

      {picked && (
        <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(150)} style={[styles.card, { bottom: insets.bottom + 20 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Open {place} on the map', { place: picked.name })} onPress={openOnMap} style={styles.cardInner}>
            <View style={[styles.dot, { backgroundColor: categoryColor(picked.category) }]} />
            <View style={{ flex: 1 }}>
              <T weight="bold" numberOfLines={1} style={{ fontSize: 16 }}>{picked.name}</T>
              <T style={{ fontSize: 12.5, color: color.muted }}>{t(categoryName(picked.category))} · {t('Tap to open it on the map')}</T>
            </View>
            <Icon name="chevron" size={18} stroke={color.muted} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { position: 'absolute', left: 14, right: 14 },
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingStart: 10, paddingEnd: 14, borderRadius: 20, backgroundColor: '#fff', ...shadow.float },
  hint: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(14,24,39,0.6)', justifyContent: 'center' },
  card: { position: 'absolute', left: 12, right: 12, borderRadius: 18, backgroundColor: '#fff', ...shadow.float },
  cardInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  dot: { width: 14, height: 14, borderRadius: 7 },
});
