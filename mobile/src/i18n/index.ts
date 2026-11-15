/**
 * Translations. Every UI string is written in English and wrapped in t(): the English text is
 * the key, French and Arabic come from dict.ts. Names (places, people, offices) are not translated.
 * test/i18n.test.ts fails if a wrapped string has no French or Arabic entry.
 *
 * Arabic also flips the layout: the root view gets direction 'rtl' (see app/_layout.tsx), so
 * rows, margins and icons mirror without reloading the app.
 */
import { createContext, useContext, useMemo } from 'react';
import type { Lang } from '../api/types';
import { DICT } from './dict';

export type TFn = (en: string, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): TFn {
  const d = lang === 'en' ? null : DICT[lang];
  return (en, vars) => {
    let s = (d && d[en]) || en;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
    return s;
  };
}

export const LangContext = createContext<Lang>('en');
export const useLang = () => useContext(LangContext);
export function useT() {
  const lang = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}
export const isRTL = (lang: Lang) => lang === 'ar';

export const LOCALE: Record<Lang, string> = { en: 'en-GB', fr: 'fr-FR', ar: 'ar-MA' };

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Short day name in the current language: mon → Mon / lun. / الاثنين */
export function dayName(day: string, lang: Lang, long = false) {
  const i = DAY_KEYS.indexOf(day as typeof DAY_KEYS[number]);
  if (i < 0) return day;
  const ref = new Date(Date.UTC(2024, 0, 1 + i)); // 1 Jan 2024 was a Monday
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: long ? 'long' : 'short', timeZone: 'UTC' }).format(ref);
}

/** Opening hours in the current language, consecutive equal days grouped. */
export function formatHours(hours: Partial<Record<string, [string, string][]>> | null | undefined, lang: Lang, t: TFn): string | null {
  if (!hours) return null;
  const groups: { from: string; to: string; text: string }[] = [];
  for (const d of DAY_KEYS) {
    const r = hours[d];
    if (r === undefined) continue;
    const text = r.length ? r.map(([a, b]) => (a === '00:00' && b === '23:59' ? t('24h') : `${a}–${b}`)).join(', ') : t('closed');
    const last = groups[groups.length - 1];
    if (last && last.text === text && DAY_KEYS.indexOf(last.to as typeof DAY_KEYS[number]) === DAY_KEYS.indexOf(d) - 1) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  if (groups.length === 1 && groups[0].from === 'mon' && groups[0].to === 'sun') return groups[0].text === t('24h') ? t('Open 24/7') : `${t('Every day')} ${groups[0].text}`;
  return groups.map(g => `${dayName(g.from, lang)}${g.to !== g.from ? `–${dayName(g.to, lang)}` : ''} ${g.text}`).join(' · ');
}

/** A date in the current language, e.g. "Fri 20 Nov". */
export const shortDate = (iso: string, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(iso));
export const clock = (iso: string, lang: Lang) => new Intl.DateTimeFormat(LOCALE[lang], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Casablanca' }).format(new Date(iso));
