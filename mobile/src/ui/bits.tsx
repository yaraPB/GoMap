import React from 'react';
import { View } from 'react-native';
import type { Availability, Day, Hours, OpenState, Person, Turn } from '../api/types';
import { Icon, T, type Tone } from './kit';
import { color, type IconName } from './theme';
import { dayName, makeT, shortDate, useLang, useT, type TFn } from '../i18n';
import type { Lang } from '../api/types';

const EN = makeT('en');
const DAYS_EN: Record<string, string> = { monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };
/** Server availability details are English ('In a meeting · until 15:00'): translate them piece by piece. */
export function trDetail(detail: string | null, t: TFn = EN, lang: Lang = 'en', until?: string | null): string | null {
  if (!detail) return null;
  return detail.split(' · ').map(part => {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^until (\d{2}:\d{2})$/))) return t('until {time}', { time: m[1] });
    if ((m = part.match(/^Next: (\w+) (\d{2}:\d{2})$/))) return t('Next: {day} {time}', { day: dayName(DAYS_EN[m[1].toLowerCase()] ?? m[1], lang, true), time: m[2] });
    if ((m = part.match(/^back at (\d{2}:\d{2})$/))) return t('back at {time}', { time: m[1] });
    if (/^back /.test(part)) return t('back {date}', { date: until ? shortDate(until, lang) : part.slice(5) });
    return t(part);
  }).join(' · ');
}

export function availabilityTone(a: Availability): Tone {
  return a.state === 'in' || a.state === 'open' ? 'open' : a.state === 'busy' ? 'busy' : a.state === 'not_published' ? 'missing' : 'closed';
}
export function availabilityText(a: Availability, t: TFn = EN, lang: Lang = 'en', until?: string | null) {
  const d = trDetail(a.detail, t, lang, until);
  return d ? `${t(a.label)} · ${d}` : t(a.label);
}
/** The short status in the office list (board 08). */
export function shortStatus(p: Person, t: TFn = EN): { tone: Tone; text: string } {
  const a = p.availability;
  if (a.state === 'in') return { tone: 'open', text: t('In now') };
  if (a.state === 'busy') return { tone: 'busy', text: t(p.presence?.reason === 'teaching' ? 'Teaching' : p.presence?.reason === 'meeting' ? 'In a meeting' : 'Busy') };
  if (a.state === 'out') return { tone: 'closed', text: t(a.label === 'Away' ? 'Away' : 'Not in today') };
  if (a.state === 'open') return { tone: 'open', text: t('Open now') };
  if (a.state === 'closed') return { tone: 'closed', text: t(a.label === 'At lunch' ? 'At lunch' : 'Closed') };
  return { tone: 'missing', text: t('No hours') };
}

const DAY_KEYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export function todayKey(): Day {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', weekday: 'short' }).format(new Date()).toLowerCase().slice(0, 3);
  return d as Day;
}

/** Weekly hours, with today marked; "paused today" when an override sits on top (board 10). */
export function HoursTable({ hours, paused }: { hours: Hours | null; paused?: boolean }) {
  const t = useT();
  const lang = useLang();
  const today = todayKey();
  const weekend = hours?.sat !== undefined || hours?.sun !== undefined ? (hours.sat?.length || hours.sun?.length ? t('See hours') : t('Closed')) : t('Not published');
  const rows: [string, string, boolean][] = DAY_KEYS.map(k => {
    const v = hours?.[k];
    return [dayName(k, lang, true), v === undefined ? t('No office hours') : v.length ? v.map(([a, b]) => `${a.replace(/^0/, '')}–${b}`).join(' · ') : t('No office hours'), k === today];
  });
  rows.push([t('Weekend'), weekend, today === 'sat' || today === 'sun']);
  return (
    <View style={{ borderWidth: 1, borderColor: '#EBEBE7', borderRadius: 14, overflow: 'hidden' }}>
      {rows.map(([day, slot, now], i) => (
        <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: now ? '#FFFBF2' : '#fff', borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: '#F1F1EE' }}>
          <T weight="semibold" style={{ width: 86, fontSize: 13.5 }}>{day}</T>
          <T style={{ flex: 1, fontSize: 13.5, color: color.ink2 }}>{slot}</T>
          {now && <View style={{ height: 21, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center', backgroundColor: paused ? '#8A5A00' : color.greenDeep }}>
            <T weight="bold" style={{ fontSize: 10.5, color: '#fff' }}>{paused ? t('PAUSED TODAY') : t('TODAY')}</T>
          </View>}
        </View>
      ))}
    </View>
  );
}

export function openText(o: OpenState | string, hoursText?: string | null, t: TFn = EN) {
  const state = typeof o === 'string' ? o : o.state;
  if (state === 'open') return { tone: 'open' as Tone, text: typeof o === 'object' && o.state === 'open' ? (o.until === '23:59' ? t('Open 24/7') : t('Open · closes {time}', { time: o.until })) : t('Open now') };
  if (state === 'closed') return { tone: 'closed' as Tone, text: typeof o === 'object' && o.state === 'closed' && o.next ? t('Closed · opens {time}', { time: o.next.time }) : t('Closed now') };
  return { tone: 'missing' as Tone, text: hoursText ? hoursText : t('Hours not published') };
}

export function turnIcon(turn: Turn): IconName {
  if (turn === 'arrive') return 'flagEnd';
  if (turn.includes('slight left')) return 'slightLeft';
  if (turn.includes('slight right')) return 'slightRight';
  if (turn.includes('left')) return 'turnLeft';
  if (turn.includes('right')) return 'turnRight';
  return 'arrowUp';
}

export function ManeuverIcon({ turn, size = 40, crossing, stairs, bg = color.green }: { turn: Turn; size?: number; crossing?: boolean; stairs?: boolean; bg?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={stairs ? 'stairs' : crossing ? 'crossing' : turnIcon(turn)} size={size * 0.6} stroke="#fff" width={2.6} />
    </View>
  );
}

export const fmtDate = (iso: string | null | undefined, lang: Lang = 'en') => (iso ? new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar-MA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : null);
export const timeAgo = (iso: string, t: TFn = EN) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : t('{n} h ago', { n: Math.round(m / 60) });
};
