import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Clock, Copy, Map as MapIcon, PenLine, Satellite, Trash2, X } from 'lucide-react';
import { MAPBOX_TOKEN, type Hours } from './api';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MIN_ZOOM, CAMPUS_OUTLINE } from './campusOutline';

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

/** Closes when clicking outside `ref`. */
function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    setTimeout(() => document.addEventListener('pointerdown', h), 0);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('pointerdown', h); document.removeEventListener('keydown', k); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

const DAYS: [keyof Hours, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(Math.max(0, Math.min(1439, m)) / 60)).padStart(2, '0')}:${String(Math.max(0, Math.min(1439, m)) % 60).padStart(2, '0')}`;
const STANDARD_DAY: [string, string][] = [['09:00', '13:00'], ['14:00', '17:30']];

/** Sort and merge touching/overlapping ranges. */
function normalise(ranges: [string, string][]): [string, string][] {
  const r = ranges.map(([a, b]) => [toMin(a), toMin(b)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const x of r) { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([...x]); }
  return out.map(([a, b]) => [toTime(a), toTime(b)]);
}

// ── clock ────────────────────────────────────────────────────────────────────

/**
 * Analog clock face, Material-style 24h: drag the hand round the dial to pick the hour
 * (outer ring 1–12, inner ring 13–00), it then jumps to minutes (5-minute steps, hold Shift for 1).
 */
export function ClockPicker({ value, onChange, presets = [] }: { value: string; onChange: (t: string) => void; presets?: string[] }) {
  const [mode, setMode] = useState<'h' | 'm'>('h');
  const [dragging, setDragging] = useState(false);
  const face = useRef<HTMLDivElement>(null);
  const h = Number(value.slice(0, 2)), m = Number(value.slice(3, 5));
  const R = 118, OUT = 94, IN = 62;
  const pick = (e: React.PointerEvent, commit: boolean) => {
    const rect = face.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - R, y = e.clientY - rect.top - R;
    const ang = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    if (mode === 'h') {
      const idx = Math.round(ang / 30) % 12;
      const inner = Math.hypot(x, y) < (OUT + IN) / 2;
      const hour = inner ? (idx === 0 ? 0 : idx + 12) : (idx === 0 ? 12 : idx);
      onChange(`${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      if (commit) setMode('m');
    } else {
      const step = e.shiftKey ? 1 : 5;
      const min = (Math.round(ang / 6 / step) * step) % 60;
      onChange(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
  };
  // hand target
  const hourInner = h === 0 || h > 12;
  const handAng = mode === 'h' ? ((h % 12) * 30) : m * 6;
  const handLen = mode === 'h' ? (hourInner ? IN : OUT) : OUT;
  const knob = { left: R + Math.sin(handAng * Math.PI / 180) * handLen, top: R - Math.cos(handAng * Math.PI / 180) * handLen };
  const nums = mode === 'h'
    ? [...Array.from({ length: 12 }, (_, i) => ({ v: i === 0 ? 12 : i, r: OUT, a: i * 30 })), ...Array.from({ length: 12 }, (_, i) => ({ v: i === 0 ? 0 : i + 12, r: IN, a: i * 30, inner: true }))]
    : Array.from({ length: 12 }, (_, i) => ({ v: i * 5, r: OUT, a: i * 30 }));
  const isOn = (v: number) => (mode === 'h' ? v === h : v === m);
  return (
    <div className="clock">
      <div className="clock-read" aria-live="polite">
        <button className={mode === 'h' ? 'on' : ''} onClick={() => setMode('h')}>{String(h).padStart(2, '0')}</button>:
        <button className={mode === 'm' ? 'on' : ''} onClick={() => setMode('m')}>{String(m).padStart(2, '0')}</button>
      </div>
      <div ref={face} className="clock-face" role="slider" aria-label={mode === 'h' ? 'Hour' : 'Minutes'} aria-valuetext={value}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); pick(e, false); }}
        onPointerMove={e => { if (dragging) pick(e, false); }}
        onPointerUp={e => { setDragging(false); pick(e, true); }}
        tabIndex={0}
        onKeyDown={e => {
          const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return; e.preventDefault();
          const total = (h * 60 + m + d * (mode === 'h' ? 60 : 5) + 1440) % 1440;
          onChange(toTime(total));
        }}>
        <div className={`clock-hand ${dragging ? 'drag' : ''}`} style={{ height: handLen, marginTop: -handLen, transform: `rotate(${handAng}deg)` }} />
        <div className={`clock-knob ${dragging ? 'drag' : ''}`} style={knob} />
        <div className="clock-center" />
        {nums.map(n => (
          <div key={`${n.v}-${n.r}`} className={`clock-num ${'inner' in n && n.inner ? 'inner' : ''} ${isOn(n.v) && (mode === 'm' || ((n.r === IN) === hourInner)) ? 'on' : ''}`}
            style={{ left: R + Math.sin(n.a * Math.PI / 180) * n.r, top: R - Math.cos(n.a * Math.PI / 180) * n.r }}>
            {mode === 'm' ? String(n.v).padStart(2, '0') : n.v === 0 ? '00' : n.v}
          </div>
        ))}
      </div>
      {!!presets.length && <div className="clock-presets">{presets.map(p => <button key={p} className={`chip ${p === value ? 'on' : ''}`} onClick={() => onChange(p)}>{p}</button>)}</div>}
    </div>
  );
}

