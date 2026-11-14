import { useEffect, useState } from 'react';
import { ago, api, API_URL, fmtDate, type ReportCluster } from '../api';
import { Notice, PinMap, useLoad } from '../ui';

const KIND: Record<string, string> = { closed: 'Closed or blocked', broken: 'Out of order', info: 'Wrong information', hazard: 'Hazard', light: 'Lighting', access: 'Access blocked' };
const plusDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

/** Board 30: the queue. Duplicates within 20 m arrive as one item; nothing reaches the map until confirmed. */
export default function Reports() {
  const [tab, setTab] = useState<'new' | 'confirmed' | 'resolved' | 'dismissed'>('new');
  const list = useLoad(() => api.reports(tab), [tab]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setSel(list.data?.[0]?.cluster_id ?? null); }, [list.data]);
  const item = list.data?.find(r => r.cluster_id === sel) ?? null;
  return (
    <>
      <div className="head"><div><h1>Reports from campus</h1><p className="sub">Anyone can drop a pin on something that is wrong. Nothing reaches the map until you confirm it here.</p></div></div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        {(['new', 'confirmed', 'resolved', 'dismissed'] as const).map(t => <button key={t} className={`btn sm ${tab === t ? 'dark' : ''}`} onClick={() => setTab(t)}>{t === 'new' ? 'Waiting on you' : t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {list.error && <Notice tone="miss">{list.error}</Notice>}
      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          {list.data?.length ? <div className="list">{list.data.map(r => (
            <button key={r.cluster_id} className={`row ${sel === r.cluster_id ? 'on' : ''}`} onClick={() => setSel(r.cluster_id)}>
              <span className="grow"><b>{KIND[r.kind] ?? r.kind}</b><small>{r.place?.name ?? 'Open ground'} · {ago(r.last_at)}</small></span>
              {r.count > 1 && <span className="pill busy">{r.count} reports</span>}
            </button>
          ))}</div> : <p className="empty">{list.loading ? 'Loading…' : 'Nothing here.'}</p>}
        </div>
        {item ? <Decision key={item.cluster_id} r={item} onDone={list.reload} /> : <div className="card empty">Choose a report.</div>}
      </div>
    </>
  );
}

function Decision({ r, onDone }: { r: ReportCluster; onDone: () => void }) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [until, setUntil] = useState(r.reports.some(x => x.duration === 'today') ? plusDays(1) : plusDays(14));
  const [reason, setReason] = useState(r.reports.find(x => x.note)?.note?.slice(0, 80) ?? (r.kind === 'closed' ? 'Closed for works' : KIND[r.kind]));
  const [radius, setRadius] = useState(15);
  const [closePlace, setClosePlace] = useState(r.kind === 'closed' || r.kind === 'access');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setMsg({ tone: 'ok', text: ok }); onDone(); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } };
  const confirm = () => act(async () => {
    const res = await api.confirm(r.cluster_id, { from: new Date(from).toISOString(), until: until ? new Date(`${until}T23:59:00`).toISOString() : null, reason, radius_m: radius, close_place: closePlace });
    setMsg({ tone: 'ok', text: `Published. ${res.closed_edges} path segments are now avoided by walking routes. Told: ${res.notified.join(', ')}.` });
  }, 'Published.');
  return (
    <div className="stack">
      <div className="card stack">
        <div><h2 style={{ fontSize: 20 }}>{r.place?.name ?? 'Open ground'} · {r.count} report{r.count > 1 ? 's' : ''} in the same 20 m</h2>
          <p className="sub">First reported {ago(r.first_at)} · most recent {ago(r.last_at)}</p></div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <PinMap center={r.coordinates} height={240} zoom={17.8} pins={[{ id: 'r', coord: r.coordinates, color: '#B5342B', label: KIND[r.kind] }]} />
        <p className="label">What they wrote</p>
        {r.reports.map(x => (
          <div key={x.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {x.photo_path && <a href={`${API_URL}${x.photo_path}`} target="_blank" rel="noreferrer"><img src={`${API_URL}${x.photo_path}`} alt="Photo attached to the report" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} /></a>}
            <div><div>{x.note ? `“${x.note}”` : <span className="sub">No note</span>}</div><div className="sub" style={{ fontSize: 12 }}>{x.reporter} · {ago(x.created_at)} · expects: {x.duration}</div></div>
          </div>
        ))}
      </div>
      {r.status === 'new' ? (
        <div className="cols">
          <div className="card stack">
            <p className="label">Confirm it{r.place ? ' and close the place' : ''}</p>
            <div className="grid2">
              <label className="f">Closed from<input className="i" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label className="f">Until<input className="i" type="date" value={until} onChange={e => setUntil(e.target.value)} /></label>
            </div>
            <label className="f">Reason shown<input className="i" value={reason} onChange={e => setReason(e.target.value)} /></label>
            <label className="f">Paths blocked within (m)<input className="i" type="number" min={5} max={80} value={radius} onChange={e => setRadius(Number(e.target.value))} /></label>
            {r.place && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={closePlace} onChange={e => setClosePlace(e.target.checked)} /> Mark {r.place.name} as closed</label>}
            <div className="toolbar"><button className="btn dark" onClick={confirm} disabled={!reason.trim()}>Confirm and publish</button><button className="btn danger" onClick={() => act(() => api.dismiss(r.cluster_id), 'Dismissed. Nothing changed on the map.')}>Dismiss</button></div>
          </div>
          <div className="card stack">
            <p className="label">What people will see</p>
            <div className="notice miss" style={{ flexDirection: 'column' }}><b>{r.place?.name ?? 'This path'}</b><span>{reason}{until ? ` until ${fmtDate(until)}` : ''}</span></div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink2)' }}>
              <li>The pin greys out and carries the reason</li>
              <li>Walking routes stop going through it</li>
              <li>The assistant says it is closed if anyone asks</li>
              <li>Everyone who reported it is told it is handled</li>
            </ul>
          </div>
        </div>
      ) : r.status === 'confirmed' ? (
        <div className="card stack">
          <Notice tone="info">Live on the map: “{r.closure?.reason}” from {fmtDate(r.closure?.from)}{r.closure?.until ? ` until ${fmtDate(r.closure.until)}` : ''}. It lifts itself on the end date.</Notice>
          <div><button className="btn green" onClick={() => act(() => api.resolve(r.cluster_id), 'Reopened. Routes use it again.')}>Reopen now</button></div>
        </div>
      ) : <Notice tone="info">This report was {r.status}.</Notice>}
    </div>
  );
}
