import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate, SERVICE_CATEGORIES, type CampusHours, type Service } from '../api';
import { CampusMap, HoursField, Notice, Tags, TimeField, useLoad, type MapPoint } from '../ui';
import { BadgeCheck, Save, Trash2, X } from 'lucide-react';

const EMPTY: Service = {
  id: 'new', name: '', short_name: '', category: 'service', handles: [], keywords: [], places: [], location_text: '', room: null, email: '', extension: '', phone: '',
  hours: null, hours_text: null, hours_raw: null, notes: null, open: { state: 'not_published' }, verified_at: null, stale: true, source: 'Admin', admin_edited: true, updated_at: '',
};

/** Offices and student services: what the assistant tells a student who asks "where do I go for…". */
export default function Services({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const list = useLoad(api.services);
  const campus = useLoad(api.campus);
  const placesAll = useLoad(api.places);
  // offices share buildings: fan them out a little around the building pin
  const points: MapPoint[] = (list.data ?? []).flatMap((s, i) => {
    const c = placesAll.data?.find(p => p.id === s.places[0]?.id)?.coordinates;
    if (!c) return [];
    const same = (list.data ?? []).filter(x => x.places[0]?.id === s.places[0]?.id);
    const k = same.findIndex(x => x.id === s.id), n = same.length, a = (k / Math.max(1, n)) * Math.PI * 2;
    const r = n > 1 ? 0.00012 : 0;
    return [{ id: s.id, coord: [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * 0.85] as [number, number], label: s.short_name, text: s.short_name.slice(0, 2).toUpperCase(),
      color: s.open.state === 'open' ? '#0B7A47' : s.open.state === 'closed' ? '#94A3B8' : '#E0841F', size: 28 }];
  });

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const shown = useMemo(() => (list.data ?? []).filter(s => (cat === 'all' || s.category === cat)
    && (!q || `${s.name} ${s.short_name} ${s.handles.join(' ')} ${s.location_text ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, cat]);
  return (
    <>
      <div className="head">
        <div><h1>Offices & services</h1><p className="sub">Each office, where it is, its hours and what it handles. The assistant answers student problems from this list.</p></div>
        <button className="btn dark" onClick={() => select('new')}>New office</button>
      </div>
      <CampusMap points={points} selected={selected} onSelect={id => select(id)} height={360}>
        <div className="glass"><div className="legend"><span><i className="dot" style={{ background: '#0B7A47' }} />Open now</span><span><i className="dot" style={{ background: '#94A3B8' }} />Closed</span><span><i className="dot" style={{ background: '#E0841F' }} />No hours</span></div></div>
      </CampusMap>
      {campus.data && <CampusHoursCard value={campus.data} onSaved={() => { campus.reload(); list.reload(); }} />}
      <div className="split" style={{ marginTop: 16 }}>
        <div className="card" style={{ padding: 10 }}>
          <input className="search" placeholder="Office, building or need (e.g. transcript)" value={q} onChange={e => setQ(e.target.value)} aria-label="Find an office" style={{ marginBottom: 8 }} />
          <select className="i" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" style={{ width: '100%', marginBottom: 6 }}>
            <option value="all">All categories</option>{SERVICE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {list.error && <Notice tone="miss">{list.error}</Notice>}
          <div className="list" style={{ maxHeight: '64vh', overflow: 'auto' }}>
            {shown.map(s => (
              <button key={s.id} className={`row ${selected === s.id ? 'on' : ''}`} onClick={() => select(s.id)}>
                <span className="grow"><b>{s.short_name}</b><small>{s.location_text ?? 'location not published'}{s.extension ? ` · ext. ${s.extension}` : ''}</small></span>
                <span className={`pill ${s.open.state === 'open' ? 'ok' : s.open.state === 'closed' ? '' : 'miss'}`}>{s.open.state === 'open' ? 'open' : s.open.state === 'closed' ? 'closed' : 'no hours'}</span>
              </button>
            ))}
          </div>
        </div>
        {selected
          ? <Editor key={selected} initial={selected === 'new' ? EMPTY : list.data?.find(s => s.id === selected) ?? null} lunch={campus.data?.lunch}
              onSaved={id => { list.reload(); select(id); }} onDeleted={() => { list.reload(); select(''); }} />
          : <div className="card empty">Choose an office to edit it.</div>}
      </div>
    </>
  );
}

function CampusHoursCard({ value, onSaved }: { value: CampusHours; onSaved: () => void }) {
  const [f, setF] = useState(value);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  useEffect(() => setF(value), [value]);
  const save = async () => {
    try { await api.saveCampus({ open: f.open, close: f.close, lunch: f.lunch, emergencies: f.emergencies ?? '' }); setMsg({ tone: 'ok', text: 'Saved. Lunch shows on every office and professor card.' }); onSaved(); }
    catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <div><p className="label" style={{ margin: 0 }}>Campus working hours</p><p className="sub" style={{ margin: 0 }}>Applies to every office that does not list its own hours.</p></div>
        <div className="toolbar">
          <TimeField label="Open" value={f.open} onChange={v => setF({ ...f, open: v })} presets={['08:00', '08:30', '09:00']} />
          <TimeField label="Close" value={f.close} onChange={v => setF({ ...f, close: v })} presets={['17:00', '17:30', '18:00']} />
          <TimeField label="Lunch from" value={f.lunch[0]} onChange={v => setF({ ...f, lunch: [v, f.lunch[1]] })} presets={['12:00', '12:30', '13:00']} />
          <TimeField label="to" value={f.lunch[1]} onChange={v => setF({ ...f, lunch: [f.lunch[0], v] })} presets={['13:00', '13:30', '14:00']} />
          <label className="f" style={{ minWidth: 260 }}>Emergencies<input className="i" value={f.emergencies ?? ''} onChange={e => setF({ ...f, emergencies: e.target.value })} /></label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={save}>Save</button>
        </div>
      </div>
      {msg && <div style={{ marginTop: 10 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
    </div>
  );
}

function Editor({ initial, lunch, onSaved, onDeleted }: { initial: Service | null; lunch?: [string, string]; onSaved: (id: string) => void; onDeleted: () => void }) {
  const places = useLoad(api.places);
  const [f, setF] = useState<Service | null>(initial);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Awaited<ReturnType<typeof api.ask>> | null>(null);
  useEffect(() => { setF(initial); setQuestion(initial?.handles[0] ? `Where do I go for ${initial.handles[0].toLowerCase()}?` : ''); setAnswer(null); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div className="card empty">Loading…</div>;
  const body = () => ({
    name: f.name, short_name: f.short_name, category: f.category, handles: f.handles, keywords: f.keywords, place_ids: f.places.map(p => p.id),
    location_text: f.location_text ?? '', room: f.room ?? '', email: f.email ?? '', extension: f.extension ?? '', phone: f.phone ?? '', hours: f.hours, notes: f.notes ?? '',
  });
  const save = async (extra: Record<string, unknown> = {}) => {
    setMsg(null);
    try {
      const saved = f.id === 'new' ? await api.createService({ ...body(), ...extra }) : await api.saveService(f.id, { ...body(), ...extra });
      setMsg({ tone: 'ok', text: 'Saved. The app and the assistant use it now.' });
      onSaved(saved.id);
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  const remove = async () => {
    if (!confirm(`Delete ${f.name}? Issues routed to it will lose their office link.`)) return;
    try { await api.deleteService(f.id); onDeleted(); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  const ask = async () => { try { setAnswer(await api.ask(question)); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } };
  const placeOptions = (places.data ?? []).filter(p => !f.places.some(x => x.id === p.id));
  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={{ fontSize: 20 }}>{f.id === 'new' ? 'New office' : f.name}</h2>
            <p className="sub">{f.verified_at ? `Verified ${fmtDate(f.verified_at)}` : 'Not verified'}{f.admin_edited ? ' · edited here (the JSON import will not overwrite it)' : ` · from ${f.source}`}</p></div>
          <div className="toolbar">
            {f.id !== 'new' && <button className="btn danger" onClick={remove}><Trash2 size={15} />Delete</button>}
            <button className="btn green" onClick={() => save({ verify: true })}><BadgeCheck size={15} />Save and verify</button>
            <button className="btn primary" onClick={() => save()}><Save size={15} />Save</button>
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <p className="label" style={{ margin: 0 }}>Opening hours</p>
        {f.hours_raw && <p className="sub" style={{ margin: 0 }}>Published as: “{f.hours_raw}”</p>}
        <HoursField value={f.hours} lunch={lunch} onChange={hours => setF({ ...f, hours })} />
      </div>
      <div className="card stack">
        <p className="label" style={{ margin: 0 }}>Details</p>
        <div className="grid2">
          <label className="f">Full name<input className="i" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="f">Short name (said by the assistant)<input className="i" value={f.short_name} onChange={e => setF({ ...f, short_name: e.target.value })} /></label>
          <label className="f">Category<select className="i" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{SERVICE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="f">Location as written<input className="i" value={f.location_text ?? ''} placeholder="Building 1, Room 12" onChange={e => setF({ ...f, location_text: e.target.value })} /></label>
          <label className="f">Email<input className="i" type="email" value={f.email ?? ''} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <div className="grid2">
            <label className="f">Extension<input className="i" value={f.extension ?? ''} onChange={e => setF({ ...f, extension: e.target.value })} /></label>
            <label className="f">Room<input className="i" value={f.room ?? ''} onChange={e => setF({ ...f, room: e.target.value })} /></label>
          </div>
          <label className="f">Phone<input className="i" value={f.phone ?? ''} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
        </div>
        <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>Map pins (first = main desk, where “guide me” goes)</span>
          <div className="chips">
            {f.places.map((p, i) => <span key={p.id} className="chip">{i === 0 ? '★ ' : ''}{p.name}{!p.known && ' (not on the map)'}<button aria-label={`Remove ${p.name}`} onClick={() => setF({ ...f, places: f.places.filter(x => x.id !== p.id) })}><X size={12} /></button></span>)}
          </div>
          <select className="i" value="" onChange={e => { const p = places.data?.find(x => x.id === e.target.value); if (p) setF({ ...f, places: [...f.places, { id: p.id, name: p.name, known: true }] }); }} aria-label="Add a map pin">
            <option value="">Add a building…</option>{placeOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <label className="f">What it handles (one per line)
          <textarea className="i" rows={4} value={f.handles.join('\n')} onChange={e => setF({ ...f, handles: e.target.value.split('\n') })} onBlur={() => setF({ ...f, handles: f.handles.map(h => h.trim()).filter(Boolean) })} />
        </label>
        <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>Words students use (EN / FR / AR)</span>
          <Tags value={f.keywords} onChange={keywords => setF({ ...f, keywords })} placeholder="e.g. lost my card, frais, منحة — press Enter" />
        </div>
        <label className="f">Note shown with the hours<textarea className="i" value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="By appointment only, doctor on call 24/7…" /></label>
      </div>
      {f.id !== 'new' && (
        <div className="card stack">
          <p className="label" style={{ margin: 0 }}>Ask as a student</p>
          <div className="toolbar"><input className="i" style={{ flex: 1 }} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} /><button className="btn" onClick={ask}>Ask</button></div>
          {answer && (
            <Notice tone={answer.service?.id === f.id ? 'ok' : 'warn'}>
              <span>{answer.alert && <b>{answer.alert.text} </b>}{answer.text}<br /><small>{answer.service ? `Answered with ${answer.service.short_name}` : `Intent: ${answer.intent}`} · {answer.answered_by}</small></span>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
