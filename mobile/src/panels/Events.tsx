import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { openAR } from '../ar/open';
import { useEvents } from '../api/hooks';
import type { CampusEvent } from '../api/types';
import { clock, LOCALE, shortDate, useLang, useT } from '../i18n';
import { useMap } from '../map/MapContext';
import { useApp } from '../state/app';
import { useNav } from '../state/navigation';
import { usePanels } from '../state/panels';
import { Btn, Empty, Icon, IconBtn, Loading, Sheet, T } from '../ui/kit';
import { color, type IconName } from '../ui/theme';

export const EVENT_LOOK: Record<CampusEvent['kind'], { icon: IconName; tint: string; ink: string; name: string }> = {
  talk: { icon: 'faculty', tint: '#F3E8FF', ink: '#7E22CE', name: 'Talk' },
  sport: { icon: 'gym', tint: '#E6F4EC', ink: '#11864F', name: 'Sport' },
  club: { icon: 'users', tint: '#FFF3DB', ink: '#8A5A00', name: 'Clubs' },
  culture: { icon: 'party', tint: '#FCE7F3', ink: '#BE185D', name: 'Culture' },
  official: { icon: 'flag', tint: '#EEF4FF', ink: '#2563EB', name: 'Official' },
  career: { icon: 'staff', tint: '#E0F2F1', ink: '#0F766E', name: 'Careers' },
  other: { icon: 'events', tint: '#F2F3F0', ink: '#3A3D42', name: 'Event' },
};
const ROLE_AUDIENCE: Record<string, string> = { student: 'student', faculty: 'faculty', staff: 'faculty', guest: 'guest' };

/** "On now · until 19:30", "Today 18:00", "Fri 20 Nov · 16:00". */
export function whenText(e: CampusEvent, lang: ReturnType<typeof useLang>, t: ReturnType<typeof useT>) {
  if (e.state === 'now') return t('On now · until {time}', { time: clock(e.ends_at, lang) });
  if (e.state === 'today') return t('Today · {time}', { time: clock(e.starts_at, lang) });
  return `${shortDate(e.starts_at, lang)} · ${clock(e.starts_at, lang)}`;
}

export function useRoleEvents() {
  const { user } = useApp();
  return useEvents(ROLE_AUDIENCE[user.role]);
}

