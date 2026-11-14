import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Closure, CrowdingCollection, PlaceLite, Position, WalkwayCollection } from '../api/types';

export type MapStyle = 'default' | 'satellite' | 'contrast';
export type MapLayers = { threeD: boolean; labels: boolean; cars: boolean; crowding: boolean };

export type MapCommand =
  | { type: 'places'; places: PlaceLite[] }
  | { type: 'filter'; category: string; school: string; fit?: boolean }
  | { type: 'select'; id: string | null; bottom?: number; fly?: boolean; dim?: boolean }
  | { type: 'route'; geometry: { type: 'LineString'; coordinates: Position[] } | null; crossings?: Position[]; dest?: Position | null; fit?: boolean; padding?: { top: number; bottom: number; left: number; right: number } }
  | { type: 'clearRoute' }
  | { type: 'user'; coord: Position | null; heading: number | null }
  | { type: 'follow'; on: boolean }
  | { type: 'locate' }
  | { type: 'reset' }
  | { type: 'walkways'; data: WalkwayCollection }
  | { type: 'crowding'; data: CrowdingCollection; fit?: boolean }
  | { type: 'closures'; list: Closure[] }
  | { type: 'layers'; layers: Partial<MapLayers> }
  | { type: 'style'; style: MapStyle }
  | { type: 'pick'; on: boolean }
  | { type: 'flyIn' }
  | { type: 'camera'; center?: Position; zoom?: number; pitch?: number; bearing?: number };

export type MapEvent =
  | { type: 'ready' } | { type: 'error'; detail: string } | { type: 'select'; detail: string }
  | { type: 'picked'; detail: Position } | { type: 'tapMap'; detail: Position } | { type: 'flyInDone' } | { type: 'followOff' } | { type: 'log'; detail: string };

type Ctx = {
  send: (cmd: MapCommand) => void;
  on: (fn: (e: MapEvent) => void) => () => void;
  ready: boolean;
  error: string | null;
  style: MapStyle; setStyle: (s: MapStyle) => void;
  layers: MapLayers; setLayers: (l: Partial<MapLayers>) => void;
  /** wired by the map view */
  _attach: (post: (msg: string) => void) => void;
  _emit: (e: MapEvent) => void;
};

const MapCtx = createContext<Ctx | null>(null);

export function MapProvider({ children }: { children: React.ReactNode }) {
  const post = useRef<((m: string) => void) | null>(null);
  const queue = useRef<string[]>([]);
  const readyRef = useRef(false);
  const everReady = useRef(false);
  const listeners = useRef(new Set<(e: MapEvent) => void>());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyleState] = useState<MapStyle>('default');
  const [layers, setLayersState] = useState<MapLayers>({ threeD: true, labels: true, cars: false, crowding: false });
  // last value per "sticky" command, replayed after a style switch reloads the page's layers
  const sticky = useRef(new Map<string, string>());

  const send = useCallback((cmd: MapCommand) => {
    const msg = JSON.stringify(cmd);
    if (['places', 'filter', 'walkways', 'closures', 'route', 'layers', 'user', 'crowding'].includes(cmd.type)) sticky.current.set(cmd.type, msg);
    if (cmd.type === 'clearRoute') sticky.current.delete('route');
    if (readyRef.current && post.current) post.current(msg); else queue.current.push(msg);
  }, []);

  const value = useMemo<Ctx>(() => ({
    send,
    on: fn => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; },
    ready, error, style, layers,
    setStyle: s => { setStyleState(s); readyRef.current = false; setReady(false); send({ type: 'style', style: s }); },
    setLayers: l => { setLayersState(prev => ({ ...prev, ...l })); send({ type: 'layers', layers: l }); },
    _attach: p => { post.current = p; },
    _emit: e => {
      if (e.type === 'ready') {
        // after a style change the page rebuilt its layers: replay the current state first
        const replay = everReady.current ? [...sticky.current.values()] : [];
        everReady.current = true;
        readyRef.current = true; setReady(true); setError(null);
        for (const m of [...replay, ...queue.current]) post.current?.(m);
        queue.current = [];
      }
      if (e.type === 'error') setError(e.detail);
      if (e.type === 'log' && __DEV__) console.log('[map]', e.detail);
      listeners.current.forEach(fn => fn(e));
    },
  }), [send, ready, error, style, layers]);

  return <MapCtx.Provider value={value}>{children}</MapCtx.Provider>;
}

export function useMap() {
  const c = useContext(MapCtx);
  if (!c) throw new Error('useMap outside MapProvider');
  return c;
}

export function useMapEvent(handler: (e: MapEvent) => void) {
  const { on } = useMap();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => on(e => ref.current(e)), [on]);
}
