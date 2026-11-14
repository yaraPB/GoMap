import { useState } from 'react';
import { api, fmtMin, NOTE_KINDS, type OfficeTimeRow } from '../api';
import { Notice, useLoad } from '../ui';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

/**
 * Posted office hours vs time professors actually marked themselves "in the office".
 * Presence is set from the app (faculty status screen) and logged per change.
 */
export default function OfficeTime({ go }: { go: (s: string, id?: string) => void }) {
  const [days, setDays] = useState(7);
  const [dep, setDep] = useState('');
  const { data, error, loading } = useLoad(() => api.officeTime(days, dep || undefined), [days, dep]);
  const people = data?.people ?? [];
  const totals = people.reduce((t, p) => ({ published: t.published + p.published_min, in: t.in + p.in_min, active: t.active + (p.sessions ? 1 : 0) }), { published: 0, in: 0, active: 0 });
  const noHours = people.filter(p => !p.published_min).length;
  return (
    <>
      <div className="head">
        <div><h1>Office hours & time in office</h1><p className="sub">Published office hours next to the time each professor was marked “in the office” from the app.</p></div>
        <div className="toolbar">
          <select className="i" value={dep} onChange={e => setDep(e.target.value)} aria-label="School"><option value="">All schools</option><option value="SBA">SBA</option><option value="SSE">SSE</option><option value="SSAH">SSAH</option><option value="LC">Language Center</option></select>
          {[7, 30].map(d => <button key={d} className={`btn sm ${days === d ? 'dark' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
      </div>
      <div className="tiles">
        <div className="tile"><div className="v">{fmtMin(totals.published)}</div><div className="l">Office hours published ({days} days)</div></div>
        <div className="tile"><div className="v">{fmtMin(totals.in)}</div><div className="l">Marked in the office</div></div>
        <div className="tile"><div className="v">{totals.active}</div><div className="l">Professors using status</div></div>
        <div className="tile"><div className="v">{noHours}</div><div className="l">With no published hours</div></div>
      </div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card tablewrap" style={{ padding: 6 }}>
        <table>
          <thead><tr><th>Professor</th><th>Office</th><th>Posted hours</th><th>Week</th><th>In office vs posted</th><th>Now</th><th>Door note</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
            {people.map(p => <Row key={p.id} p={p} onOpen={() => go('offices', p.id)} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ p, onOpen }: { p: OfficeTimeRow; onOpen: () => void }) {
  const pct = p.ratio === null ? null : Math.min(100, Math.round(p.ratio * 100));
  const kind = NOTE_KINDS.find(k => k[0] === p.note_kind);
  return (
    <tr>
      <td><button className="row" style={{ padding: 0 }} onClick={onOpen}><span className="grow"><b>{p.name}</b><small>{p.department}</small></span></button></td>
      <td>{p.place ? `${p.place.name}${p.office_number ? `, ${p.office_number}` : ''}` : <span className="pill miss">no office</span>}</td>
      <td style={{ maxWidth: 220 }}>{p.hours_text ?? <span className="pill miss">not published</span>}</td>
      <td><MiniWeek hours={p.hours} /></td>
      <td>
        {p.published_min ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={`bar ${pct !== null && pct < 50 ? 'low' : ''}`}><i style={{ width: `${pct ?? 0}%` }} /></div>
            <small>{fmtMin(p.in_min)} / {fmtMin(p.published_min)}</small>
          </div>
        ) : <small>{p.in_min ? fmtMin(p.in_min) : '—'}</small>}
      </td>
      <td><span className={`pill ${['in', 'open'].includes(p.availability.state) ? 'ok' : p.availability.state === 'busy' ? 'busy' : ''}`}>{p.availability.label}</span></td>
      <td>{p.note || kind ? <span className="sticky">{kind?.[1]} {p.note || kind?.[2]}</span> : <small className="sub">—</small>}</td>
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
          <rect x="0" y={i * 7} width="100" height="5" rx="1.5" fill="#F2F3F0" />
          {(hours?.[d] ?? []).map(([a, b], k) => <rect key={k} x={x(a)} y={i * 7} width={Math.max(1.5, x(b) - x(a))} height="5" rx="1.5" fill="#2563EB" />)}
        </g>
      ))}
    </svg>
  );
}
