import React, { useEffect } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { usePerson, usePlaces } from '../api/hooks';
import { useMap } from '../map/MapContext';
import { useApp } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { availabilityText, availabilityTone, fmtDate, HoursTable, timeAgo } from '../ui/bits';
import { Btn, IconBtn, Label, Loading, Notice, Provenance, StatusPill, T, Tag } from '../ui/kit';
import { color, status } from '../ui/theme';

export default function PersonPanel({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const map = useMap();
  const nav = useNav();
  const { user } = useApp();
  const { data: p, isLoading } = usePerson(id);
  const places = usePlaces();
  const place = places.data?.find(x => x.id === p?.place?.id);

  useEffect(() => { if (p?.place) map.send({ type: 'select', id: p.place.id, bottom: 600, dim: true }); return () => map.send({ type: 'select', id: null }); }, [p?.place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeMe = async () => {
    if (!place) return;
    await nav.preview({ placeId: place.id, name: place.name, coordinates: place.coordinates, category: place.category });
    push({ name: 'route' });
  };

  if (isLoading || !p) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', paddingTop: insets.top + 60 }]}><Loading /></View>;
  const tone = availabilityTone(p.availability);
  const first = p.name.split(' ')[0];
  const nothing = p.missing.includes('office') && p.missing.includes('hours');

  return (
    <Animated.View entering={SlideInRight.duration(260)} style={[StyleSheet.absoluteFill, { top: 200 + insets.top * 0.4 }]}>
      <View style={[styles.back, { top: -150 }]}><IconBtn icon="back" label="Back" onPress={pop} size={40} /></View>
      <View style={styles.body}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 28, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <T weight="bold" style={{ fontSize: 23, letterSpacing: -0.5 }} accessibilityRole="header">{p.name}</T>
            <T style={{ fontSize: 14, lineHeight: 20, color: '#5F6368' }}>{[p.title, p.department?.name].filter(Boolean).join(' · ') || 'Faculty'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {!nothing && <StatusPill tone={tone} text={availabilityText(p.availability)} />}
              {p.place && <Tag text={`${p.place.name}${p.office_number ? ` · Office ${p.office_number}` : ''}`} />}
            </View>
          </View>

          {/* the override, straight from them */}
          {p.presence && (
            <View style={[styles.override, { backgroundColor: status.busy.bg === '#FFF3DB' && p.presence.status === 'in' ? '#EEF8F2' : '#FFF9EE', borderColor: p.presence.status === 'in' ? '#BFE3CD' : '#F0DCB0' }]}>
              <View style={[styles.initials, { backgroundColor: p.presence.status === 'in' ? status.open.bg : status.busy.bg }]}><T weight="bold" style={{ fontSize: 11, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>{p.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</T></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" style={{ fontSize: 13, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>{first} set this {p.presence.set_by === p.name ? 'themselves' : `(by ${p.presence.set_by})`}, {timeAgo(p.presence.set_at)}</T>
                <T style={{ fontSize: 12.5, lineHeight: 18, marginTop: 3, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>
                  {p.presence.status === 'in' ? 'In the office now, whatever the posted hours say.' : 'Posted hours are paused for today. Email is the surer bet.'} Clears itself at {p.presence.clears_at}.
                </T>
              </View>
            </View>
          )}

          {nothing ? (
            <>
              <Notice tone="missing" text={`The directory has a profile for ${first} but no room or office hours, so GoMap will not guess one. Email first.`} />
              <View style={styles.blank}>
                {[['Office', p.place ? `${p.place.name} ${p.office_number ?? ''}` : 'Not published'], ['Office hours', 'Not published'], ['Email', p.email ?? 'Not published']].map(([k, v], i) => (
                  <View key={k} style={[styles.blankRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: '#F1F1EE' }]}>
                    <T weight="semibold" style={{ width: 110, fontSize: 13.5 }}>{k}</T><T style={{ flex: 1, fontSize: 13.5, color: v === 'Not published' ? status.missing.fg : color.ink2 }}>{v}</T>
                  </View>
                ))}
              </View>
              {p.profile_url && <Btn title="Open the faculty profile" kind="secondary" onPress={() => Linking.openURL(p.profile_url!)} />}
              <Btn title="Tell the admin it is missing" kind="ghost" onPress={() => push({ name: 'report', at: place?.coordinates })} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title="Take me there" icon="walk" onPress={takeMe} disabled={!place} style={{ flex: 1 }} />
                {p.email && <IconBtn icon="mail" label={`Email ${p.email}`} onPress={() => Linking.openURL(`mailto:${p.email}`)} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />}
                {p.phone && <IconBtn icon="phone" label={`Call ${p.phone}`} onPress={() => Linking.openURL(`tel:${p.phone!.replace(/[^\d+]/g, '')}`)} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />}
              </View>
              {!p.email && <Notice tone="missing" text={`No email is published for ${first}. Try the school office.`} />}
              <View>
                <Label style={{ marginBottom: 8 }}>Office hours</Label>
                {p.hours ? <HoursTable hours={p.hours} paused={!!p.presence && p.presence.status !== 'in'} /> : <Notice tone="missing" text={p.hours_raw ? `Posted as: “${p.hours_raw}”. GoMap could not read exact times, so none are shown.` : 'Hours not published. Email first.'} />}
                {(p.hours_note || p.by_appointment) && <T style={{ fontSize: 12.5, color: color.muted, marginTop: 8 }}>{p.hours_note ?? 'Also by appointment.'}</T>}
              </View>
              {p.shared_with.length > 0 && (
                <Notice text={`Office ${p.office_number} is shared with ${p.shared_with.map(s => s.name).join(' and ')}. Email ahead during busy weeks.`} action={p.shared_with.length === 1 ? 'Open' : undefined} onAction={() => push({ name: 'person', id: p.shared_with[0].id })} />
              )}
              {p.conflict && (
                <Notice tone="missing" text={`Sources disagree on the office: ${p.conflict.values.map(v => `${v.value} (${v.source})`).join(' vs ')}. The admin has been asked to check.`} />
              )}
            </>
          )}

          {p.stale && !nothing && <Notice icon="clock" text="This record is past its review date. Details may have changed: check the door card." />}
          {user.id === p.id && <Btn title="Set my status for today" kind="dark" icon="user" onPress={() => router.push('/faculty-status')} />}
          <Provenance text={`From the ${p.source}${p.verified_at ? ` · verified ${fmtDate(p.verified_at)}` : ' · not verified'}`} onReport={() => push({ name: 'report', at: place?.coordinates })} />
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 14 },
  body: { flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  override: { flexDirection: 'row', gap: 11, padding: 13, borderWidth: 1, borderRadius: 13 },
  initials: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  blank: { borderWidth: 1, borderColor: '#EBEBE7', borderRadius: 14, overflow: 'hidden' },
  blankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
});
