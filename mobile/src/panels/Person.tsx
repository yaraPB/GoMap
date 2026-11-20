import React, { useEffect } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { usePerson, usePlaces } from '../api/hooks';
import { useMap } from '../map/MapContext';
import { useApp } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { availabilityText, availabilityTone, fmtDate, HoursTable, timeAgo } from '../ui/bits';
import { Btn, IconBtn, Label, Loading, Notice, Provenance, Sheet, StatusPill, T, Tag } from '../ui/kit';
import { NoteTag, StickyNote } from '../ui/StickyNote';
import { shortDate, useLang, useT } from '../i18n';
import { color, status } from '../ui/theme';

export default function PersonPanel({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const { pop, push } = usePanels();
  const map = useMap();
  const nav = useNav();
  const { user } = useApp();
  const t = useT();
  const lang = useLang();
  const { data: p, isLoading } = usePerson(id);
  const places = usePlaces();
  const place = places.data?.find(x => x.id === p?.place?.id);

  useEffect(() => { if (p?.place) map.send({ type: 'select', id: p.place.id, bottom: 600, dim: true }); return () => map.send({ type: 'select', id: null }); }, [p?.place?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeMe = async () => {
    if (!place) return;
    await nav.preview({ placeId: place.id, name: place.name, coordinates: place.coordinates, category: place.category });
    push({ name: 'route' });
  };

  if (isLoading || !p) return <Sheet snaps={[0.7, 0.92]} onClose={pop}><Loading /></Sheet>;
  const tone = availabilityTone(p.availability);
  const first = p.name.split(' ')[0];
  const nothing = p.missing.includes('office') && p.missing.includes('hours');
  const longAway = !!p.presence && p.presence.status === 'out' && !!p.presence.until && new Date(p.presence.until).toDateString() !== new Date().toDateString();

  return (
    // the map above shows their building: tap it (or swipe down) to go back
    <Sheet snaps={[0.7, 0.92]} onClose={pop}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: insets.bottom + 28, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <T weight="bold" style={{ fontSize: 23, letterSpacing: -0.5, flexShrink: 1 }} accessibilityRole="header">{p.name}</T>
              <NoteTag kind={p.note_kind} text={p.note} />
            </View>
            <T style={{ fontSize: 14, lineHeight: 20, color: '#5F6368' }}>{[p.title, p.department?.name].filter(Boolean).join(' · ') || t('Faculty')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {!nothing && <StatusPill tone={tone} text={availabilityText(p.availability, t, lang, p.presence?.until)} />}
              {p.place && <Tag text={`${p.place.name}${p.office_number ? ` · ${t('Office {n}', { n: p.office_number })}` : ''}`} />}
            </View>
          </View>

          {/* the override, straight from them */}
          {p.presence && (
            <View style={[styles.override, { backgroundColor: status.busy.bg === '#FFF3DB' && p.presence.status === 'in' ? '#EEF8F2' : '#FFF9EE', borderColor: p.presence.status === 'in' ? '#BFE3CD' : '#F0DCB0' }]}>
              <View style={[styles.initials, { backgroundColor: p.presence.status === 'in' ? status.open.bg : status.busy.bg }]}><T weight="bold" style={{ fontSize: 11, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>{p.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</T></View>
              <View style={{ flex: 1 }}>
                <T weight="semibold" style={{ fontSize: 13, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>{p.presence.set_by === p.name ? t('{name} set this themselves, {ago}', { name: first, ago: timeAgo(p.presence.set_at, t) }) : t('Set by {who}, {ago}', { who: p.presence.set_by, ago: timeAgo(p.presence.set_at, t) })}</T>
                <T style={{ fontSize: 12.5, lineHeight: 18, marginTop: 3, color: p.presence.status === 'in' ? status.open.fg : status.busy.fg }}>
                  {p.presence.status === 'in' ? t('In the office now, whatever the posted hours say.') : longAway ? t('Away until {date}. Posted hours are paused until then; email is the surer bet.', { date: shortDate(p.presence.until!, lang) }) : t('Posted hours are paused for today. Email is the surer bet.')}{!longAway ? ` ${t('Clears itself at {time}.', { time: p.presence.clears_at })}` : ''}
                </T>
              </View>
            </View>
          )}

          {(!!p.note || !!p.note_kind) && <View style={{ gap: 6 }}><T weight="bold" style={{ fontSize: 12, color: color.muted }}>{t("On {name}'s door", { name: first }).toUpperCase()}</T><StickyNote kind={p.note_kind} text={p.note} /></View>}

          {nothing ? (
            <>
              <Notice tone="missing" text={t('The directory has a profile for {name} but no room or office hours, so GoMap will not guess one. Email first.', { name: first })} />
              <View style={styles.blank}>
                {[[t('Office'), p.place ? `${p.place.name} ${p.office_number ?? ''}` : t('Not published')], [t('Office hours'), t('Not published')], [t('Email'), p.email ?? t('Not published')]].map(([k, v], i) => (
                  <View key={k} style={[styles.blankRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: '#F1F1EE' }]}>
                    <T weight="semibold" style={{ width: 110, fontSize: 13.5 }}>{k}</T><T style={{ flex: 1, fontSize: 13.5, color: v === t('Not published') ? status.missing.fg : color.ink2 }}>{v}</T>
                  </View>
                ))}
              </View>
              {p.profile_url && <Btn title={t('Open the faculty profile')} kind="secondary" onPress={() => Linking.openURL(p.profile_url!)} />}
              <Btn title={t('Tell the admin it is missing')} kind="ghost" onPress={() => push({ name: 'report', at: place?.coordinates })} />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Btn title={t('Take me there')} icon="walk" onPress={takeMe} disabled={!place} style={{ flex: 1 }} />
                {p.email && <IconBtn icon="mail" label={t('Email {who}', { who: p.email })} onPress={() => Linking.openURL(`mailto:${p.email}`)} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />}
                {p.phone && <IconBtn icon="phone" label={t('Call {who}', { who: p.phone })} onPress={() => Linking.openURL(`tel:${p.phone!.replace(/[^\d+]/g, '')}`)} size={50} float={false} style={{ borderRadius: 14, borderWidth: 1, borderColor: color.line }} />}
              </View>
              {!p.email && <Notice tone="missing" text={t('No email is published for {name}. Try the school office.', { name: first })} />}
              <View>
                <Label style={{ marginBottom: 8 }}>{t('Office hours')}</Label>
                {p.hours ? <HoursTable hours={p.hours} paused={!!p.presence && p.presence.status !== 'in'} /> : <Notice tone="missing" text={p.hours_raw ? t('Posted as: “{raw}”. GoMap could not read exact times, so none are shown.', { raw: p.hours_raw }) : t('Hours not published. Email first.')} />}
                {(p.hours_note || p.by_appointment) && <T style={{ fontSize: 12.5, color: color.muted, marginTop: 8 }}>{p.hours_note ?? t('Also by appointment.')}</T>}
              </View>
              {p.shared_with.length > 0 && (
                <Notice text={t('Office {n} is shared with {names}. Email ahead during busy weeks.', { n: p.office_number ?? '', names: p.shared_with.map(s => s.name).join(', ') })} action={p.shared_with.length === 1 ? t('Open') : undefined} onAction={() => push({ name: 'person', id: p.shared_with[0].id })} />
              )}
              {p.conflict && (
                <Notice tone="missing" text={t('Sources disagree on the office: {list}. The admin has been asked to check.', { list: p.conflict.values.map(v => `${v.value} (${v.source})`).join(' / ') })} />
              )}
            </>
          )}

          {p.stale && !nothing && <Notice icon="clock" text={t('This record is past its review date. Details may have changed: check the door card.')} />}
          {user.id === p.id && <Btn title={t('Set my status')} kind="dark" icon="door" onPress={() => router.push('/faculty-status')} />}
          <Provenance text={`${t('From the {source}', { source: p.source })}${p.verified_at ? ` · ${t('verified {date}', { date: fmtDate(p.verified_at, lang) ?? '' })}` : ` · ${t('not verified')}`}`} onReport={() => push({ name: 'report', at: place?.coordinates })} />
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  override: { flexDirection: 'row', gap: 11, padding: 13, borderWidth: 1, borderRadius: 13 },
  initials: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  blank: { borderWidth: 1, borderColor: '#EBEBE7', borderRadius: 14, overflow: 'hidden' },
  blankRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
});
