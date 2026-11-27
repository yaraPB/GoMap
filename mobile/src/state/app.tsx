import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Linking, Platform, View } from 'react-native';
import { LangContext, isRTL } from '../i18n';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { api, ApiError, setApiSession, setApiUser } from '../api/client';
import { loadSession, saveSession } from '../auth/session';
import type { Lang, MockUser, Position, SignedInUser } from '../api/types';
import { createHeadingFilter, distance } from '../ar/geo';
import { CAMPUS_CENTER } from '../map/mapHtml';
import { snapToNetwork, WalkFilter } from '../location/kalman';
import { useWalkways } from '../api/hooks';

/** Who you are before signing in: the student view (visitors see the same map). Signed in, the account replaces it. */
export const USERS: MockUser[] = [
  { id: 'demo-student', name: 'Student', role: 'student' },
  { id: 'harit-satt', name: 'Harit Satt', role: 'faculty', person_id: 'harit-satt' },
  { id: 'demo-staff', name: 'Staff', role: 'staff' },
  { id: 'guest', name: 'Visitor', role: 'guest' },
];

type AppCtx = {
  lang: Lang; setLang: (l: Lang) => void;
  user: MockUser;
  online: boolean;
  reduceMotion: boolean;
  firstSession: boolean; finishOnboarding: () => void;
  /** Email + password sign-in: who you really are. Null when not signed in. */
  signedIn: SignedInUser | null;
  signIn: (token: string, user: SignedInUser) => Promise<void>;
  signOut: () => Promise<void>;
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
  const [signedIn, setSignedIn] = useState<SignedInUser | null>(null);
  const asUser = (u: SignedInUser): MockUser => ({ id: u.person_id ?? u.id, name: u.name, role: u.role, person_id: u.person_id, email: u.email });
  const signIn = useCallback(async (token: string, u: SignedInUser) => {
    await saveSession(token); setApiSession(token); setSignedIn(u); setUserState(asUser(u));
  }, []);
  const signOut = useCallback(async () => {
    await saveSession(null); setApiSession(null); setSignedIn(null); setApiUser(USERS[0].id); setUserState(USERS[0]);
  }, []);
  // a session from last time: check it is still valid and pick up the current role
  useEffect(() => {
    void loadSession().then(async token => {
      if (!token) return;
      setApiSession(token);
      try { const u = await api.me(); setSignedIn(u); setUserState(asUser(u)); }
      catch (e) { if (e instanceof ApiError && e.status === 401) { await saveSession(null); setApiSession(null); } }
    });
  }, []);
  const value = useMemo(() => ({ lang, setLang, user, online, reduceMotion, firstSession, finishOnboarding: () => setFirstSession(false), signedIn, signIn, signOut }), [lang, user, online, reduceMotion, firstSession, signedIn, signIn, signOut]);
  // Arabic mirrors the whole layout from here down (Yoga 'direction' is inherited), no reload needed
  return (
    <App.Provider value={value}>
      <LangContext.Provider value={lang}>
        <View style={{ flex: 1, direction: isRTL(lang) ? 'rtl' : 'ltr' }}>{children}</View>
      </LangContext.Provider>
    </App.Provider>
  );
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
  /** the system will not show its dialog again (refused before): only the phone's settings can turn location on */
  blocked: boolean;
  /** a browser on a plain http:// network address never allows location (only localhost or https) */
  insecureWeb: boolean;
  /** true only when a simulated walk is active */
  simulated: boolean;
  reason: 'off-campus' | 'no-permission' | 'imprecise' | 'walk' | null;
  /** the fix as the phone reported it, before smoothing and snapping */
  rawCoord: Position | null;
  /** the phone's own filtered position, even while a walk is simulated; null before the first fix */
  realCoord: Position | null;
  /** that real position is on (or near) campus, so routes can start from it */
  realOnCampus: boolean;
  rawAccuracy: number | null;
  /** walking speed (m/s) and direction of travel from the filter; course is null when standing */
  speed: number;
  course: number | null;
  onPath: boolean;
};
type LocCtx = Fix & { request: () => Promise<void>; setSimulated: (p: Position | null) => void };
const Loc = createContext<LocCtx | null>(null);

const DEMO_POSITION: Position = [-5.10655, 33.53925]; // main plaza, by the library
const OFF_CAMPUS_M = 2000;
/** Worse than this, a fix is a guess (a computer's browser locates by Wi-Fi or IP, often hundreds of metres off):
 * it is not drawn as "you are here" and routes do not start from it. Phone GPS is a few metres. */
