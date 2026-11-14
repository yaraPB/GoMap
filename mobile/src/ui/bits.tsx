import React from 'react';
import { View } from 'react-native';
import type { Availability, Day, Hours, OpenState, Person, Turn } from '../api/types';
import { Icon, T, type Tone } from './kit';
import { color, type IconName } from './theme';

export function availabilityTone(a: Availability): Tone {
  return a.state === 'in' || a.state === 'open' ? 'open' : a.state === 'busy' ? 'busy' : a.state === 'not_published' ? 'missing' : 'closed';
}
export function availabilityText(a: Availability) {
  return a.detail ? `${a.label} · ${a.detail}` : a.label;
}
/** The short status in the office list (board 08). */
export function shortStatus(p: Person): { tone: Tone; text: string } {
  const a = p.availability;
  if (a.state === 'in') return { tone: 'open', text: 'In now' };
  if (a.state === 'busy') return { tone: 'busy', text: p.presence?.reason === 'teaching' ? 'Teaching' : p.presence?.reason === 'meeting' ? 'In a meeting' : 'Busy' };
  if (a.state === 'out') return { tone: 'closed', text: 'Not in today' };
  if (a.state === 'open') return { tone: 'open', text: 'Open now' };
  if (a.state === 'closed') return { tone: 'closed', text: 'Closed' };
  return { tone: 'missing', text: 'No hours' };
}

const DAY_NAMES: [Day, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday']];
export function todayKey(): Day {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', weekday: 'short' }).format(new Date()).toLowerCase().slice(0, 3);
  return d as Day;
}

/** Weekly hours, with today marked; "paused today" when an override sits on top (board 10). */
export function HoursTable({ hours, paused }: { hours: Hours | null; paused?: boolean }) {
  const today = todayKey();
  const weekend = hours?.sat !== undefined || hours?.sun !== undefined ? (hours.sat?.length || hours.sun?.length ? 'See hours' : 'Closed') : 'Not published';
  const rows: [string, string, boolean][] = DAY_NAMES.map(([k, name]) => {
    const v = hours?.[k];
    return [name, v === undefined ? 'No office hours' : v.length ? v.map(([a, b]) => `${a.replace(/^0/, '')}–${b}`).join(' · ') : 'No office hours', k === today];
  });
  rows.push(['Weekend', weekend, today === 'sat' || today === 'sun']);
  return (
    <View style={{ borderWidth: 1, borderColor: '#EBEBE7', borderRadius: 14, overflow: 'hidden' }}>
      {rows.map(([day, slot, now], i) => (
        <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: now ? '#FFFBF2' : '#fff', borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: '#F1F1EE' }}>
          <T weight="semibold" style={{ width: 86, fontSize: 13.5 }}>{day}</T>
          <T style={{ flex: 1, fontSize: 13.5, color: color.ink2 }}>{slot}</T>
          {now && <View style={{ height: 21, paddingHorizontal: 8, borderRadius: 999, justifyContent: 'center', backgroundColor: paused ? '#8A5A00' : color.greenDeep }}>
            <T weight="bold" style={{ fontSize: 10.5, color: '#fff' }}>{paused ? 'PAUSED TODAY' : 'TODAY'}</T>
          </View>}
        </View>
      ))}
    </View>
  );
}

export function openText(o: OpenState | string, hoursText?: string | null) {
  const state = typeof o === 'string' ? o : o.state;
  if (state === 'open') return { tone: 'open' as Tone, text: typeof o === 'object' && o.state === 'open' ? `Open · closes ${o.until}` : 'Open now' };
  if (state === 'closed') return { tone: 'closed' as Tone, text: typeof o === 'object' && o.state === 'closed' && o.next ? `Closed · opens ${o.next.time}` : 'Closed now' };
  return { tone: 'missing' as Tone, text: hoursText ? hoursText : 'Hours not published' };
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

export const fmtDate = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : null);
export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : `${Math.round(m / 60)} hour${m >= 120 ? 's' : ''} ago`;
};
