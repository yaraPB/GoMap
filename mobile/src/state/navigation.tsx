import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { speak, stopSpeaking } from '../voice/speak';
import { makeT, type TFn } from '../i18n';
import { speakableStep, trStep } from '../i18n/steps';
import { Platform } from 'react-native';
import { api, ApiError } from '../api/client';
import type { Position, Route, RouteMode, Step } from '../api/types';
import { distance, lineLength, pointAlong, snapToLine } from '../ar/geo';
import { DEMO_POSITION, useApp, useLocation } from './app';

export type Destination = { placeId: string; name: string; coordinates: Position; category?: string };
/** "from the library to building 11": a route that starts at a place, not where the student stands. */
export type Origin = { placeId: string; name: string; coordinates: Position };
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
  /** set when the route starts at a named place */
  origin: Origin | null;
  preview: (d: Destination, mode?: RouteMode, origin?: Origin | null) => Promise<boolean>;
  setMode: (m: RouteMode) => void;
  start: () => void; stop: () => void; setMuted: (m: boolean) => void; toggleSimulate: () => void;
  /** cumulative distance along the route of each step's start */
  stepAlong: number[];
};
const Nav = createContext<Ctx | null>(null);

// simulated walk pace (the ETA itself comes from the server, which counts stairs and crossings)
const SPEED: Record<RouteMode, number> = { walk: 1.25, step_free: 1.0, drive: 5.5 };
const OFF_ROUTE_M = 25;
const ARRIVE_M = 8;