/** A time you click to set on the clock face. */
export function TimeField({ value, onChange, label, presets }: { value: string; onChange: (t: string) => void; label?: string; presets?: string[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  useEffect(() => setDraft(value), [value]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: 5 }}>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{label}</span>}
      <button type="button" className="timefield" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}><Clock size={15} />{value}</button>
      {open && (
        <div className="pop" style={{ top: '100%', left: 0, marginTop: 6 }} role="dialog" aria-label={label ?? 'Time'}>
          <ClockPicker value={draft} onChange={setDraft} presets={presets} />
          <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn sm primary" onClick={() => { onChange(draft); setOpen(false); }}>Set {draft}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── week schedule ───────────────────────────────────────────────────────────

type Drag = { kind: 'create' | 'move' | 'top' | 'bottom'; day: number; fromDay: number; idx: number; start: number; end: number; anchor: number; moved: boolean; x: number; y: number };

/**
 * Google-Calendar-style week editor. Drag on empty space to create, drag a block to move it
 * (also to another day), pull its top or bottom edge to resize, click it to set exact times on
 * the clock. Everything snaps to 15 minutes; overlapping blocks merge. Lunch is shaded.
 */
export function ScheduleEditor({ value, onChange, lunch, from = 7, to = 21, snap = 15 }: {
  value: Hours | null; onChange: (h: Hours | null) => void; lunch?: [string, string]; from?: number; to?: number; snap?: number;
}) {
  const HOUR = 34, PPM = HOUR / 60;
  const h = value ?? {};
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [sel, setSel] = useState<{ day: number; idx: number } | null>(null);
  const [edit, setEdit] = useState<{ day: number; idx: number; field: 'start' | 'end' } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useOutside(popRef, () => setEdit(null), !!edit);

  const ranges = (d: number) => (h[DAYS[d][0]] ?? []).map(([a, b]) => [toMin(a), toMin(b)] as [number, number]);
  const minuteAt = (d: number, clientY: number) => {
    const rect = cols.current[d]!.getBoundingClientRect();
    const raw = from * 60 + (clientY - rect.top) / PPM;
    return Math.max(from * 60, Math.min(to * 60, Math.round(raw / snap) * snap));
  };
  const dayAt = (clientX: number, fallback: number) => {
    const i = cols.current.findIndex(c => { if (!c) return false; const r = c.getBoundingClientRect(); return clientX >= r.left && clientX < r.right; });
    return i < 0 ? fallback : i;
  };
  const write = (next: Hours) => onChange(Object.keys(next).length ? next : null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current!;
      const moved = d.moved || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4;
      if (d.kind === 'create') {
        const mm = minuteAt(d.day, e.clientY);
        setDrag({ ...d, moved, start: Math.min(d.anchor, mm), end: Math.max(d.anchor + (mm <= d.anchor ? 0 : 0), mm) });
      } else if (d.kind === 'move') {
        const day = dayAt(e.clientX, d.day);
        const len = d.end - d.start;
        const top = Math.max(from * 60, Math.min(to * 60 - len, minuteAt(day, e.clientY) - d.anchor));
        setDrag({ ...d, moved, day, start: top, end: top + len });
      } else if (d.kind === 'top') {
        setDrag({ ...d, moved, start: Math.min(minuteAt(d.day, e.clientY), d.end - snap) });
      } else {
        setDrag({ ...d, moved, end: Math.max(minuteAt(d.day, e.clientY), d.start + snap) });
      }
    };
    const up = () => {
      const d = dragRef.current!;
      setDrag(null);
      if (!d.moved && d.kind !== 'create') { setSel({ day: d.day, idx: d.idx }); setEdit({ day: d.day, idx: d.idx, field: 'start' }); return; }
      const next: Hours = { ...h };
      let start = d.start, end = d.end;
      if (d.kind === 'create' && end - start < snap) { end = Math.min(to * 60, start + 60); }
      if (d.kind !== 'create') {
        const fromKey = DAYS[d.fromDay][0];
        next[fromKey] = (next[fromKey] ?? []).filter((_, i) => i !== d.idx);
      }
      const key = DAYS[d.day][0];
      next[key] = normalise([...(next[key] ?? []), [toTime(start), toTime(end)]]);
      write(next);
      const idx = (next[key] ?? []).findIndex(([a, b]) => toMin(a) <= start && start < toMin(b));
      setSel({ day: d.day, idx: Math.max(0, idx) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // delete with the keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!sel || edit || !['Delete', 'Backspace'].includes(e.key) || (e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault(); removeBlock(sel.day, sel.idx);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // start scrolled to the working day
  useEffect(() => { if (body.current) body.current.scrollTop = Math.max(0, (8 - from) * HOUR); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeBlock = (d: number, idx: number) => {
    const key = DAYS[d][0];
    write({ ...h, [key]: (h[key] ?? []).filter((_, i) => i !== idx) });
    setSel(null); setEdit(null);
  };
  const setTimes = (d: number, idx: number, a: string, b: string) => {
    const key = DAYS[d][0];
    if (toMin(b) <= toMin(a)) return;
    write({ ...h, [key]: normalise((h[key] ?? []).map((r, i) => (i === idx ? [a, b] as [string, string] : r))) });
  };
  const copyToWeekdays = (d: number) => {
    const src = h[DAYS[d][0]] ?? [];
    const next = { ...h };
    for (const [k] of DAYS.slice(0, 5)) next[k] = src.map(r => [...r] as [string, string]);
    write(next);
  };
  const cycleDay = (d: number) => {
    const key = DAYS[d][0];
    const next = { ...h };
    if (next[key] === undefined) next[key] = []; else if (!next[key]!.length) delete next[key]; else return;
    write(next);
  };

  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const lunchFrom = lunch ? toMin(lunch[0]) : -1, lunchTo = lunch ? toMin(lunch[1]) : -1;
  const total = DAYS.reduce((s, [k]) => s + (h[k] ?? []).reduce((x, [a, b]) => x + toMin(b) - toMin(a), 0), 0);
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7, nowMin = now.getHours() * 60 + now.getMinutes();
  const clash = (a: number, b: number) => lunch && a < lunchTo && b > lunchFrom;
  const fmt = (m: number) => toTime(m);
  const editing = edit ? (h[DAYS[edit.day][0]] ?? [])[edit.idx] : null;

  return (
    <div className="sched" style={{ position: 'relative' }}>
      <div className="sched-head">
        <div />
        {DAYS.map(([k, name], d) => {
          const r = h[k];
          const mins = (r ?? []).reduce((x, [a, b]) => x + toMin(b) - toMin(a), 0);
          return (
            <button key={k} type="button" className={`sched-day ${r === undefined ? 'unpub' : ''} ${d === todayIdx ? 'today' : ''}`} onClick={() => cycleDay(d)}
              title={r?.length ? 'Drag on the column to add hours' : 'Click: not published ↔ closed'}>
              {name.slice(0, 3)}<small>{r === undefined ? 'not published' : !r.length ? 'closed' : `${Math.round(mins / 6) / 10} h`}</small>
            </button>
          );
        })}
      </div>
      <div className="sched-body" ref={body}>
        <div className="sched-times">{hours.map(hr => <div key={hr} className="sched-time">{String(hr).padStart(2, '0')}:00</div>)}</div>
        {DAYS.map(([k], d) => (
          <div key={k} ref={el => { cols.current[d] = el; }} className={`sched-col ${h[k] === undefined ? 'unpub' : ''}`} style={{ height: (to - from) * HOUR }}
            onPointerDown={e => {
              if (e.button !== 0 || (e.target as HTMLElement) !== e.currentTarget) return;
              const mm = minuteAt(d, e.clientY);
              setSel(null); setEdit(null);
              setDrag({ kind: 'create', day: d, fromDay: d, idx: -1, start: mm, end: mm, anchor: mm, moved: false, x: e.clientX, y: e.clientY });
            }}>
            {lunch && <div className="sched-lunch" style={{ top: (lunchFrom - from * 60) * PPM, height: (lunchTo - lunchFrom) * PPM }} />}
            {d === todayIdx && nowMin > from * 60 && nowMin < to * 60 && <div className="sched-now" style={{ top: (nowMin - from * 60) * PPM }} />}
            {ranges(d).map(([a, b], idx) => {
              const hidden = drag && drag.kind !== 'create' && drag.fromDay === d && drag.idx === idx;
              if (hidden) return null;
              return (
                <div key={idx} className={`blk ${clash(a, b) ? 'lunchclash' : ''} ${sel?.day === d && sel.idx === idx ? 'sel' : ''}`}
                  style={{ top: (a - from * 60) * PPM, height: Math.max(14, (b - a) * PPM) }}
                  onPointerDown={e => {
                    e.stopPropagation();
                    const kind = (e.target as HTMLElement).dataset.h as 'top' | 'bottom' | undefined;
                    setDrag({ kind: kind ?? 'move', day: d, fromDay: d, idx, start: a, end: b, anchor: minuteAt(d, e.clientY) - a, moved: false, x: e.clientX, y: e.clientY });
                  }}
                  title={`${fmt(a)}–${fmt(b)} · drag to move, pull an edge to resize, click to edit`}>
                  <div className="h t" data-h="top" />
                  {fmt(a)}–{fmt(b)}
                  <div className="h b" data-h="bottom" />
                </div>
              );
            })}
            {drag && drag.day === d && (
              <div className={`blk ${drag.kind === 'create' ? 'ghost' : 'drag'}`} style={{ top: (drag.start - from * 60) * PPM, height: Math.max(14, (drag.end - drag.start) * PPM) }}>
                {fmt(drag.start)}–{fmt(drag.end)}
              </div>
            )}
          </div>
        ))}
      </div>

      {edit && editing && (
        <div ref={popRef} className="pop" style={edit.day >= 3 ? { top: 70, right: 10 } : { top: 70, left: `calc(${(edit.day + 1) * (100 / 7)}% + 40px)` }} role="dialog" aria-label="Edit hours">
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <b>{DAYS[edit.day][1]}</b>
            <button className="btn sm ghost" aria-label="Close" onClick={() => setEdit(null)}><X size={15} /></button>
          </div>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button className={`chip ${edit.field === 'start' ? 'on' : ''}`} onClick={() => setEdit({ ...edit, field: 'start' })}>From {editing[0]}</button>
            <button className={`chip ${edit.field === 'end' ? 'on' : ''}`} onClick={() => setEdit({ ...edit, field: 'end' })}>To {editing[1]}</button>
          </div>
          <ClockPicker key={edit.field} value={edit.field === 'start' ? editing[0] : editing[1]}
            presets={edit.field === 'start' ? ['08:00', '09:00', '10:00', '14:00'] : ['12:00', '13:00', '17:00', '17:30']}
            onChange={tm => (edit.field === 'start' ? setTimes(edit.day, edit.idx, tm, editing[1]) : setTimes(edit.day, edit.idx, editing[0], tm))} />
          <div className="toolbar" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <button className="btn sm danger" onClick={() => removeBlock(edit.day, edit.idx)}><Trash2 size={14} />Delete</button>
            <button className="btn sm" onClick={() => copyToWeekdays(edit.day)}><Copy size={14} />Same on Mon–Fri</button>
          </div>
        </div>
      )}

      <div className="sched-foot">
        <span className="pill blue">{Math.round(total / 6) / 10} h per week</span>
        {lunch && <span className="pill busy">Lunch {lunch[0]}–{lunch[1]}</span>}
        <span className="sub" style={{ margin: 0, fontSize: 12 }}>Drag to add · drag a block to move · pull an edge to resize · click to set exact times</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => write({ mon: STANDARD_DAY, tue: STANDARD_DAY, wed: STANDARD_DAY, thu: STANDARD_DAY, fri: STANDARD_DAY, sat: [], sun: [] })}>Standard office week</button>
        <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>Clear</button>
      </div>
    </div>
  );
}

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
                  <TimeField value={a} onChange={x => set(d, v!.map((r, k) => (k === i ? [x, r[1]] : r)))} />–
                  <TimeField value={b} onChange={x => set(d, v!.map((r, k) => (k === i ? [r[0], x] : r)))} />
                  <button className="btn sm ghost" aria-label="Remove this range" onClick={() => set(d, v!.filter((_, k) => k !== i))}><X size={14} /></button>
                </span>
              ))}
              {mode === 'none' && <span className="pill">No hours</span>}
              {mode === 'unpublished' && <span className="pill miss">Not published</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" onClick={() => set(d, [...(v ?? []), ['09:00', '11:00']])}>+ range</button>
              {mode !== 'none' && <button className="btn sm ghost" title="Publishes “no hours” for this day" onClick={() => set(d, [])}>None</button>}
              {mode !== 'unpublished' && <button className="btn sm ghost" title="Back to “not published”" onClick={() => set(d, undefined)}>Unset</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Calendar first; a day-by-day list for exact edits. */
export function HoursField({ value, onChange, lunch }: { value: Hours | null; onChange: (h: Hours | null) => void; lunch?: [string, string] }) {
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="toolbar">
        <button type="button" className={`chip ${mode === 'calendar' ? 'on' : ''}`} onClick={() => setMode('calendar')}>Calendar</button>
        <button type="button" className={`chip ${mode === 'list' ? 'on' : ''}`} onClick={() => setMode('list')}>Day by day</button>
      </div>
      {mode === 'calendar' ? <ScheduleEditor value={value} onChange={onChange} lunch={lunch} /> : <HoursEditor value={value} onChange={onChange} />}
    </div>
  );
}

// ── maps ─────────────────────────────────────────────────────────────────────

export const CAMPUS: [number, number] = [-5.1066, 33.5393];
export type MapPoint = { id: string; coord: [number, number]; color: string; label: string; text?: string; size?: number; dim?: boolean };
export type Ring = [number, number][];
export type FootprintFC = { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: { id: string; place_id?: string | null; place_name?: string | null; source?: string } }[] };

const SAT_KEY = 'gomap-admin-satellite';
const readSat = () => { try { return localStorage.getItem(SAT_KEY) === '1'; } catch { return false; } };
const EMPTY = { type: 'FeatureCollection', features: [] } as const;
/** World with a hole the shape of campus: everything outside AUI is dimmed. */
const OUTSIDE = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], [...CAMPUS_OUTLINE].reverse()] } }] };

