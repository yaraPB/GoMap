import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, type Hours, type Person } from '../api';
import { HoursEditor, Notice, useLoad } from '../ui';

/** Board 26: offices and hours. Resolve conflicts between sources, fill gaps, edit hours day by day. */
export default function Offices({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const people = useLoad(api.people);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'conflict' | 'missing' | 'stale'>('all');
  const list = useMemo(() => (people.data ?? []).filter(p => (!q || `${p.name} ${p.office_number ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    && (filter === 'all' || (filter === 'conflict' && p.conflict) || (filter === 'missing' && p.missing.length) || (filter === 'stale' && p.stale))), [people.data, q, filter]);
  const count = (f: typeof filter) => (people.data ?? []).filter(p => (f === 'conflict' ? p.conflict : f === 'missing' ? p.missing.length : p.stale)).length;
  return (
    <>
      <div className="head"><div><h1>Offices & hours</h1><p className="sub">From the school directories on aui.ma. An empty day publishes “no office hours”, never a guess.</p></div></div>
      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <input className="search" placeholder="Name or office number" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person" style={{ marginBottom: 8 }} />
          <div className="toolbar" style={{ marginBottom: 6 }}>
            {(['all', 'conflict', 'missing', 'stale'] as const).map(f => <button key={f} className={`btn sm ${filter === f ? 'dark' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : `${f === 'conflict' ? 'Conflicts' : f === 'missing' ? 'Missing' : 'Past review'} · ${count(f)}`}</button>)}
          </div>
          <div className="list" style={{ maxHeight: '68vh', overflow: 'auto' }}>
            {list.map(p => (
              <button key={p.id} className={`row ${selected === p.id ? 'on' : ''}`} onClick={() => select(p.id)}>
                <span className="grow"><b>{p.name}</b><small>{p.place ? `${p.place.name}${p.office_number ? `, ${p.office_number}` : ''}` : 'no office'} · {p.department?.id}</small></span>
                {p.conflict ? <span className="pill miss">conflict</span> : p.missing.length ? <span className="pill busy">{p.missing.length} missing</span> : null}
              </button>
            ))}
          </div>
        </div>
        {selected ? <PersonEditor key={selected} id={selected} onSaved={people.reload} /> : <div className="card empty">Choose a person to edit their office and hours.</div>}
      </div>
    </>
  );
}

function PersonEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { data, error, reload } = useLoad(() => api.person(id), [id]);
  const places = useLoad(api.places);
  const [f, setF] = useState<Person | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <Notice tone="miss">{error}</Notice>;
  if (!f) return <div className="card empty">Loading…</div>;
  const save = async (extra: Record<string, unknown> = {}) => {
    setMsg(null);
    try {
      await api.savePerson(id, { title: f.title ?? '', email: f.email ?? '', phone: f.phone ?? '', place_id: f.place?.id ?? null, office_number: f.office_number ?? '', floor: f.floor, office_hours: f.hours, ...extra });
      setMsg({ tone: 'ok', text: 'Saved. The office list, the professor card and the assistant use it now.' });
      reload(); onSaved();
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={{ fontSize: 20 }}>{f.name}</h2><p className="sub">{f.department?.name} · {f.role} · {f.verified_at ? `verified ${fmtDate(f.verified_at)}` : 'never verified'}</p></div>
          <div className="toolbar"><button className="btn green" onClick={() => save({ verify: true })}>Save and mark verified</button><button className="btn primary" onClick={() => save()}>Save</button></div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {f.conflict && (
          <div className="notice miss" style={{ flexDirection: 'column' }}>
            <b>The sources disagree on the {f.conflict.field.replace('_', ' ')}. Pick the right one:</b>
            <div className="toolbar">
              {f.conflict.values.map(v => (
                <button key={v.source} className="btn sm" onClick={() => save({ office_number: v.value, place_id: v.place_id, resolve_conflict: true, verify: true })}>
                  Office {v.value} · {v.source}
                </button>
              ))}
            </div>
          </div>
        )}
        {f.missing.length > 0 && <Notice>Not published: {f.missing.join(', ')}. The app says so instead of guessing.</Notice>}
        <div className="grid2">
          <label className="f">Title<input className="i" value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <label className="f">Email<input className="i" type="email" value={f.email ?? ''} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <label className="f">Building<select className="i" value={f.place?.id ?? ''} onChange={e => setF({ ...f, place: e.target.value ? { id: e.target.value, name: e.target.selectedOptions[0].text } : null })}>
            <option value="">Not published</option>{(places.data ?? []).filter(p => ['academic', 'admin', 'services'].includes(p.category)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <div className="grid2">
            <label className="f">Office<input className="i" value={f.office_number ?? ''} onChange={e => setF({ ...f, office_number: e.target.value })} /></label>
            <label className="f">Floor<input className="i" type="number" value={f.floor ?? ''} onChange={e => setF({ ...f, floor: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>
          <label className="f">Phone<input className="i" value={f.phone ?? ''} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        </div>
      </div>
      <div className="card stack">
        <p className="label">Office hours</p>
        {f.hours_raw && <p className="sub" style={{ margin: 0 }}>Posted on aui.ma as: “{f.hours_raw}”</p>}
        <HoursEditor value={f.hours} onChange={(hours: Hours | null) => setF({ ...f, hours })} />
      </div>
    </div>
  );
}
