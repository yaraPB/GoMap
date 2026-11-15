import { useEffect, useMemo, useState } from 'react';
import { Accessibility, BadgeCheck, DoorOpen, Lock, MapPin, Save, Search } from 'lucide-react';
import { api, CAT_COLOR, CATEGORIES, fmtDate, SCHOOLS, type Hours, type PlaceDetail } from '../api';
import { CampusMap, HoursField, Notice, Tags, useLoad, type MapPoint } from '../ui';

/** What each kind of place can carry. Locked fields say why, so nobody wonders where they went. */
const RULES: Record<string, { hours: string | null; hoursLocked?: string; schools: boolean; entrances: boolean; entrancesLocked?: string; hint: string }> = {
  academic: { hours: 'Building opening hours', schools: true, entrances: true, hint: 'Offices inside come from Faculty & staff.' },
  admin: { hours: 'Office hours', schools: false, entrances: true, hint: 'Services located here are edited in Offices & services.' },
  services: { hours: 'Opening hours', schools: false, entrances: true, hint: 'Services located here are edited in Offices & services.' },
  dining: { hours: 'Meal times', schools: false, entrances: true, hint: 'Shown to students as open or closed right now.' },
  residential: { hours: null, hoursLocked: 'Residences are for residents: no public opening hours.', schools: false, entrances: true, hint: 'Visitors are not routed inside residences.' },
  athletics: { hours: 'Opening hours', schools: false, entrances: true, hint: 'Close it here during matches or maintenance.' },
  facilities: { hours: null, hoursLocked: 'Car parks and grounds are open access: no opening hours.', schools: false, entrances: false, entrancesLocked: 'Routes end at the pin itself.', hint: 'Use Status to close a car park for an event.' },
};
const LABEL: Record<string, string> = { academic: 'Academic', admin: 'Administration', services: 'Services', dining: 'Dining', residential: 'Residential', athletics: 'Sports', facilities: 'Parking & grounds' };

