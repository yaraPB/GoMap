import React, { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { openAR } from '../ar/open';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { usePlace } from '../api/hooks';
import { fmtMinutes } from '../ar/geo';
import { useMap } from '../map/MapContext';
import { DEMO_POSITION, useApp, useLocation } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { fmtDate, openText } from '../ui/bits';
import { Btn, Icon, IconBtn, Label, Loading, Notice, Provenance, Sheet, StatusPill, T, Tag } from '../ui/kit';
import { categoryColor, categoryName, color, schools } from '../ui/theme';
import { formatHours, useLang, useT } from '../i18n';
import { fmtMinutesT } from '../ar/geo';

export default function PlaceSheet({ id }: { id: string }) {
  const { push, pop, replace } = usePanels();
  const map = useMap();
  const loc = useLocation();
  const nav = useNav();
  const { user } = useApp();
  const t = useT();
  const lang = useLang();
  const { data: place, isLoading, error } = usePlace(id);
  const from = loc.coord ?? DEMO_POSITION;
  const walk = useQuery({ queryKey: ['eta', id, Math.round(from[0] * 2000), Math.round(from[1] * 2000)], queryFn: () => api.route(from, { placeId: id }, 'walk'), enabled: !!place && place.status !== 'closed', staleTime: 60_000 });

  useEffect(() => {
    map.send({ type: 'select', id, bottom: 470, dim: true });
    return () => map.send({ type: 'select', id: null });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (mode: 'walk' | 'ar') => {
    if (!place) return;
    await nav.preview({ placeId: place.id, name: place.name, coordinates: place.coordinates, category: place.category }, 'walk');
    if (mode === 'ar') { nav.start(); replace({ name: 'go' }); openAR(); } else push({ name: 'route' });
  };

  // no close button: tap the map (or swipe the card down) to go back
  return (
    <Sheet snaps={[0.56, 0.9]} onClose={pop}>
      {isLoading ? <Loading /> : error || !place ? <View style={{ padding: 20 }}><Notice tone="missing" text={t('This place could not be loaded. Check your connection and try again.')} /></View> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
          <View style={{ gap: 7 }}>
            <T weight="bold" style={{ fontSize: 24, letterSpacing: -0.5 }} accessibilityRole="header">{place.name}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: categoryColor(place.category) }} />
              <T weight="semibold" style={{ fontSize: 14, color: categoryColor(place.category) }}>{t(categoryName(place.category))}</T>
              {!!place.schools.length && place.category === 'academic' && <T style={{ fontSize: 14, color: color.muted }}>· {place.schools.map(s => t(schools.find(x => x.id === s)?.name ?? s)).join(', ')}</T>}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {place.status === 'closed' ? <StatusPill tone="closed" text={place.closed_until ? t('Closed until {date}', { date: fmtDate(place.closed_until, lang) ?? '' }) : t('Closed')} /> : (() => { const o = openText(place.open_state, null, t); return <StatusPill tone={o.tone} text={o.tone === 'missing' ? t('Hours not published') : o.text} />; })()}
              {walk.data && <Tag text={t('{time} walk', { time: fmtMinutesT(walk.data.duration_s, t) })} />}
              {place.entrances.some(e => e.step_free) && <Tag text={place.entrances.every(e => e.estimated) ? t('Step-free entrance (estimated)') : t('Step-free entrance')} />}
            </View>
          </View>

          {place.status === 'closed' && <Notice tone="missing" icon="ban" text={`${place.closed_reason ?? t('Closed')}. ${t('Walking routes avoid it until it reopens.')}`} />}

          {place.status !== 'closed' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title={t('Directions')} icon="walk" onPress={() => go('walk')} style={{ flex: 1 }} loading={nav.status === 'loading'} />
              <IconBtn icon="ar" label={t('Guide me in AR')} onPress={() => go('ar')} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />
              <IconBtn icon="flag" label={t('Report a problem here')} onPress={() => push({ name: 'report', at: place.coordinates })} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />
            </View>
          )}

          {(place.position_estimated || !place.verified) && (
            <Notice text={place.position_estimated ? t('The pin position is estimated: this building is not labelled in the map data yet.') : t('Details here have not been confirmed by the campus office yet.')} />
          )}

          {!!place.description && <T style={{ fontSize: 14, lineHeight: 20, color: color.ink2 }}>{place.description}</T>}

          {user.role !== 'guest' && place.departments.length > 0 && (
            <View>
              <Label style={{ marginBottom: 4 }}>{t("What's inside")}</Label>
              {/* a building holds many offices: list departments with a count, never people here */}
              {place.departments.map(d => (
                <Pressable key={d.id} accessibilityRole="button" onPress={() => push({ name: 'offices', placeId: place.id, department: d.id })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.hairline }, pressed && { opacity: 0.7 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' }}><Icon name="building" size={18} stroke={color.ink2} /></View>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 15 }}>{t(d.name)}</T>
                    <T style={{ fontSize: 12.5, color: color.muted, marginTop: 1 }}>{d.count === 1 ? t('1 office') : t('{n} offices', { n: d.count })}</T>
                  </View>
                  <Icon name="chevron" size={16} stroke={color.muted} />
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => push({ name: 'offices', placeId: place.id })} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.hairline }}>
                <T weight="semibold" style={{ color: color.blue, fontSize: 14 }}>{t('All {n} offices in {place}', { n: place.people_count, place: place.name })}</T>
              </Pressable>
            </View>
          )}

          {place.hours && <View><Label style={{ marginBottom: 6 }}>{t('Opening hours')}</Label><T style={{ fontSize: 14, color: color.ink2 }}>{formatHours(place.hours, lang, t)}</T></View>}

          <Provenance text={place.verified_at ? t('Verified by the campus office on {date}', { date: fmtDate(place.verified_at, lang) ?? '' }) : `${place.source === 'mapbox' ? t('Position from the campus map data (Mapbox / OpenStreetMap)') : t('Position estimated')} · ${t('not verified')}`}
            onReport={() => push({ name: 'report', at: place.coordinates })} />
        </ScrollView>
      )}
    </Sheet>
  );
}