/** The GoCampus map look (Mapbox Standard, dusk light), locked to campus, with the satellite photo one click away. */
function newCampusMap(container: HTMLDivElement, center: [number, number], zoom: number, pitch: number) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const m = new mapboxgl.Map({
    container, style: 'mapbox://styles/mapbox/standard', center, zoom, pitch, bearing: -23,
    maxBounds: CAMPUS_MAX_BOUNDS, minZoom: CAMPUS_MIN_ZOOM,
    config: { basemap: { showPointOfInterestLabels: false, showAdminBoundaries: false, showTransitLabels: false, lightPreset: 'dusk' } } as never,
  });
  m.on('style.load', () => {
    m.addSource('imagery', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    m.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', slot: 'bottom', layout: { visibility: 'none' } } as never);
    m.addSource('outside', { type: 'geojson', data: OUTSIDE as never });
    m.addLayer({ id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-color': '#101814', 'fill-opacity': 0.4 } });
    m.addLayer({ id: 'outline', type: 'line', source: 'outside', paint: { 'line-color': '#ffffff', 'line-opacity': 0.25, 'line-width': 1.2, 'line-dasharray': [2, 2] } });
  });
  return m;
}
/** Satellite on: photo layer visible, daylight, no 3D buildings over the photo. */
function applySatellite(m: mapboxgl.Map, on: boolean) {
  const go = () => {
    if (m.getLayer('imagery')) m.setLayoutProperty('imagery', 'visibility', on ? 'visible' : 'none');
    try { m.setConfigProperty('basemap', 'show3dObjects', !on); m.setConfigProperty('basemap', 'lightPreset', on ? 'day' : 'dusk'); } catch { /* style still loading */ }
  };
  if (m.isStyleLoaded()) go(); else m.once('style.load', go);
}

function SatelliteToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="maptoggle" role="radiogroup" aria-label="Map type">
      <button role="radio" aria-checked={!on} className={!on ? 'on' : ''} onClick={() => onChange(false)}><MapIcon size={14} />Map</button>
      <button role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => onChange(true)}><Satellite size={14} />Satellite</button>
    </div>
  );
}

