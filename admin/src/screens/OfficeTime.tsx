import { useState } from 'react';
import { api, fmtMin, type OfficeTimeRow } from '../api';
import { Heatmap, Notice, useLoad } from '../ui';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

/**
 * Hours professors actually spent in their office (marked "in" from the app), next to the
 * office hours they post. Only totals: why someone was away is theirs to say to students.
 */
export default function OfficeTime({ go }: { go: (s: string, id?: string) => void }) {
  const [days, setDays] = useState(7);
  const [dep, setDep] = useState('');
  const { data, error, loading } = useLoad(() => api.officeTime(days, dep || undefined), [days, dep]);
  const people = data?.people ?? [];
  const totals = people.reduce((t, p) => ({ published: t.published + p.published_min, in: t.in + p.in_min, active: t.active + (p.in_min ? 1 : 0) }), { published: 0, in: 0, active: 0 });
  const empty = Array.from({ length: 7 }, () => new Array(24).fill(0));
  return (
    <>
      <div className="head">
        <div><h1>Office time</h1><p className="sub">Hours spent in the office, from professors marking themselves “in” in the app.</p></div>
        <div className="toolbar">
          <select className="i" value={dep} onChange={e => setDep(e.target.value)} aria-label="School"><option value="">All schools</option><option value="SBA">SBA</option><option value="SSE">SSE</option><option value="SSAH">SSAH</option><option value="LC">Language Center</option></select>
          {[7, 30].map(d => <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="label" style={{ margin: 0 }}>When professors are in their offices · last {days} days</p>
          <span className="sub" style={{ margin: 0, fontSize: 12 }}>Darker = more professor-hours in offices</span>
        </div>
        <Heatmap grid={data?.heat ?? empty} from={7} to={21} />
      </div>

      <div className="tiles">
        <div className="tile"><div className="l">Hours spent in offices</div><div className="v">{fmtMin(totals.in)}</div></div>
        <div className="tile"><div className="l">Office hours posted ({days} days)</div><div className="v">{fmtMin(totals.published)}</div></div>
        <div className="tile"><div className="l">Professors who marked time</div><div className="v">{totals.active}</div></div>
        <div className="tile"><div className="l">Of posted hours covered</div><div className="v">{totals.published ? `${Math.round((totals.in / totals.published) * 100)}%` : '—'}</div></div>
      </div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card tablewrap" style={{ padding: 0, maxHeight: 640 }}>
        <table>
          <thead><tr><th>Professor</th><th>Office</th><th>Posted hours</th><th>Week</th><th>Hours in office</th><th style={{ width: 220 }}>Of posted hours</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
            {people.map(p => <Row key={p.id} p={p} onOpen={() => go('offices', p.id)} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ p, onOpen }: { p: OfficeTimeRow; onOpen: () => void }) {
  const pct = p.published_min ? Math.min(100, Math.round((p.in_min / p.published_min) * 100)) : null;
  return (
    <tr className="click" onClick={onOpen}>
      <td><b style={{ fontWeight: 600 }}>{p.name}</b><div className="sub" style={{ margin: 0, fontSize: 12 }}>{p.department}</div></td>
      <td>{p.place ? `${p.place.name}${p.office_number ? `, ${p.office_number}` : ''}` : <span className="pill miss">no office</span>}</td>
      <td style={{ maxWidth: 220, fontSize: 12.5, color: 'var(--ink2)' }}>{p.hours_text ?? <span className="pill miss">not published</span>}</td>
      <td><MiniWeek hours={p.hours} /></td>
      <td><b style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.in_min ? fmtMin(p.in_min) : '—'}</b></td>
      <td>
        {pct !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={`bar ${pct < 50 ? 'low' : ''}`} style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
            <small style={{ width: 36, textAlign: 'right' }}>{pct}%</small>
          </div>
        ) : <small className="sub">no posted hours</small>}
      </td>
    </tr>
  );
}

/** Tiny Mon–Fri strip, 8:00–19:00, posted hours in blue. */
function MiniWeek({ hours }: { hours: OfficeTimeRow['hours'] }) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const x = (t: string) => ((Math.min(Math.max(m(t), 480), 1140) - 480) / 660) * 100;
  return (
    <svg width="120" height="34" viewBox="0 0 100 34" preserveAspectRatio="none" aria-label="Posted hours, Monday to Friday">
      {DAY_KEYS.map((d, i) => (
        <g key={d}>
          <rect x="0" y={i * 7} width="100" height="5" rx="1.5" fill="#F1F3F6" />
          {(hours?.[d] ?? []).map(([a, b], k) => <rect key={k} x={x(a)} y={i * 7} width={Math.max(1.5, x(b) - x(a))} height="5" rx="1.5" fill="#2563EB" />)}
        </g>
      ))}
    </svg>
  );
}
