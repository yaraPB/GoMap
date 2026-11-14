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

const CAL_DAYS: [keyof Hours, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const STANDARD_DAY: [string, string][] = [['09:00', '13:00'], ['14:00', '17:30']];

/**
 * Week calendar for office hours: drag over the grid to paint hours, drag over painted hours to
 * erase them. Click a day name to switch between "not published" and "closed". Lunch is shaded.
 */
export function WeekCalendar({ value, onChange, lunch, from = 7, to = 21, step = 30 }: {
  value: Hours | null; onChange: (h: Hours | null) => void; lunch?: [string, string]; from?: number; to?: number; step?: number;
}) {
  const slots = Array.from({ length: ((to - from) * 60) / step }, (_, i) => from * 60 + i * step);
  const [drag, setDrag] = useState<{ d0: number; s0: number; d1: number; s1: number; paint: boolean } | null>(null);
  const h = value ?? {};
  const painted = (d: keyof Hours, m: number) => (h[d] ?? []).some(([a, b]) => m >= toMin(a) && m < toMin(b));
  const inDrag = (di: number, si: number) => !!drag && di >= Math.min(drag.d0, drag.d1) && di <= Math.max(drag.d0, drag.d1) && si >= Math.min(drag.s0, drag.s1) && si <= Math.max(drag.s0, drag.s1);
  const shown = (di: number, si: number) => (inDrag(di, si) ? drag!.paint : painted(CAL_DAYS[di][0], slots[si]));

  const commit = () => {
    if (!drag) return;
    const next: Hours = { ...h };
    CAL_DAYS.forEach(([d], di) => {
      if (di < Math.min(drag.d0, drag.d1) || di > Math.max(drag.d0, drag.d1)) return;
      // minutes outside the visible window are kept; the rest is rebuilt slot by slot
      const ranges: [string, string][] = (h[d] ?? []).filter(([a, b]) => toMin(b) <= from * 60 || toMin(a) >= to * 60);
      let start: number | null = null;
      slots.forEach((m, si) => {
        const on = shown(di, si);
        if (on && start === null) start = m;
        const last = si === slots.length - 1;
        if ((!on || last) && start !== null) { ranges.push([toTime(start), toTime(on ? m + step : m)]); start = null; }
      });
      next[d] = ranges.sort((a, b) => a[0].localeCompare(b[0]));
    });
    onChange(next);
    setDrag(null);
  };
  const cycleDay = (d: keyof Hours) => {
    const next = { ...h };
    if (next[d] === undefined) next[d] = [];
    else delete next[d];
    onChange(Object.keys(next).length ? next : null);
  };
  const lunchFrom = lunch ? toMin(lunch[0]) : -1, lunchTo = lunch ? toMin(lunch[1]) : -1;
  const dayMin = (d: keyof Hours) => (h[d] ?? []).reduce((x, [a, b]) => x + toMin(b) - toMin(a), 0);
  const total = CAL_DAYS.reduce((s, [d]) => s + dayMin(d), 0);

  return (
    <div className="cal-wrap">
      <div className="cal" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }} onMouseLeave={commit} onMouseUp={commit} role="grid" aria-label="Weekly hours: drag to paint or erase">
        <div />
        {CAL_DAYS.map(([d, name]) => (
          <button key={d} type="button" className={`cal-day ${h[d] === undefined ? 'unpub' : !h[d]!.length ? 'closed' : ''}`} onClick={() => cycleDay(d)}
            title="Switch between not published and closed">
            {name}<small>{h[d] === undefined ? 'not published' : !h[d]!.length ? 'closed' : `${Math.round(dayMin(d) / 6) / 10} h`}</small>
          </button>
        ))}
        {slots.map((m, si) => (
          <div key={m} style={{ display: 'contents' }}>
            <div className="cal-time">{m % 60 === 0 ? toTime(m) : ''}</div>
            {CAL_DAYS.map(([d], di) => (
              <div key={d} role="gridcell" aria-selected={shown(di, si)}
                className={`cal-cell ${shown(di, si) ? 'on' : ''} ${m >= lunchFrom && m < lunchTo ? 'lunch' : ''} ${h[d] === undefined ? 'unpub' : ''} ${m % 60 === 0 ? 'hr' : ''}`}
                onMouseDown={e => { e.preventDefault(); setDrag({ d0: di, s0: si, d1: di, s1: si, paint: !painted(d, m) }); }}
                onMouseEnter={() => { if (drag) setDrag({ ...drag, d1: di, s1: si }); }} />
            ))}
          </div>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <span className="pill">{Math.round(total / 6) / 10} h per week</span>
        {lunch && <span className="pill busy">Lunch {lunch[0]}–{lunch[1]} shaded</span>}
        <button type="button" className="btn sm" onClick={() => onChange({ mon: STANDARD_DAY, tue: STANDARD_DAY, wed: STANDARD_DAY, thu: STANDARD_DAY, fri: STANDARD_DAY, sat: [], sun: [] })}>Standard office week</button>
        <button type="button" className="btn sm" onClick={() => onChange(null)}>Clear (not published)</button>
      </div>
    </div>
  );
}

/** Calendar or day-by-day list over the same value. */
export function HoursField({ value, onChange, lunch }: { value: Hours | null; onChange: (h: Hours | null) => void; lunch?: [string, string] }) {
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="toolbar">
        <button type="button" className={`btn sm ${mode === 'calendar' ? 'dark' : ''}`} onClick={() => setMode('calendar')}>Calendar</button>
        <button type="button" className={`btn sm ${mode === 'list' ? 'dark' : ''}`} onClick={() => setMode('list')}>Day by day</button>
      </div>
      {mode === 'calendar' ? <WeekCalendar value={value} onChange={onChange} lunch={lunch} /> : <HoursEditor value={value} onChange={onChange} />}
    </div>
  );
}
