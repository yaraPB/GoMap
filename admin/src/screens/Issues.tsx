import { useEffect, useMemo, useState } from 'react';
import { Link2Off, MapPinOff, Plus, Search, Signpost, Trash2, X } from 'lucide-react';
import { api, type Issue, type Service } from '../api';
import { CampusMap, Notice, Tags, useLoad, type MapPoint } from '../ui';

export const SERVICE_COLOR: Record<string, string> = { academic: '#2563EB', money: '#0B7A47', wellbeing: '#D9467A', campus_life: '#E0841F', it: '#7C3AED', admin: '#4F46E5', service: '#64748B' };

type Draft = { issue: string; service_id: string | null; go_to: string; location_text: string; place_id: string | null; notes: string; keywords: string[] };
const draftOf = (i?: Issue | null): Draft => ({ issue: i?.issue ?? '', service_id: i?.service_id ?? null, go_to: i?.go_to ?? '', location_text: i?.location_text ?? '', place_id: i?.place?.id ?? null, notes: i?.notes ?? '', keywords: i?.keywords ?? [] });

/**
 * "I have problem X, where do I go?" The map shows which offices carry the load; the table is
 * read-only and scannable; clicking a row opens the editor in a drawer that pushes the table aside.
 */
export default function Issues() {
  const list = useLoad(api.issues);
  const services = useLoad(api.services);
  const places = useLoad(api.places);
  const [q, setQ] = useState('');
  const [office, setOffice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [toast, setToast] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);

  const byService = useMemo(() => new Map((services.data ?? []).map(s => [s.id, s])), [services.data]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const i of list.data ?? []) if (i.service_id) m.set(i.service_id, (m.get(i.service_id) ?? 0) + 1); return m; }, [list.data]);
  const rows = (list.data ?? []).filter(i => (!office || (office === 'unlinked' ? !i.service_id : i.service_id === office))
    && (!q || `${i.issue} ${i.go_to} ${i.keywords.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const coord = (pid?: string | null) => places.data?.find(p => p.id === pid)?.coordinates;
  // one marker per office that solves something, sized by how many problems route there
  const points: MapPoint[] = (services.data ?? []).flatMap(s => {
    const base = coord(s.places[0]?.id); const n = counts.get(s.id) ?? 0;
    // offices in the same building fan out around it instead of hiding each other
    const same = (services.data ?? []).filter(x => x.places[0]?.id === s.places[0]?.id && (counts.get(x.id) ?? 0) > 0);
    const k = same.findIndex(x => x.id === s.id), ang = (k / Math.max(1, same.length)) * Math.PI * 2, r = same.length > 1 ? 0.00016 : 0;
    const c: [number, number] | undefined = base ? [base[0] + Math.cos(ang) * r, base[1] + Math.sin(ang) * r * 0.85] : undefined;
    return c && n ? [{ id: s.id, coord: c, color: SERVICE_COLOR[s.category] ?? '#64748B', label: `${s.short_name}: ${n} problems`, text: String(n), size: 22 + Math.min(18, n * 3), dim: !!office && office !== s.id }] : [];
  });
  const current = open && open !== 'new' ? list.data?.find(i => i.id === open) ?? null : null;
  const unlinked = (list.data ?? []).filter(i => !i.service_id).length;
  const noPin = (list.data ?? []).filter(i => !i.place).length;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      <div className="head">
        <div><h1>Where to go for…</h1><p className="sub">Student problems and the office that solves them. The assistant answers with the office’s hours, contact and directions.</p></div>
        <button className="btn dark" onClick={() => setOpen('new')}><Plus size={15} />New problem</button>
      </div>

      <CampusMap points={points} selected={office && office !== 'unlinked' ? office : null} onSelect={id => setOffice(office === id ? null : id)} height={340}>
        <div className="glass"><Signpost size={15} style={{ margin: '0 4px 0 6px', color: 'var(--muted)' }} /><span style={{ fontSize: 12.5, paddingRight: 6 }}>Bigger circle = more problems routed there · click to filter</span></div>
        {office && <div className="glass"><span className="chip on">{office === 'unlinked' ? 'Not linked' : byService.get(office)?.short_name}<button style={{ color: '#fff' }} aria-label="Clear filter" onClick={() => setOffice(null)}><X size={12} /></button></span></div>}
      </CampusMap>

      <div className="tiles">
        <div className="tile"><div className="l">Problems answered</div><div className="v">{list.data?.length ?? '…'}</div></div>
        <div className="tile"><div className="l">Offices that solve them</div><div className="v">{counts.size}</div></div>
        <button className="tile" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOffice('unlinked')}><div className="l"><Link2Off size={13} /> Not linked to an office</div><div className="v">{unlinked}</div></button>
        <div className="tile"><div className="l"><MapPinOff size={13} /> Without a map pin</div><div className="v">{noPin}</div></div>
      </div>

      {toast && <div style={{ marginBottom: 12 }}><Notice tone={toast.tone}>{toast.text}</Notice></div>}
      <div className={`with-drawer ${open ? 'open' : ''}`}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="toolbar" style={{ padding: 12, borderBottom: '1px solid var(--hair)' }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
              <input className="search" style={{ paddingLeft: 32 }} placeholder="Search problems and the words students use" value={q} onChange={e => setQ(e.target.value)} aria-label="Search problems" />
            </div>
            <div className="chips">
              <button className={`chip ${!office ? 'on' : ''}`} onClick={() => setOffice(null)}>All</button>
              {top.map(([sid, n]) => <button key={sid} className={`chip ${office === sid ? 'on' : ''}`} onClick={() => setOffice(office === sid ? null : sid)}><span className="dot" style={{ width: 8, height: 8, background: SERVICE_COLOR[byService.get(sid)?.category ?? 'service'] }} />{byService.get(sid)?.short_name} · {n}</button>)}
            </div>
          </div>
          <div className="tablewrap" style={{ maxHeight: 560 }}>
            <table>
              <thead><tr><th style={{ width: '42%' }}>Problem</th><th>Office</th><th>Where</th><th>Words students use</th></tr></thead>
              <tbody>
                {rows.map(i => {
                  const s = i.service_id ? byService.get(i.service_id) : undefined;
                  return (
                    <tr key={i.id} className={`click ${open === i.id ? 'on' : ''}`} onClick={() => setOpen(i.id)}>
                      <td><b style={{ fontWeight: 600 }}>{i.issue}</b>{i.notes && <div className="sub" style={{ fontSize: 12, margin: 0 }}>{i.notes}</div>}</td>
                      <td>{s ? <span className="pill" style={{ background: `${SERVICE_COLOR[s.category]}1A`, color: SERVICE_COLOR[s.category] }}>{s.short_name}</span> : <span className="pill miss">{i.go_to || 'Not linked'}</span>}</td>
                      <td style={{ color: 'var(--ink2)' }}>{i.place?.name ?? i.location_text ?? <span className="pill miss">no pin</span>}</td>
                      <td><div className="chips" style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>{i.keywords.slice(0, 2).map(k => <span key={k} className="chip" style={{ whiteSpace: 'nowrap' }}>{k}</span>)}{i.keywords.length > 2 && <span className="chip">+{i.keywords.length - 2}</span>}</div></td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={4} className="empty">Nothing matches. Clear the filter, or add the problem.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="drawer">
          {open && <IssueEditor key={open} issue={current} services={services.data ?? []} places={places.data ?? []}
            onClose={() => setOpen(null)}
            onSaved={(text, id) => { setToast({ tone: 'ok', text }); list.reload(); if (id) setOpen(id); }}
            onError={text => setToast({ tone: 'miss', text })} />}
        </div>
      </div>
    </>
  );
}

function IssueEditor({ issue, services, places, onClose, onSaved, onError }: {
  issue: Issue | null; services: Service[]; places: { id: string; name: string }[];
  onClose: () => void; onSaved: (text: string, id?: string) => void; onError: (text: string) => void;
}) {
  const [d, setD] = useState<Draft>(draftOf(issue));
  useEffect(() => setD(draftOf(issue)), [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (sid: string) => {
    const s = services.find(x => x.id === sid);
    setD({ ...d, service_id: sid || null, go_to: s ? s.name : d.go_to, location_text: s?.location_text ?? d.location_text, place_id: s?.places[0]?.id ?? d.place_id });
  };
  const save = async () => {
    try {
      const body = { ...d, service_id: d.service_id || null, place_id: d.place_id || null };
      if (issue) { await api.saveIssue(issue.id, body); onSaved('Saved. The assistant routes this problem now.'); }
      else { const created = await api.createIssue(body); onSaved('Added. The assistant routes this problem now.', created.id); }
    } catch (e) { onError((e as Error).message); }
  };
  const remove = async () => {
    if (!issue || !confirm(`Delete “${issue.issue}”?`)) return;
    try { await api.deleteIssue(issue.id); onSaved('Deleted.'); onClose(); } catch (e) { onError((e as Error).message); }
  };
  const s = services.find(x => x.id === d.service_id);
  return (
    <div className="card stack">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <b style={{ fontSize: 15 }}>{issue ? 'Edit problem' : 'New problem'}</b>
        <button className="btn sm ghost" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <label className="f">What the student says<textarea className="i" rows={2} value={d.issue} placeholder="e.g. Lost my student card" onChange={e => setD({ ...d, issue: e.target.value })} /></label>
      <label className="f">Office that solves it
        <select className="i" value={d.service_id ?? ''} onChange={e => pick(e.target.value)}>
          <option value="">Not linked (type a name below)</option>
          {services.map(x => <option key={x.id} value={x.id}>{x.short_name}</option>)}
        </select>
      </label>
      {!d.service_id && <label className="f">Go to<input className="i" value={d.go_to} onChange={e => setD({ ...d, go_to: e.target.value })} placeholder="e.g. Your school’s dean" /></label>}
      {s && <div className="notice info" style={{ fontSize: 12.5 }}>{s.short_name}: {s.location_text ?? 'location not published'}{s.extension ? ` · ext. ${s.extension}` : ''}{s.hours_text ? ` · ${s.hours_text}` : ''}</div>}
      <div className="grid2">
        <label className="f">Where (as written)<input className="i" value={d.location_text} onChange={e => setD({ ...d, location_text: e.target.value })} /></label>
        <label className="f">Map pin (directions go here)
          <select className="i" value={d.place_id ?? ''} onChange={e => setD({ ...d, place_id: e.target.value || null })}>
            <option value="">None</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <label className="f">Note for the student<input className="i" value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} placeholder="e.g. Emergency: ext. 2222, 24/7" /></label>
      <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Words students use (EN / FR / AR)<Tags value={d.keywords} onChange={keywords => setD({ ...d, keywords })} placeholder="e.g. lost card, carte perdue — Enter" /></div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        {issue ? <button className="btn danger" onClick={remove}><Trash2 size={15} />Delete</button> : <span />}
        <div className="toolbar"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!d.issue.trim() || !(d.go_to.trim() || d.service_id)} onClick={save}>{issue ? 'Save' : 'Add'}</button></div>
      </div>
    </div>
  );
}
