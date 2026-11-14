import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { api, ApiError } from '../api/client';
import type { Position, Route, RouteMode, Step } from '../api/types';
import { distance, lineLength, pointAlong, snapToLine } from '../ar/geo';
import { DEMO_POSITION, useApp, useLocation } from './app';

export type Destination = { placeId: string; name: string; coordinates: Position; category?: string };
export type NavStatus = 'idle' | 'loading' | 'preview' | 'active' | 'arrived' | 'error';
export type Progress = {
  stepIndex: number;          // index of the NEXT maneuver in route.steps
  toNext: number;             // metres to that maneuver
  remaining: number;          // metres to the destination
  remainingS: number;
  off: number;                // metres away from the route line
  along: number;
  snapped: Position | null;
};

type Ctx = {
  dest: Destination | null; mode: RouteMode; route: Route | null; status: NavStatus; error: string | null;
  progress: Progress; muted: boolean; simulating: boolean; startedFromDemo: boolean;
  preview: (d: Destination, mode?: RouteMode) => Promise<void>;
  setMode: (m: RouteMode) => void;
  start: () => void; stop: () => void; setMuted: (m: boolean) => void; toggleSimulate: () => void;
  /** cumulative distance along the route of each step's start */
  stepAlong: number[];
};
const Nav = createContext<Ctx | null>(null);

const SPEED: Record<RouteMode, number> = { walk: 1.3, step_free: 1.05, drive: 6 };
const OFF_ROUTE_M = 25;
const ARRIVE_M = 8;