export function speakable(step: Step | undefined, toNext: number, t: TFn = makeT('en')) {
  if (!step) return '';
  return speakableStep(step.text, toNext, t);
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
  const [origin, setOrigin] = useState<Origin | null>(null);
  const originRef = useRef<Origin | null>(null);
  const offCount = useRef(0);
  const lastOffFix = useRef<number | null>(null);
  const rerouting = useRef(false);
  const spoken = useRef<{ step: number; near: boolean; at: boolean }>({ step: -1, near: false, at: false });
  const simTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeRef = useRef<Route | null>(null);
  const demoRef = useRef(false);
  const requestId = useRef(0);

  // Campus-only graph: keep the real blue dot, but clearly label a demo route from the plaza.
  const from = !loc.coord || loc.reason === 'off-campus' ? DEMO_POSITION : loc.coord;

  const fetchRoute = useCallback(async (d: Destination, m: RouteMode, origin: Position, keepOnFailure = false) => {
    const id = ++requestId.current;
    setError(null);
    try {
      const r = await api.route(origin, { placeId: d.placeId }, m);
      if (id !== requestId.current) return undefined;
      routeRef.current = r;
      setRoute(r);
      return r;
    } catch (e) {
      if (id !== requestId.current) return undefined;
      setError(e instanceof ApiError && e.status === 0 ? 'You are offline. Directions need a connection.' : e instanceof Error ? e.message : 'No route found');
      if (!keepOnFailure) { setRoute(null); routeRef.current = null; }
      return null;
    }
  }, []);

  const preview = useCallback(async (d: Destination, m: RouteMode = 'walk', o: Origin | null = null) => {
    setDest(d); setModeState(m); setStatus('loading');
    routeRef.current = null;
    setRoute(null);
    originRef.current = o; setOrigin(o);
    // starting somewhere else: the walk is simulated from there, unless the student is already standing at it
    demoRef.current = o ? !(loc.coord && !loc.simulated && loc.reason !== 'off-campus' && distance(loc.coord, o.coordinates) < 60) : !loc.coord || loc.simulated || loc.reason === 'off-campus';
    setStartedFromDemo(!o && demoRef.current);
    const r = await fetchRoute(d, m, o?.coordinates ?? from);
    if (r !== undefined) setStatus(r ? 'preview' : 'error');
    return !!r;
  }, [fetchRoute, from, loc.coord, loc.simulated, loc.reason]);

  const setMode = useCallback((m: RouteMode) => {
    setModeState(m);
    if (dest) { setStatus(s => (s === 'active' ? s : 'loading')); fetchRoute(dest, m, originRef.current && status !== 'active' ? originRef.current.coordinates : from).then(r => { if (r !== undefined) setStatus(s => (r ? (s === 'active' ? 'active' : 'preview') : 'error')); }); }
  }, [dest, fetchRoute, from, status]);

  const stopSim = useCallback(() => { if (simTimer.current) clearInterval(simTimer.current); simTimer.current = null; setSimulating(false); loc.setSimulated(null); }, [loc]);

  const start = useCallback(() => {
    const current = routeRef.current;
    if (!current) return;
    spoken.current = { step: -1, near: false, at: false };
    offCount.current = 0;
    lastOffFix.current = null;
    if (demoRef.current && (!loc.simulated || originRef.current)) loc.setSimulated(originRef.current?.coordinates ?? DEMO_POSITION);
    setStatus('active');
    Haptics.selectionAsync().catch(() => {});
    if (!muted && current.steps[0]) speak(current.steps[1] ? makeT(lang)('{first}. Then {next}', { first: trStep(current.steps[0].text, makeT(lang)), next: trStep(current.steps[1].text, makeT(lang)).toLowerCase() }) : trStep(current.steps[0].text, makeT(lang)), lang);
  }, [muted, lang, loc]);

  const stop = useCallback(() => {
    stopSpeaking(); stopSim();
    requestId.current++;
    routeRef.current = null;
    setStatus('idle'); setRoute(null); setDest(null); setError(null);
    originRef.current = null; setOrigin(null);
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
    return { stepIndex: next, toNext: Math.max(0, stepAlong[next] - snap.along), remaining, remainingS: total > 0 ? route.duration_s * (remaining / total) : 0, off: snap.off, along: snap.along, snapped: snap.point };
  }, [route, status, loc.coord, stepAlong]);

  // live guidance: speech, haptics, arrival, rerouting
  useEffect(() => {
    if (status !== 'active' || !route || !dest) return;
    const step = route.steps[progress.stepIndex];
    if (spoken.current.step !== progress.stepIndex) spoken.current = { step: progress.stepIndex, near: false, at: false };
    if (!spoken.current.near && progress.toNext < 40 && progress.toNext > 12) {
      spoken.current.near = true;
      if (!muted) speak(speakable(step, progress.toNext, makeT(lang)), lang);
    }
    if (!spoken.current.at && progress.toNext <= 8) {
      spoken.current.at = true;
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!muted && step?.turn !== 'arrive') speak(trStep(step.text, makeT(lang)), lang);
    }
    const reliable = loc.simulated || (loc.timestamp != null && Date.now() - loc.timestamp < 15000 && (loc.accuracy ?? 99) < 25);
    const endpoint = route.geometry.coordinates.at(-1);
    if (reliable && endpoint && loc.coord && progress.remaining < ARRIVE_M && distance(loc.coord, endpoint) < ARRIVE_M) {
      stopSpeaking();
      if (!muted) speak(trStep(route.steps.at(-1)?.text ?? 'You have arrived', makeT(lang)), lang);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      stopSim();
      setStatus('arrived');
      return;
    }
    if (lastOffFix.current !== loc.timestamp) {
      lastOffFix.current = loc.timestamp;
      if (reliable && progress.off > OFF_ROUTE_M) offCount.current++; else offCount.current = 0;
    }
    if (offCount.current >= 3 && !rerouting.current && loc.coord) {
      rerouting.current = true; offCount.current = 0;
      if (!muted) speak(makeT(lang)('Rerouting'), lang);
      fetchRoute(dest, route.mode, loc.coord, true).finally(() => { rerouting.current = false; });
    }
  }, [progress, status, route, dest, muted, lang, loc.accuracy, loc.coord, loc.timestamp, loc.simulated, fetchRoute, stopSim]);

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

  const value = useMemo<Ctx>(() => ({ dest, mode, route, status, error, progress, muted, simulating, startedFromDemo, origin, preview, setMode, start, stop, setMuted, toggleSimulate, stepAlong }),
    [dest, mode, route, status, error, progress, muted, simulating, startedFromDemo, origin, preview, setMode, start, stop, toggleSimulate, stepAlong]);
  return <Nav.Provider value={value}>{children}</Nav.Provider>;
}

export function useNav() {
  const c = useContext(Nav);
  if (!c) throw new Error('useNav outside NavigationProvider');
  return c;
}
export { distance };
