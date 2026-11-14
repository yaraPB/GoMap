import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN, type Hours } from './api';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    fn().then(d => { setData(d); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'miss' | 'info' | 'ok'; children: React.ReactNode }) {
  return <div className={`notice ${tone === 'warn' ? '' : tone}`} role={tone === 'miss' ? 'alert' : 'status'}>{children}</div>;
}

const DAYS: [keyof Hours, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

/**
 * Day-by-day hours. Three states per day, because the app treats them differently:
 * not published (key missing), no hours (empty list), or time ranges.
 */
export function HoursEditor({ value, onChange }: { value: Hours | null; onChange: (h: Hours | null) => void }) {
  const h = value ?? {};
  const set = (day: keyof Hours, ranges: [string, string][] | undefined) => {
    const next = { ...h };
    if (ranges === undefined) delete next[day]; else next[day] = ranges;
    onChange(Object.keys(next).length ? next : null);
  };
  return (
    <div className="hours">
      {DAYS.map(([d, name]) => {
        const v = h[d];
        const mode = v === undefined ? 'unpublished' : v.length ? 'hours' : 'none';
        return (
          <div key={d} style={{ display: 'contents' }}>
            <b style={{ fontSize: 13 }}>{name}</b>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {mode === 'hours' && v!.map(([a, b], i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <input className="i" type="time" value={a} aria-label={`${name} start ${i + 1}`} style={{ width: 110 }} onChange={e => set(d, v!.map((r, k) => (k === i ? [e.target.value, r[1]] : r)))} />
                  –
                  <input className="i" type="time" value={b} aria-label={`${name} end ${i + 1}`} style={{ width: 110 }} onChange={e => set(d, v!.map((r, k) => (k === i ? [r[0], e.target.value] : r)))} />
                  <button className="btn sm" aria-label="Remove this range" onClick={() => set(d, v!.filter((_, k) => k !== i))}>✕</button>
                </span>
              ))}
              {mode === 'none' && <span className="pill">No office hours</span>}
              {mode === 'unpublished' && <span className="pill miss">Not published</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" onClick={() => set(d, [...(v ?? []), ['09:00', '11:00']])}>+ range</button>
              {mode !== 'none' && <button className="btn sm" title="Publishes “no office hours” for this day" onClick={() => set(d, [])}>None</button>}
              {mode !== 'unpublished' && <button className="btn sm" title="Back to “not published”" onClick={() => set(d, undefined)}>Unset</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Mapbox map with draggable pins (place position, entrances) and optional background pins. */
export function PinMap({ center, pins, background = [], onMove, zoom = 17.3, height = 320 }: {
  center: [number, number];
  pins: { id: string; coord: [number, number]; color: string; label: string; draggable?: boolean }[];
  background?: { coord: [number, number]; color: string }[];
  onMove?: (id: string, coord: [number, number]) => void; zoom?: number; height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  useEffect(() => {
    if (!el.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({ container: el.current, style: 'mapbox://styles/mapbox/standard', center, zoom, pitch: 30, config: { basemap: { showPointOfInterestLabels: false, showAdminBoundaries: false } } });
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
    return () => { map.current?.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { map.current?.easeTo({ center, duration: 400 }); }, [center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach(m => m.remove());
    markers.current = [
      ...background.map(b => new mapboxgl.Marker({ color: b.color, scale: 0.5 }).setLngLat(b.coord).addTo(map.current!)),
      ...pins.map(p => {
        const m = new mapboxgl.Marker({ color: p.color, draggable: !!p.draggable }).setLngLat(p.coord).setPopup(new mapboxgl.Popup({ offset: 24 }).setText(p.label)).addTo(map.current!);
        m.on('dragend', () => { const c = m.getLngLat(); moveRef.current?.(p.id, [Number(c.lng.toFixed(7)), Number(c.lat.toFixed(7))]); });
        return m;
      }),
    ];
  }, [JSON.stringify(pins), background.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!MAPBOX_TOKEN) return <Notice>Set VITE_MAPBOX_TOKEN in admin/.env.local (or EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env.local) to see the map.</Notice>;
  return <div ref={el} className="map" style={{ height }} role="application" aria-label="Map: drag the pins to move them" />;
}

export function Tags({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t && !value.includes(t)) onChange([...value, t]); setDraft(''); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="chips">{value.map(v => <span key={v} className="chip">{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter(x => x !== v))}>✕</button></span>)}</div>
      <input className="i" value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}