export function speakable(step: Step | undefined, toNext: number) {
  if (!step) return '';
  if (step.turn === 'arrive') return toNext > 15 ? `In ${Math.round(toNext / 5) * 5} metres, ${step.text.toLowerCase()}` : step.text;
  return toNext > 15 ? `In ${Math.round(toNext / 5) * 5} metres, ${step.text.toLowerCase()}` : step.text;
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { lang } = useApp();
  const [dest, setDest] = useState<Destination | null>(null);
  const [mode, setModeState] = useState<RouteMode>('walk');
  const [route, setRoute] = useState<Route | null>(null);
  const [status, setStatus] = useState<NavStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [startedFromDemo, setStartedFromDemo] = useState(false);
  const offCount = useRef(0);
  const rerouting = useRef(false);
  const spoken = useRef<{ step: number; near: boolean; at: boolean }>({ step: -1, near: false, at: false });
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const from = loc.coord ?? DEMO_POSITION;

  const fetchRoute = useCallback(async (d: Destination, m: RouteMode, origin: Position) => {
    setError(null);
    try {
      const r = await api.route(origin, { placeId: d.placeId }, m);
      setRoute(r);
      return r;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? 'You are offline. Directions need a connection.' : e instanceof Error ? e.message : 'No route found');
      setRoute(null);
      return null;
    }
  }, []);

  const preview = useCallback(async (d: Destination, m: RouteMode = 'walk') => {
    setDest(d); setModeState(m); setStatus('loading');
    setStartedFromDemo(!loc.coord || loc.simulated);
    const r = await fetchRoute(d, m, from);
    setStatus(r ? 'preview' : 'error');
  }, [fetchRoute, from, loc.coord, loc.simulated]);

  const setMode = useCallback((m: RouteMode) => {
    setModeState(m);
    if (dest) { setStatus(s => (s === 'active' ? s : 'loading')); fetchRoute(dest, m, from).then(r => setStatus(s => (r ? (s === 'active' ? 'active' : 'preview') : 'error'))); }
  }, [dest, fetchRoute, from]);

  const stopSim = useCallback(() => { if (simTimer.current) clearInterval(simTimer.current); simTimer.current = null; setSimulating(false); loc.setSimulated(null); }, [loc]);

  const start = useCallback(() => {
    if (!route) return;
    spoken.current = { step: -1, near: false, at: false };
    offCount.current = 0;
    setStatus('active');
    Haptics.selectionAsync().catch(() => {});
    if (!muted) Speech.speak(route.steps[1] ? `${route.steps[0].text}. Then ${route.steps[1].text.toLowerCase()}` : route.steps[0].text, { language: lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar' : 'en-US' });
  }, [route, muted, lang]);

  const stop = useCallback(() => {
    Speech.stop(); stopSim();
    setStatus('idle'); setRoute(null); setDest(null); setError(null);
  }, [stopSim]);

  // where each step starts, measured along the line
  const stepAlong = useMemo(() => (route ? route.steps.map(s => snapToLine(route.geometry.coordinates, s.at).along) : []), [route]);

  const progress = useMemo<Progress>(() => {
    const empty: Progress = { stepIndex: 1, toNext: route?.steps[0]?.distance_m ?? 0, remaining: route?.distance_m ?? 0, remainingS: route?.duration_s ?? 0, off: 0, along: 0, snapped: null };
    if (!route || status !== 'active' || !loc.coord) return empty;
    const line = route.geometry.coordinates;
    const snap = snapToLine(line, loc.coord);
    const total = lineLength(line);
    let next = stepAlong.findIndex((a, i) => i > 0 && a > snap.along + 2);
    if (next < 0) next = route.steps.length - 1;
    const remaining = Math.max(0, total - snap.along);
    return { stepIndex: next, toNext: Math.max(0, stepAlong[next] - snap.along), remaining, remainingS: remaining / SPEED[route.mode], off: snap.off, along: snap.along, snapped: snap.point };
  }, [route, status, loc.coord, stepAlong]);

  // live guidance: speech, haptics, arrival, rerouting
  useEffect(() => {
    if (status !== 'active' || !route || !dest) return;
    const step = route.steps[progress.stepIndex];
    if (spoken.current.step !== progress.stepIndex) spoken.current = { step: progress.stepIndex, near: false, at: false };
    const voice = lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar' : 'en-US';
    if (!spoken.current.near && progress.toNext < 40 && progress.toNext > 12) {
      spoken.current.near = true;
      if (!muted) Speech.speak(speakable(step, progress.toNext), { language: voice });
    }
    if (!spoken.current.at && progress.toNext <= 8) {
      spoken.current.at = true;
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!muted && step?.turn !== 'arrive') Speech.speak(step.text, { language: voice });
    }
    if (progress.remaining < ARRIVE_M) {
      Speech.stop();
      if (!muted) Speech.speak(route.steps.at(-1)?.text ?? 'You have arrived', { language: voice });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      stopSim();
      setStatus('arrived');
      return;
    }
    const reliable = (loc.accuracy ?? 99) < 25;
    if (reliable && progress.off > OFF_ROUTE_M) offCount.current++; else offCount.current = 0;
    if (offCount.current >= 3 && !rerouting.current && loc.coord) {
      rerouting.current = true; offCount.current = 0;
      if (!muted) Speech.speak('Rerouting', { language: voice });
      fetchRoute(dest, route.mode, loc.coord).finally(() => { rerouting.current = false; });
    }
  }, [progress, status, route, dest, muted, lang, loc.accuracy, loc.coord, fetchRoute, stopSim]);

  // walk the demo position along the route (for testing away from campus)
  const toggleSimulate = useCallback(() => {
    if (simTimer.current) { stopSim(); return; }
    if (!route) return;
    const line = route.geometry.coordinates;
    let along = progress.along;
    setSimulating(true);
    simTimer.current = setInterval(() => {
      along += SPEED[route.mode] * 1.6;
      loc.setSimulated(pointAlong(line, along));
      if (along >= lineLength(line)) { if (simTimer.current) clearInterval(simTimer.current); simTimer.current = null; setSimulating(false); }
    }, 1000);
  }, [route, progress.along, loc, stopSim]);
  useEffect(() => () => { if (simTimer.current) clearInterval(simTimer.current); }, []);

  const value = useMemo<Ctx>(() => ({ dest, mode, route, status, error, progress, muted, simulating, startedFromDemo, preview, setMode, start, stop, setMuted, toggleSimulate, stepAlong }),
    [dest, mode, route, status, error, progress, muted, simulating, startedFromDemo, preview, setMode, start, stop, toggleSimulate, stepAlong]);
  return <Nav.Provider value={value}>{children}</Nav.Provider>;
}

export function useNav() {
  const c = useContext(Nav);
  if (!c) throw new Error('useNav outside NavigationProvider');
  return c;
}
export { distance };