const IMPRECISE_M = 150;

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [real, setReal] = useState<{ coord: Position; accuracy: number | null; timestamp: number; raw: Position; rawAccuracy: number | null; speed: number; course: number | null; onPath: boolean } | null>(null);
  const filterRef = useRef(new WalkFilter());
  const walkways = useWalkways();
  const lines = useRef<Position[][]>([]);
  useEffect(() => { lines.current = (walkways.data?.features ?? []).filter(f => f.properties.modes !== 'drive').map(f => f.geometry.coordinates); }, [walkways.data]);
  const [permission, setPermission] = useState<Fix['permission']>('unknown');
  const [heading, setHeading] = useState<{ smooth: number; raw: number; acc: number | null } | null>(null);
  const [walk, setWalk] = useState<Position | null>(null);
  const filter = useRef(createHeadingFilter(0.15));
  const subs = useRef<{ remove: () => void }[]>([]);

  const start = useCallback(async () => {
    subs.current.forEach(s => s.remove());
    subs.current = [];
    try {
      // Android: ask for high-accuracy mode (GPS + Wi-Fi), otherwise fixes can be 50–100 m off
      if (Platform.OS === 'android') await Location.enableNetworkProviderAsync().catch(() => {});
      // show something at once, then refine
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 50 }).catch(() => null);
      let lastT = 0;
      const onFix = (u: Location.LocationObject) => {
        if (u.timestamp <= lastT) return;
        lastT = u.timestamp;
        const raw: Position = [u.coords.longitude, u.coords.latitude];
        const f = filterRef.current.update(raw, u.coords.accuracy ?? null, u.timestamp);
        // on campus, people are on paths: pull the dot onto the nearest walkway when it is close
        const snap = f.accuracy < 30 ? snapToNetwork(f.coord, lines.current, Math.min(8, Math.max(4, f.accuracy * 0.8))) : null;
        setReal({ coord: snap?.coord ?? f.coord, accuracy: Math.round(Math.min(f.accuracy, u.coords.accuracy ?? f.accuracy) * 10) / 10, timestamp: u.timestamp, raw, rawAccuracy: u.coords.accuracy ?? null, speed: f.speed, course: f.course, onPath: !!snap });
      };
      if (lastKnown) onFix(lastKnown);
      const pos = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000, mayShowUserSettingsDialog: true }, onFix);
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

  const [blocked, setBlocked] = useState(false);
  const insecureWeb = Platform.OS === 'web' && typeof window !== 'undefined' && window.isSecureContext === false;
  const started = useRef(false);
  const run = useCallback(async () => { started.current = true; await start(); }, [start]);

  /** Ask for location. Refused before, the system no longer shows its dialog: open the app's settings page instead. */
  const request = useCallback(async () => {
    const before = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (before && before.status !== 'granted' && !before.canAskAgain && Platform.OS !== 'web') {
      setBlocked(true);
      await Linking.openSettings().catch(() => {});
      return; // checked again when the student comes back to the app
    }
    const r = await Location.requestForegroundPermissionsAsync().catch(() => null);
    const granted = r?.status === 'granted';
    setPermission(granted ? 'granted' : 'denied');
    setBlocked(!granted && !!r && !r.canAskAgain);
    if (granted) await run();
  }, [run]);

  // back from the settings page (or the system dialog): pick up a permission granted there
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      Location.getForegroundPermissionsAsync().then(r => {
        if (r.status === 'granted') { setPermission('granted'); setBlocked(false); if (!started.current) run(); }
      }).catch(() => {});
    });
    return () => sub.remove();
  }, [run]);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(r => {
      if (r.status === 'granted') { setPermission('granted'); run(); }
      else if (!r.canAskAgain && Platform.OS !== 'web') { setPermission('denied'); setBlocked(true); } // no dialog to show: the banner offers settings
      else request();
    }).catch(() => setPermission('denied'));
    return () => subs.current.forEach(s => s.remove());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<LocCtx>(() => {
    const imprecise = !!real && (real.rawAccuracy ?? real.accuracy ?? 0) > IMPRECISE_M;
    const offCampus = real && !imprecise ? distance(real.coord, CAMPUS_CENTER) > OFF_CAMPUS_M : false;
    let coord: Position | null = real?.coord ?? null;
    let simulated = false;
    let reason: Fix['reason'] = null;
    if (walk) { coord = walk; simulated = true; reason = 'walk'; }
    else if (imprecise) { coord = null; reason = 'imprecise'; }
    else if (offCampus) { reason = 'off-campus'; }
    else if (permission === 'denied') { coord = null; reason = 'no-permission'; }
    return {
      coord, accuracy: simulated ? 4 : real?.accuracy ?? null, timestamp: simulated ? Date.now() : real?.timestamp ?? null,
      heading: heading?.smooth ?? null, rawHeading: heading?.raw ?? null, headingAccuracy: heading?.acc ?? null,
      permission, blocked, insecureWeb, simulated, reason, request, setSimulated: setWalk,
      realCoord: real?.coord ?? null, realOnCampus: !!real && !offCampus && !imprecise,
      rawCoord: real?.raw ?? null, rawAccuracy: real?.rawAccuracy ?? null, speed: simulated ? 1.25 : real?.speed ?? 0, course: simulated ? null : real?.course ?? null, onPath: simulated || !!real?.onPath,
    };
  }, [real, heading, permission, blocked, insecureWeb, walk, request]);
  return <Loc.Provider value={value}>{children}</Loc.Provider>;
}
export function useLocation() {
  const c = useContext(Loc);
  if (!c) throw new Error('useLocation outside LocationProvider');
  return c;
}
export { DEMO_POSITION, IMPRECISE_M, OFF_CAMPUS_M };