/** Board 25: the campus map first; click a building to edit what its category allows. */
export default function Places({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const list = useLoad(api.places);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const match = (p: { name: string; aliases: string[]; category: string }) => (!cat || p.category === cat) && (!q || `${p.name} ${p.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const items = useMemo(() => (list.data ?? []).filter(match), [list.data, q, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useLoad(() => (selected ? api.place(selected) : Promise.resolve(null)), [selected]);
  const [entranceSel, setEntranceSel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const points: MapPoint[] = [
    ...(list.data ?? []).map(p => ({ id: p.id, coord: p.coordinates, color: p.status === 'closed' ? '#6B7280' : CAT_COLOR[p.category], label: p.name, text: p.number ?? '', dim: !match(p), size: p.number ? 26 : 20 })),
    ...(detail.data?.entrances ?? []).map(e => ({ id: `e:${e.id}`, coord: e.coordinates, color: '#16A34A', label: `${e.name} (entrance)`, size: 16 })),
  ];
  const onMove = async (id: string, c: [number, number]) => {
    try {
      if (id.startsWith('e:')) await api.saveEntrance(id.slice(2), { coordinates: c });
      else await api.savePlace(id, { coordinates: c });
      setToast(id.startsWith('e:') ? 'Entrance moved. Routes now end at the new door.' : 'Pin moved and confirmed.');
      list.reload(); detail.reload();
    } catch (e) { setToast((e as Error).message); }
  };

  return (
    <>
      <div className="head"><div><h1>Places & POIs</h1><p className="sub">{list.data?.length ?? '…'} places. Click a building on the map; drag the selected pin to move it.</p></div></div>
      <CampusMap points={points} selected={entranceSel ? `e:${entranceSel}` : selected} onSelect={id => { if (id.startsWith('e:')) setEntranceSel(id.slice(2)); else { setEntranceSel(null); select(id); } }} onMove={onMove} height={420}>
        <div className="glass">
          <Search size={15} style={{ marginLeft: 6, color: 'var(--muted)' }} />
          <input className="search" style={{ width: 200, height: 32, border: 0, background: 'transparent' }} placeholder="Find a place" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a place" />
        </div>
        <div className="glass">
          <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All</button>
          {CATEGORIES.map(c => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)}><span className="dot" style={{ background: CAT_COLOR[c], width: 8, height: 8 }} />{LABEL[c]}</button>)}
        </div>
      </CampusMap>
      {toast && <div style={{ marginBottom: 12 }}><Notice tone="ok">{toast}</Notice></div>}

      <div className="split">
        <div className="card" style={{ padding: 8 }}>
          <p className="label" style={{ padding: '6px 6px 0' }}>{items.length} shown</p>
          <div className="list" style={{ maxHeight: 520, overflow: 'auto' }}>
            {items.map(p => (
              <button key={p.id} className={`row ${selected === p.id ? 'on' : ''}`} onClick={() => { setEntranceSel(null); select(p.id); }}>
                <span className="dot" style={{ background: CAT_COLOR[p.category] }} />
                <span className="grow"><b>{p.name}</b><small>{LABEL[p.category]}{p.people_count ? ` · ${p.people_count} offices` : ''}</small></span>
                {p.status === 'closed' && <span className="pill miss">closed</span>}
                {p.position_estimated ? <span className="pill miss">pin?</span> : !p.verified && <span className="pill busy">unverified</span>}
              </button>
            ))}
          </div>
        </div>
        {selected && detail.data ? <PlaceEditor key={selected} place={detail.data} onSaved={() => { list.reload(); detail.reload(); }} /> : <div className="card empty"><MapPin size={22} /><p>Click a building on the map or in the list.</p></div>}
      </div>
    </>
  );
}

function PlaceEditor({ place, onSaved }: { place: PlaceDetail; onSaved: () => void }) {
  const [form, setForm] = useState<PlaceDetail>(place);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(place), [place]);
  const rule = RULES[form.category] ?? RULES.services;
  const set = (patch: Partial<PlaceDetail>) => setForm({ ...form, ...patch });
  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setMsg(null);
    try {
      await api.savePlace(place.id, { name: form.name, category: form.category, aliases: form.aliases, description: form.description ?? '',
        ...(rule.schools ? { schools: form.schools } : {}), ...(rule.hours ? { hours: form.hours } : {}),
        status: form.status, closed_reason: form.closed_reason, closed_until: form.closed_until, review_months: form.review_months, ...extra });
      setMsg({ tone: 'ok', text: 'Saved. The app picks it up within seconds.' });
      onSaved();
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 20 }}>{place.name}</h2>
            <p className="sub">{LABEL[form.category]} · {form.verified_at ? `verified ${fmtDate(form.verified_at)}` : 'never verified'}{form.position_estimated ? ' · pin position estimated' : ''}</p>
          </div>
          <div className="toolbar">
            <button className="btn green" disabled={busy} onClick={() => save({ verify: true })}><BadgeCheck size={15} />Save and verify</button>
            <button className="btn primary" disabled={busy} onClick={() => save()}><Save size={15} />Save</button>
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="grid2">
          <label className="f">Name<input className="i" value={form.name} onChange={e => set({ name: e.target.value })} /></label>
          <label className="f">Category<select className="i" value={form.category} onChange={e => set({ category: e.target.value })}>{CATEGORIES.map(c => <option key={c} value={c}>{LABEL[c]}</option>)}</select></label>
        </div>
        <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>{rule.hint}</p>
        <label className="f">Description<textarea className="i" value={form.description ?? ''} onChange={e => set({ description: e.target.value })} /></label>
        <div className="grid2">
          {rule.schools ? (
            <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Schools with offices here
              <div className="chips">{SCHOOLS.map(([sid, name]) => (
                <button key={sid} type="button" className={`chip ${form.schools.includes(sid) ? 'on' : ''}`} onClick={() => set({ schools: form.schools.includes(sid) ? form.schools.filter(x => x !== sid) : [...form.schools, sid] })}>{name}</button>
              ))}</div>
            </div>
          ) : <div className="locked"><Lock size={14} />Schools only apply to academic buildings.</div>}
          <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Other names people type or say<Tags value={form.aliases} onChange={aliases => set({ aliases })} placeholder="Add a name, press Enter" /></div>
        </div>
      </div>

      <div className="card stack">
        <p className="label" style={{ margin: 0 }}>{rule.hours ?? 'Opening hours'}</p>
        {rule.hours ? <HoursField value={form.hours} onChange={(hours: Hours | null) => set({ hours })} /> : <div className="locked"><Lock size={14} />{rule.hoursLocked}</div>}
      </div>

      <div className="cols">
        <div className="card stack">
          <p className="label" style={{ margin: 0 }}>Entrances</p>
          {rule.entrances ? (
            form.entrances.length ? (
              <table><tbody>
                {form.entrances.map(e => (
                  <tr key={e.id}>
                    <td><DoorOpen size={15} color="var(--green)" /></td>
                    <td><input className="i" defaultValue={e.name} onBlur={ev => ev.target.value !== e.name && api.saveEntrance(e.id, { name: ev.target.value }).then(onSaved)} aria-label="Entrance name" /></td>
                    <td title="Step-free"><label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={e.step_free} onChange={ev => api.saveEntrance(e.id, { step_free: ev.target.checked }).then(onSaved)} /><Accessibility size={14} /></label></td>
                    <td>{e.estimated ? <span className="pill miss">estimated</span> : <span className="pill ok">confirmed</span>}</td>
                  </tr>
                ))}
              </tbody></table>
            ) : <p className="sub">No entrances yet: routes end at the building pin.</p>
          ) : <div className="locked"><Lock size={14} />{rule.entrancesLocked}</div>}
          {rule.entrances && <p className="sub" style={{ margin: 0, fontSize: 12 }}>Green dots on the map: click one, then drag it to the real door.</p>}
        </div>
        <div className="card stack">
          <p className="label" style={{ margin: 0 }}>Status</p>
          <div className="toolbar">
            {(['open', 'closed'] as const).map(st => <button key={st} type="button" className={`chip ${form.status === st ? 'on' : ''}`} onClick={() => set({ status: st })}>{st === 'open' ? 'Open' : 'Closed'}</button>)}
          </div>
          {form.status === 'closed' && (
            <div className="grid2">
              <label className="f">Reason shown<input className="i" value={form.closed_reason ?? ''} onChange={e => set({ closed_reason: e.target.value })} placeholder="e.g. Renovation" /></label>
              <label className="f">Until<input className="i" type="date" value={form.closed_until?.slice(0, 10) ?? ''} onChange={e => set({ closed_until: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
            </div>
          )}
          <label className="f" style={{ maxWidth: 220 }}>Review every (months)<input className="i" type="number" min={1} max={36} value={form.review_months} onChange={e => set({ review_months: Number(e.target.value) })} /></label>
        </div>
      </div>
    </div>
  );
}
