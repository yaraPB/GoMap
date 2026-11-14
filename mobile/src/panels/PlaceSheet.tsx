import React, { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
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

export default function PlaceSheet({ id }: { id: string }) {
  const { push, pop, replace } = usePanels();
  const map = useMap();
  const loc = useLocation();
  const nav = useNav();
  const { user } = useApp();
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
    if (mode === 'ar') { nav.start(); replace({ name: 'go' }); router.push('/ar'); } else push({ name: 'route' });
  };

  const header = (
    <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
      <View style={{ position: 'absolute', right: 16, top: -4 }}><IconBtn icon="close" label="Close" onPress={pop} float={false} bg={color.surface} size={36} /></View>
    </View>
  );

  return (
    <Sheet snaps={[0.56, 0.9]} onClose={pop} header={header}>
      {isLoading ? <Loading /> : error || !place ? <View style={{ padding: 20 }}><Notice tone="missing" text="This place could not be loaded. Check your connection and try again." /></View> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
          <View style={{ gap: 7, paddingRight: 44 }}>
            <T weight="bold" style={{ fontSize: 24, letterSpacing: -0.5 }} accessibilityRole="header">{place.name}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: categoryColor(place.category) }} />
              <T weight="semibold" style={{ fontSize: 14, color: categoryColor(place.category) }}>{categoryName(place.category)}</T>
              {!!place.schools.length && place.category === 'academic' && <T style={{ fontSize: 14, color: color.muted }}>· {place.schools.map(s => schools.find(x => x.id === s)?.name).join(', ')}</T>}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {place.status === 'closed' ? <StatusPill tone="closed" text={`Closed${place.closed_until ? ` until ${fmtDate(place.closed_until)}` : ''}`} /> : (() => { const o = openText(place.open_state); return <StatusPill tone={o.tone} text={o.tone === 'missing' ? 'Hours not published' : o.text} />; })()}
              {walk.data && <Tag text={`${fmtMinutes(walk.data.duration_s)} walk`} />}
              {place.entrances.some(e => e.step_free) && <Tag text={place.entrances.every(e => e.estimated) ? 'Step-free entrance (estimated)' : 'Step-free entrance'} />}
            </View>
          </View>

          {place.status === 'closed' && <Notice tone="missing" icon="ban" text={`${place.closed_reason ?? 'Closed'}. Walking routes avoid it until it reopens.`} />}

          {place.status !== 'closed' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn title="Directions" icon="walk" onPress={() => go('walk')} style={{ flex: 1 }} loading={nav.status === 'loading'} />
              <IconBtn icon="ar" label="Guide me in AR" onPress={() => go('ar')} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />
              <IconBtn icon="flag" label="Report a problem here" onPress={() => push({ name: 'report', at: place.coordinates })} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />
            </View>
          )}

          {(place.position_estimated || !place.verified) && (
            <Notice text={place.position_estimated ? 'The pin position is estimated: this building is not labelled in the map data yet.' : 'Details here have not been confirmed by the campus office yet.'} />
          )}

          {!!place.description && <T style={{ fontSize: 14, lineHeight: 20, color: color.ink2 }}>{place.description}</T>}

          {user.role !== 'guest' && place.departments.length > 0 && (
            <View>
              <Label style={{ marginBottom: 4 }}>What's inside</Label>
              {/* a building holds many offices: list departments with a count, never people here */}
              {place.departments.map(d => (
                <Pressable key={d.id} accessibilityRole="button" onPress={() => push({ name: 'offices', placeId: place.id, department: d.id })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.hairline }, pressed && { opacity: 0.7 }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' }}><Icon name="building" size={18} stroke={color.ink2} /></View>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 15 }}>{d.name}</T>
                    <T style={{ fontSize: 12.5, color: color.muted, marginTop: 1 }}>{d.count} {d.count === 1 ? 'office' : 'offices'}</T>
                  </View>
                  <Icon name="chevron" size={16} stroke={color.muted} />
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => push({ name: 'offices', placeId: place.id })} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.hairline }}>
                <T weight="semibold" style={{ color: color.blue, fontSize: 14 }}>All {place.people_count} offices in {place.name}</T>
              </Pressable>
            </View>
          )}

          {place.hours_text && <View><Label style={{ marginBottom: 6 }}>Opening hours</Label><T style={{ fontSize: 14, color: color.ink2 }}>{place.hours_text}</T></View>}

          <Provenance text={place.verified_at ? `Verified by the campus office on ${fmtDate(place.verified_at)}` : `Position from ${place.source === 'mapbox' ? 'the campus map data (Mapbox / OpenStreetMap)' : 'an estimate'} · not yet verified`}
            onReport={() => push({ name: 'report', at: place.coordinates })} />
        </ScrollView>
      )}
    </Sheet>
  );
}
