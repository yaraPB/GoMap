import { api, fmtDate } from '../api';
import { Notice, useLoad } from '../ui';

export type Go = (section: string, id?: string) => void;

/** Board 24: opens on what makes the app wrong, not on usage statistics. */
export default function Overview({ go }: { go: Go }) {
  const { data: o, error, loading } = useLoad(api.overview);
  if (loading) return <p className="empty">Loading…</p>;
  if (error || !o) return <Notice tone="miss">{error}</Notice>;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tiles = [
    { l: 'Reports waiting', v: o.counts.open_reports, note: 'Nothing reaches the map until you confirm', go: 'reports' },
    { l: 'Source conflicts', v: o.counts.conflicts, note: 'Shown as unconfirmed in the app', go: 'offices' },
    { l: 'Unanswered questions', v: o.counts.unanswered, note: 'Gaps in the register', go: 'log' },
    { l: 'Records past review', v: o.stale.places.length + o.stale.people_total, note: 'Carry an “unverified” banner', go: 'places' },
  ];
  return (
    <>
      <div className="head">
        <div><h1>What needs you today</h1><p className="sub">{today}</p></div>
        <div className="toolbar"><button className="btn" onClick={() => go('procedures', 'new')}>Add a procedure</button><button className="btn dark" onClick={() => go('places')}>Start the sweep</button></div>
      </div>
      <div className="tiles">
        {tiles.map(t => <button key={t.l} className="tile" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go(t.go)}><div className="l">{t.l}</div><div className="v">{t.v}</div><div className="sub" style={{ fontSize: 12 }}>{t.note}</div></button>)}
      </div>
      <div className="stack">
        <div className="card">
          <h2>Conflicts in the source data</h2>
          <p className="sub" style={{ marginBottom: 10 }}>Two sources disagree, so the app shows neither as confirmed.</p>
          {o.conflicts.length ? (
            <table><thead><tr><th>Record</th><th>Field</th>{o.conflicts[0].conflict?.values.map(v => <th key={v.source}>{v.source}</th>)}<th /></tr></thead>
              <tbody>{o.conflicts.map(c => (
                <tr key={c.id}><td><b>{c.name}</b></td><td>{c.conflict?.field.replace('_', ' ')}</td>{c.conflict?.values.map(v => <td key={v.source}>{v.value}</td>)}<td><button className="btn sm" onClick={() => go('offices', c.id)}>Resolve</button></td></tr>
              ))}</tbody></table>
          ) : <p className="empty">No conflicts.</p>}
        </div>
        <div className="cols">
          <div className="card">
            <h2>Questions GoMap could not answer</h2>
            <p className="sub" style={{ marginBottom: 10 }}>Each one is a gap in the register, not a bug.</p>
            {o.unanswered.length ? <table><tbody>{o.unanswered.map(u => (
              <tr key={u.question}><td style={{ width: 36 }}><span className="pill">{u.times}×</span></td><td>{u.question} <span className="sub" style={{ fontSize: 12 }}>· {u.lang}</span></td><td><button className="btn sm" onClick={() => go('procedures', 'new')}>Answer</button></td></tr>
            ))}</tbody></table> : <p className="empty">Every question had an answer.</p>}
          </div>
          <div className="card">
            <h2>Records past their review date</h2>
            <p className="sub" style={{ marginBottom: 10 }}>Shown with an “unverified” banner until confirmed.</p>
            <table><tbody>
              {o.stale.places.slice(0, 8).map(p => <tr key={p.id}><td><b>{p.name}</b>{p.position_estimated && <span className="pill miss" style={{ marginLeft: 6 }}>pin estimated</span>}</td><td className="sub">{p.verified_at ? fmtDate(p.verified_at) : 'never verified'}</td><td><button className="btn sm" onClick={() => go('places', p.id)}>Confirm</button></td></tr>)}
              {o.stale.people.slice(0, 6).map(p => <tr key={p.id}><td>{p.name}</td><td className="sub">{p.verified_at ? fmtDate(p.verified_at) : 'never verified'}</td><td><button className="btn sm" onClick={() => go('offices', p.id)}>Confirm</button></td></tr>)}
            </tbody></table>
            <p className="sub" style={{ fontSize: 12 }}>{o.stale.places.length} places and {o.stale.people_total} people in total.</p>
          </div>
        </div>
        <div className="cols">
          <div className="card">
            <h2>Missing information</h2>
            <p className="sub" style={{ marginBottom: 10 }}>{o.missing_total} people with no office, email or hours. The app never guesses these.</p>
            <table><tbody>{o.missing.slice(0, 10).map(m => <tr key={m.id}><td>{m.name}</td><td>{m.missing.map(x => <span key={x} className="pill miss" style={{ marginRight: 4 }}>{x}</span>)}</td><td><button className="btn sm" onClick={() => go('offices', m.id)}>Fill in</button></td></tr>)}</tbody></table>
          </div>
          <div className="card">
            <h2>Shared offices and unpublished procedures</h2>
            <table><tbody>
              {o.shared_offices.map(s => <tr key={`${s.place_id}${s.office_number}`}><td>Office {s.office_number} · {s.place_id.replace('building-', 'Building ')}</td><td className="sub">{s.n} people: {s.names}</td></tr>)}
              {o.procedures_not_live.map(p => <tr key={p.id}><td>{p.title}</td><td><span className={`pill ${p.status === 'draft' ? 'miss' : 'busy'}`}>{p.status}</span> <button className="btn sm" onClick={() => go('procedures', p.id)}>Review</button></td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