/** Board: what's on. A list grouped by day; tap one to see it on the map and walk there. */
export default function Events({ id }: { id?: string }) {
  const t = useT();
  const lang = useLang();
  const { pop } = usePanels();
  const map = useMap();
  const events = useRoleEvents();
  const [open, setOpen] = useState<string | null>(id ?? null);
  const list = events.data ?? [];
  const current = list.find(e => e.id === open) ?? null;

  // the map shows only event badges while this sheet is up
  useEffect(() => {
    map.send({ type: 'filter', category: 'events', school: 'all', fit: open ? false : 'gentle' });
    return () => map.send({ type: 'filter', category: 'all', school: 'all' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (current?.place) map.send({ type: 'camera', center: current.place.coordinates, zoom: 17.4, duration: 900, padding: { top: 60, bottom: 460, left: 0, right: 0 } });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const day = (iso: string) => new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Casablanca' }).format(new Date(iso));
    const out: { label: string; items: CampusEvent[] }[] = [];
    for (const e of list) {
      const label = e.state === 'now' ? t('Happening now') : e.state === 'today' ? t('Later today') : day(e.starts_at);
      const g = out.find(x => x.label === label);
      if (g) g.items.push(e); else out.push({ label, items: [e] });
    }
    return out;
  }, [list, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <View style={styles.head}>
      {current ? <IconBtn icon="back" label={t('All events')} onPress={() => setOpen(null)} float={false} bg={color.surface} size={36} /> : <View style={styles.headIcon}><Icon name="events" size={20} stroke="#A21CAF" /></View>}
      <View style={{ flex: 1 }}>
        <T weight="bold" style={{ fontSize: 18 }}>{current ? current.title : t("What's on at AUI")}</T>
        {!current && <T style={{ fontSize: 12.5, color: color.muted }}>{list.length ? t('{n} events in the next three weeks', { n: list.length }) : t('Talks, matches, fairs and ceremonies')}</T>}
      </View>
      <IconBtn icon="close" label={t('Close')} onPress={pop} float={false} bg={color.surface} size={36} />
    </View>
  );

  return (
    <Sheet snaps={[0.58, 0.92]} onClose={pop} header={header}>
      {events.isLoading ? <Loading /> : current ? <EventDetail e={current} /> : !list.length ? (
        <Empty icon="events" title={t('Nothing published yet')} body={t('Events appear here as soon as the campus office adds them.')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 14 }}>
          {groups.map((g, gi) => (
            <View key={g.label} style={{ gap: 8 }}>
              <T weight="bold" style={{ fontSize: 12, color: g.label === t('Happening now') ? '#A21CAF' : color.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{g.label}</T>
              {g.items.map((e, i) => {
                const look = EVENT_LOOK[e.kind] ?? EVENT_LOOK.other;
                return (
                  <Animated.View key={e.id} entering={FadeInDown.delay(gi * 60 + i * 40).duration(260)}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${whenText(e, lang, t)}`} onPress={() => setOpen(e.id)}
                      style={({ pressed }) => [styles.row, e.state === 'now' && styles.rowNow, pressed && { transform: [{ scale: 0.985 }] }]}>
                      <View style={[styles.badge, { backgroundColor: look.tint }]}><Icon name={look.icon} size={20} stroke={look.ink} /></View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <T weight="bold" numberOfLines={1} style={{ fontSize: 15, flexShrink: 1 }}>{e.title}</T>
                          {e.sample && <View style={styles.sample}><T weight="bold" style={{ fontSize: 10, color: '#6B4A05' }}>{t('Sample')}</T></View>}
                        </View>
                        <T style={{ fontSize: 12.5, color: e.state === 'now' ? '#A21CAF' : color.ink2 }}>{whenText(e, lang, t)}</T>
                        <T numberOfLines={1} style={{ fontSize: 12.5, color: color.muted }}>{e.place?.name ?? e.location_text ?? t('Place not published')}</T>
                      </View>
                      <Icon name="chevron" size={16} stroke={color.muted} />
                    </Pressable>
                  </Animated.View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

function EventDetail({ e }: { e: CampusEvent }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const { push, replace } = usePanels();
  const look = EVENT_LOOK[e.kind] ?? EVENT_LOOK.other;
  const go = async (ar: boolean) => {
    if (!e.place) return;
    const ok = await nav.preview({ placeId: e.place.id, name: e.place.name, coordinates: e.place.coordinates, category: 'services' }, 'walk');
    if (!ok) return;
    if (ar) { nav.start(); replace({ name: 'go' }); openAR(); } else push({ name: 'route' });
  };
  return (
    <Animated.View entering={FadeIn.duration(220)} style={{ paddingHorizontal: 20, paddingBottom: 28, gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={[styles.pill, { backgroundColor: look.tint }]}><Icon name={look.icon} size={14} stroke={look.ink} /><T weight="semibold" style={{ fontSize: 12.5, color: look.ink }}>{t(look.name)}</T></View>
        <View style={[styles.pill, { backgroundColor: e.state === 'now' ? '#FAE8FF' : color.surface }]}><Icon name="clock" size={14} stroke={e.state === 'now' ? '#A21CAF' : color.ink2} /><T weight="semibold" style={{ fontSize: 12.5, color: e.state === 'now' ? '#A21CAF' : color.ink2 }}>{whenText(e, lang, t)}</T></View>
        {e.sample && <View style={[styles.pill, { backgroundColor: '#FFF3DB' }]}><T weight="semibold" style={{ fontSize: 12.5, color: '#6B4A05' }}>{t('Sample event')}</T></View>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="pin" size={18} stroke={color.ink2} />
        <T style={{ flex: 1, fontSize: 15 }}>{[e.place?.name, e.location_text && e.location_text !== e.place?.name ? e.location_text : null].filter(Boolean).join(' · ') || t('Place not published')}</T>
      </View>
      {!!e.organizer && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="users" size={18} stroke={color.ink2} /><T style={{ flex: 1, fontSize: 14, color: color.ink2 }}>{e.organizer}</T></View>}
      {!!e.description && <T style={{ fontSize: 14.5, lineHeight: 21, color: color.ink2 }}>{e.description}</T>}
      {e.place ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title={t('Take me there')} icon="walk" style={{ flex: 1 }} onPress={() => go(false)} />
          <Btn title={t('AR')} icon="ar" kind="secondary" onPress={() => go(true)} />
        </View>
      ) : <T style={{ fontSize: 12.5, color: color.muted }}>{t('No place on the map for this one yet, so no directions.')}</T>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  headIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#FAE8FF', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: color.hairline },
  rowNow: { borderColor: '#E9B8F2', backgroundColor: '#FDF6FF' },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sample: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#FFF3DB' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 999 },
});
