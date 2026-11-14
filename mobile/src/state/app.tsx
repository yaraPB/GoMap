import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { setApiUser } from '../api/client';
import type { Lang, MockUser, Position } from '../api/types';
import { createHeadingFilter, distance } from '../ar/geo';
import { CAMPUS_CENTER } from '../map/mapHtml';

/** Mock accounts until GoCampus SSO. TODO: replace with GoCampus SSO */
export const USERS: MockUser[] = [
  { id: 'demo-student', name: 'Demo Student', role: 'student' },
  { id: 'harit-satt', name: 'Harit Satt', role: 'faculty' },
  { id: 'demo-admin', name: 'Campus Admin', role: 'admin' },
  { id: 'guest', name: 'Visitor', role: 'guest' },
];

type AppCtx = {
  lang: Lang; setLang: (l: Lang) => void;
  user: MockUser; setUser: (u: MockUser) => void;
  online: boolean;
  reduceMotion: boolean;
  firstSession: boolean; finishOnboarding: () => void;
};
const App = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const [user, setUserState] = useState<MockUser>(USERS[0]);
  const [online, setOnline] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [firstSession, setFirstSession] = useState(true);
  useEffect(() => NetInfo.addEventListener(s => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);
  const setUser = useCallback((u: MockUser) => { setApiUser(u.id); setUserState(u); }, []);
  const value = useMemo(() => ({ lang, setLang, user, setUser, online, reduceMotion, firstSession, finishOnboarding: () => setFirstSession(false) }), [lang, user, online, reduceMotion, firstSession, setUser]);
  return <App.Provider value={value}>{children}</App.Provider>;
}
export function useApp() {
  const c = useContext(App);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

// ── location ─────────────────────────────────────────────────────────────────

export type Fix = {
  coord: Position | null;
  accuracy: number | null;      // metres
  timestamp: number | null;     // time of the actual location fix
  heading: number | null;       // smoothed, true north
  rawHeading: number | null;
  headingAccuracy: number | null;
  permission: 'unknown' | 'granted' | 'denied';
  /** true only when a simulated walk is active */
  simulated: boolean;
  reason: 'off-campus' | 'no-permission' | 'walk' | null;
};
type LocCtx = Fix & { request: () => Promise<void>; setSimulated: (p: Position | null) => void };
const Loc = createContext<LocCtx | null>(null);

const DEMO_POSITION: Position = [-5.10655, 33.53925]; // main plaza, by the library
const OFF_CAMPUS_M = 2000;

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [real, setReal] = useState<{ coord: Position; accuracy: number | null; timestamp: number } | null>(null);
  const [permission, setPermission] = useState<Fix['permission']>('unknown');
  const [heading, setHeading] = useState<{ smooth: number; raw: number; acc: number | null } | null>(null);
  const [walk, setWalk] = useState<Position | null>(null);
  const filter = useRef(createHeadingFilter(0.15));
  const subs = useRef<{ remove: () => void }[]>([]);

  const start = useCallback(async () => {
    subs.current.forEach(s => s.remove());
    subs.current = [];
    try {
      const pos = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
        u => setReal(previous => previous && u.timestamp < previous.timestamp ? previous : { coord: [u.coords.longitude, u.coords.latitude], accuracy: u.coords.accuracy ?? null, timestamp: u.timestamp }));
      subs.current.push(pos);
      if (Platform.OS !== 'web') {
        const head = await Location.watchHeadingAsync(h => {
          const raw = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (!Number.isFinite(raw) || raw < 0) return;
          setHeading({ smooth: filter.current(raw), raw, acc: h.accuracy ?? null });
        });
        subs.current.push(head);
      }
    } catch { /* location services off */ }
  }, []);

  const request = useCallback(async () => {
    const r = await Location.requestForegroundPermissionsAsync().catch(() => null);
    const granted = r?.status === 'granted';
    setPermission(granted ? 'granted' : 'denied');
    if (granted) await start();
  }, [start]);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(r => {
      if (r.status === 'granted') { setPermission('granted'); start(); } else request();
    }).catch(() => setPermission('denied'));
    return () => subs.current.forEach(s => s.remove());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<LocCtx>(() => {
    const offCampus = real ? distance(real.coord, CAMPUS_CENTER) > OFF_CAMPUS_M : false;
    let coord: Position | null = real?.coord ?? null;
    let simulated = false;
    let reason: Fix['reason'] = null;
    if (walk) { coord = walk; simulated = true; reason = 'walk'; }
    else if (offCampus) { reason = 'off-campus'; }
    else if (permission === 'denied') { coord = null; reason = 'no-permission'; }
    return {
      coord, accuracy: simulated ? 4 : real?.accuracy ?? null, timestamp: simulated ? Date.now() : real?.timestamp ?? null,
      heading: heading?.smooth ?? null, rawHeading: heading?.raw ?? null, headingAccuracy: heading?.acc ?? null,
      permission, simulated, reason, request, setSimulated: setWalk,
    };
  }, [real, heading, permission, walk, request]);
  return <Loc.Provider value={value}>{children}</Loc.Provider>;
}
export function useLocation() {
  const c = useContext(Loc);
  if (!c) throw new Error('useLocation outside LocationProvider');
  return c;
}
export { DEMO_POSITION };
