import { useEffect, useMemo, useState } from 'react';
import { api, CAT_COLOR, CATEGORIES, fmtDate, SCHOOLS, type Hours, type PlaceDetail } from '../api';
import { HoursEditor, Notice, PinMap, Tags, useLoad } from '../ui';

/** Board 25: places and POIs. Name, category, owner schools, aliases, hours, entrances, and position by dragging the pin. */
export default function Places({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const list = useLoad(api.places);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const items = useMemo(() => (list.data ?? []).filter(p => (!cat || p.category === cat) && (!q || `${p.name} ${p.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, cat]);
  return (
    <>
      <div className="head"><div><h1>Places & POIs</h1><p className="sub">{list.data?.length ?? '…'} places from the campus map. Positions are real; names and categories need your confirmation.</p></div></div>
      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <div className="toolbar" style={{ padding: 4, marginBottom: 6 }}>
            <input className="search" placeholder="Find a place" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a place" />
            <select className="i" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="list" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            {items.map(p => (
              <button key={p.id} className={`row ${selected === p.id ? 'on' : ''}`} onClick={() => select(p.id)}>
                <span className="dot" style={{ background: CAT_COLOR[p.category] }} />
                <span className="grow"><b>{p.name}</b><small>{p.category}{p.people_count ? ` · ${p.people_count} offices` : ''}</small></span>
                {p.status === 'closed' && <span className="pill miss">closed</span>}
                {p.position_estimated ? <span className="pill miss">pin?</span> : !p.verified && <span className="pill busy">unverified</span>}
              </button>
            ))}
          </div>
        </div>
        {selected ? <PlaceEditor key={selected} id={selected} onSaved={list.reload} others={list.data ?? []} /> : <div className="card empty">Choose a place to edit it.</div>}
      </div>
    </>
  );
}

function PlaceEditor({ id, onSaved, others }: { id: string; onSaved: () => void; others: { coordinates: [number, number]; category: string; id: string }[] }) {
  const { data, error, reload } = useLoad(() => api.place(id), [id]);
  const [form, setForm] = useState<PlaceDetail | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (error) return <Notice tone="miss">{error}</Notice>;
  if (!form) return <div className="card empty">Loading…</div>;
  const set = (patch: Partial<PlaceDetail>) => setForm({ ...form, ...patch });
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setMsg(null);
    try {
      await api.savePlace(id, { name: form.name, category: form.category, schools: form.schools, aliases: form.aliases, description: form.description ?? '', hours: form.hours,
        status: form.status, closed_reason: form.closed_reason, closed_until: form.closed_until, review_months: form.review_months, ...extra });
      setMsg({ tone: 'ok', text: 'Saved. The app shows it on the next refresh (within 30 seconds).' });
      reload(); onSaved();
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const moveEntrance = async (eid: string, coord: [number, number]) => {
    try { await api.saveEntrance(eid, { coordinates: coord }); setMsg({ tone: 'ok', text: 'Entrance moved. Routes now end at the new door.' }); reload(); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div><h2 style={{ fontSize: 20 }}>{data?.name}</h2><p className="sub">{form.verified_at ? `Verified ${fmtDate(form.verified_at)}` : 'Never verified'} · source: {form.source}{form.position_estimated ? ' · pin position estimated' : ''}</p></div>
          <div className="toolbar"><button className="btn green" disabled={busy} onClick={() => save({ verify: true })}>Save and mark verified</button><button className="btn primary" disabled={busy} onClick={() => save()}>Save</button></div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="grid2">
          <label className="f">Name<input className="i" value={form.name} onChange={e => set({ name: e.target.value })} /></label>
          <label className="f">Category<select className="i" value={form.category} onChange={e => set({ category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label className="f">Description<textarea className="i" value={form.description ?? ''} onChange={e => set({ description: e.target.value })} /></label>
        <div className="grid2">
          <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Schools with offices here
            <div className="chips">{SCHOOLS.map(([sid, name]) => (
              <label key={sid} className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={form.schools.includes(sid)} onChange={e => set({ schools: e.target.checked ? [...form.schools, sid] : form.schools.filter(x => x !== sid) })} />{name}</label>
            ))}</div>
          </div>
          <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Aliases (what people type or say)<Tags value={form.aliases} onChange={aliases => set({ aliases })} placeholder="Add an alias, press Enter" /></div>
        </div>
      </div>

      <div className="card stack">
        <p className="label">Position and entrances · drag to move</p>
        <PinMap center={form.coordinates} background={others.filter(o => o.id !== id).map(o => ({ coord: o.coordinates, color: CAT_COLOR[o.category] }))}
          pins={[{ id: 'place', coord: form.coordinates, color: CAT_COLOR[form.category], label: form.name, draggable: true }, ...form.entrances.map(e => ({ id: e.id, coord: e.coordinates, color: '#16A34A', label: e.name, draggable: true }))]}
          onMove={(pid, c) => (pid === 'place' ? save({ coordinates: c }) : moveEntrance(pid, c))} />
        <table><thead><tr><th>Entrance</th><th>Step-free</th><th>Position</th></tr></thead><tbody>
          {form.entrances.map(e => (
            <tr key={e.id}><td><input className="i" defaultValue={e.name} onBlur={ev => ev.target.value !== e.name && api.saveEntrance(e.id, { name: ev.target.value }).then(reload)} aria-label="Entrance name" /></td>
              <td><input type="checkbox" checked={e.step_free} onChange={ev => api.saveEntrance(e.id, { step_free: ev.target.checked }).then(reload)} aria-label="Step-free" /></td>
              <td>{e.estimated ? <span className="pill miss">estimated · drag the green pin</span> : <span className="pill ok">confirmed</span>}</td></tr>
          ))}
        </tbody></table>
      </div>

      <div className="card stack">
        <p className="label">Opening hours · an empty day publishes “no hours”, never a guess</p>
        <HoursEditor value={form.hours} onChange={(hours: Hours | null) => set({ hours })} />
      </div>

      <div className="card stack">
        <p className="label">Status</p>
        <div className="grid3">
          <label className="f">Status<select className="i" value={form.status} onChange={e => set({ status: e.target.value as 'open' | 'closed' })}><option value="open">open</option><option value="closed">closed</option></select></label>
          <label className="f">Reason shown<input className="i" value={form.closed_reason ?? ''} disabled={form.status !== 'closed'} onChange={e => set({ closed_reason: e.target.value })} /></label>
          <label className="f">Until<input className="i" type="date" value={form.closed_until?.slice(0, 10) ?? ''} disabled={form.status !== 'closed'} onChange={e => set({ closed_until: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
        </div>
        <label className="f" style={{ maxWidth: 240 }}>Review every (months)<input className="i" type="number" min={1} max={36} value={form.review_months} onChange={e => set({ review_months: Number(e.target.value) })} /></label>
      </div>
    </div>
  );
}