/**
 * The campus map every admin page opens on. Click a marker to select it; the selected marker
 * can be dragged when `onMove` is given. `drawing` turns clicks into the corners of a building
 * outline (click the first corner or press Enter to finish, Backspace to undo a corner, Esc to stop).
 */
export function CampusMap({ points, selected, onSelect, onMove, height = 400, children, flyOnSelect = true, drawing = false, onDraw, onCancelDraw, footprints, onFootprint, onMapClick, satellite: satProp }: {
  points: MapPoint[]; selected?: string | null; onSelect?: (id: string) => void; onMove?: (id: string, c: [number, number]) => void;
  height?: number; children?: React.ReactNode; flyOnSelect?: boolean;
  drawing?: boolean; onDraw?: (ring: Ring) => void; onCancelDraw?: () => void;
  footprints?: FootprintFC | null; onFootprint?: (f: FootprintFC['features'][number]) => void;
  onMapClick?: (c: [number, number]) => void; satellite?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef(new Map<string, mapboxgl.Marker>());
  const [sat, setSat] = useState(readSat);
  const [corners, setCorners] = useState<Ring>([]);
  const cb = useRef({ onSelect, onMove, onDraw, onFootprint, onMapClick, drawing, corners, onCancelDraw });
  cb.current = { onSelect, onMove, onDraw, onFootprint, onMapClick, drawing, corners, onCancelDraw };
  const satOn = satProp ?? sat;

  useEffect(() => {
    if (!el.current || !MAPBOX_TOKEN) return;
    const m = newCampusMap(el.current, CAMPUS, 15.9, 40);
    map.current = m;
    m.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'bottom-right');
    m.on('style.load', () => {
      m.addSource('footprints', { type: 'geojson', data: EMPTY as never, promoteId: 'id' });
      m.addLayer({ id: 'footprints-fill', type: 'fill', source: 'footprints', paint: { 'fill-color': ['case', ['to-boolean', ['get', 'place_id']], '#2563EB', '#F59E0B'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.45, 0.22] } });
      m.addLayer({ id: 'footprints-line', type: 'line', source: 'footprints', paint: { 'line-color': ['case', ['to-boolean', ['get', 'place_id']], '#93C5FD', '#FCD34D'], 'line-width': 1.5 } });
      m.addSource('draft', { type: 'geojson', data: EMPTY as never });
      m.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#16A34A', 'fill-opacity': 0.3 } });
      m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#22C55E', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
      m.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#16A34A', 'circle-stroke-width': 3 } });
    });
    let hover: string | number | null = null;
    m.on('mousemove', 'footprints-fill', e => {
      if (cb.current.drawing) return;
      const id = (e.features?.[0] as { id?: string | number } | undefined)?.id; if (id == null) return;
      if (hover != null) m.setFeatureState({ source: 'footprints', id: hover }, { hover: false });
      hover = id; m.setFeatureState({ source: 'footprints', id }, { hover: true }); m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'footprints-fill', () => { if (hover != null) m.setFeatureState({ source: 'footprints', id: hover }, { hover: false }); hover = null; m.getCanvas().style.cursor = cb.current.drawing ? 'crosshair' : ''; });
    m.on('click', e => {
      const c: [number, number] = [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))];
      if (cb.current.drawing) {
        const cs = cb.current.corners;
        // clicking near the first corner closes the outline
        if (cs.length >= 3) { const p0 = m.project(cs[0]); if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 12) { cb.current.onDraw?.([...cs, cs[0]]); setCorners([]); return; } }
        setCorners([...cs, c]);
        return;
      }
      const f = m.getLayer('footprints-fill') ? m.queryRenderedFeatures(e.point, { layers: ['footprints-fill'] })[0] : undefined;
      if (f && cb.current.onFootprint) { cb.current.onFootprint(f as never); return; }
      cb.current.onMapClick?.(c);
    });
    return () => { m.remove(); map.current = null; markers.current.clear(); };
  }, []);

  useEffect(() => { if (map.current) applySatellite(map.current, satOn); }, [satOn]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const set = () => (m.getSource('footprints') as mapboxgl.GeoJSONSource | undefined)?.setData((footprints ?? EMPTY) as never);
    if (m.isStyleLoaded() && m.getSource('footprints')) set(); else m.once('idle', set);
  }, [footprints]);

  // drawing: live outline, cursor, keyboard
  useEffect(() => {
    const m = map.current; if (!m) return;
    m.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (!drawing) setCorners([]);
  }, [drawing]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const feats = [
      ...corners.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
      ...(corners.length >= 3 ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } }] : corners.length === 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: corners } }] : []),
    ];
    (m.getSource('draft') as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats } as never);
  }, [corners]);
  useEffect(() => {
    if (!drawing) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') { setCorners([]); cb.current.onCancelDraw?.(); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setCorners(cs => cs.slice(0, -1)); }
      if (e.key === 'Enter' && cb.current.corners.length >= 3) { const cs = cb.current.corners; cb.current.onDraw?.([...cs, cs[0]]); setCorners([]); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [drawing]);

  const key = useMemo(() => JSON.stringify(points.map(p => [p.id, p.coord, p.color, p.text, p.dim, p.size])), [points]);
  useEffect(() => {
    if (!map.current) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      let m = markers.current.get(p.id);
      if (!m) {
        const div = document.createElement('div');
        div.className = 'mk';
        div.addEventListener('click', e => { if (cb.current.drawing) return; e.stopPropagation(); cb.current.onSelect?.(p.id); });
        m = new mapboxgl.Marker({ element: div }).setLngLat(p.coord).addTo(map.current);
        m.on('dragend', () => { const c = m!.getLngLat(); cb.current.onMove?.(p.id, [Number(c.lng.toFixed(7)), Number(c.lat.toFixed(7))]); });
        markers.current.set(p.id, m);
      }
      const div = m.getElement();
      div.style.background = p.color;
      const s = p.size ?? 26;
      div.style.width = div.style.height = `${s}px`;
      div.textContent = p.text ?? '';
      div.title = p.label;
      div.setAttribute('aria-label', p.label);
      div.classList.toggle('dim', !!p.dim);
      m.setLngLat(p.coord);
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.remove(); markers.current.delete(id); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const [id, m] of markers.current) {
      const on = id === selected;
      m.getElement().classList.toggle('sel', on);
      m.setDraggable(on && !!cb.current.onMove);
      if (on) m.getElement().style.zIndex = '5'; else m.getElement().style.zIndex = '';
    }
    const p = points.find(x => x.id === selected);
    if (p && flyOnSelect) map.current?.flyTo({ center: p.coord, zoom: Math.max(map.current.getZoom(), 17), duration: 700, essential: true });
  }, [selected, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!MAPBOX_TOKEN) return <Notice>Set VITE_MAPBOX_TOKEN in admin/.env.local (or EXPO_PUBLIC_MAPBOX_TOKEN in mobile/.env.local) to see the map.</Notice>;
  return (
    <div className={`hero ${drawing ? 'drawing' : ''}`}>
      <div ref={el} className="map" style={{ height }} role="application" aria-label="Campus map: click a marker to select it" />
      {children && <div className="overlay">{children}</div>}
      {satProp === undefined && <div className="overlay-br"><SatelliteToggle on={sat} onChange={v => { setSat(v); try { localStorage.setItem(SAT_KEY, v ? '1' : '0'); } catch { /* private mode */ } }} /></div>}
      {drawing && (
        <div className="drawbar" role="status">
          <PenLine size={15} />
          <span>{corners.length < 3 ? `Click the corners of the building on the photo (${corners.length} so far)` : `${corners.length} corners · click the first corner or press Enter to finish`}</span>
          <span className="sub" style={{ margin: 0 }}>Backspace: undo a corner · Esc: stop</span>
          {corners.length >= 3 && <button className="btn sm green" onClick={() => { cb.current.onDraw?.([...corners, corners[0]]); setCorners([]); }}>Finish</button>}
        </div>
      )}
    </div>
  );
}

/** Small map with a pin (report details). */
export function PinMap({ center, pins, height = 240, zoom = 17.6 }: {
  center: [number, number]; pins: { id: string; coord: [number, number]; color: string; label: string }[]; height?: number; zoom?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [sat, setSat] = useState(readSat);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  useEffect(() => {
    if (!el.current || !MAPBOX_TOKEN) return;
    const m = newCampusMap(el.current, center, zoom, 30);
    mapRef.current = m;
    applySatellite(m, sat);
    for (const p of pins) new mapboxgl.Marker({ color: p.color }).setLngLat(p.coord).setPopup(new mapboxgl.Popup({ offset: 24 }).setText(p.label)).addTo(m);
    return () => { m.remove(); mapRef.current = null; };
  }, [center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mapRef.current) applySatellite(mapRef.current, sat); }, [sat]);
  if (!MAPBOX_TOKEN) return null;
  return (
    <div className="hero" style={{ marginBottom: 0 }}>
      <div ref={el} className="map" style={{ height }} />
      <div className="overlay-br"><SatelliteToggle on={sat} onChange={setSat} /></div>
    </div>
  );
}


// ── other bits ───────────────────────────────────────────────────────────────

export function Tags({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t && !value.includes(t)) onChange([...value, t]); setDraft(''); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="chips">{value.map(v => <span key={v} className="chip">{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter(x => x !== v))}><X size={12} /></button></span>)}</div>
      <input className="i" value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

/** Weekday × hour heatmap (minutes or counts). */
export function Heatmap({ grid, from = 7, to = 21, color = '37,99,235', unit = 'min' }: { grid: number[][]; from?: number; to?: number; color?: string; unit?: string }) {
  const max = Math.max(1, ...grid.flatMap(r => r.slice(from, to)));
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="heat" style={{ gridTemplateColumns: `40px repeat(${to - from}, 1fr)` }}>
      <div />
      {Array.from({ length: to - from }, (_, i) => <div key={i} className="lbl" style={{ justifyContent: 'center' }}>{(from + i) % 2 === 0 ? `${from + i}h` : ''}</div>)}
      {grid.map((row, d) => (
        <div key={d} style={{ display: 'contents' }}>
          <div className="lbl">{names[d]}</div>
          {row.slice(from, to).map((v, i) => (
            <div key={i} className="c" title={`${names[d]} ${from + i}:00 · ${v} ${unit}`} style={{ background: v ? `rgba(${color},${0.12 + 0.88 * (v / max)})` : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}
