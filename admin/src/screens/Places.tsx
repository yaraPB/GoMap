import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accessibility, BadgeCheck, Building2, Dumbbell, DoorOpen, FileText, GraduationCap, House, Info, Lock, MapPin, MapPinPlus, PenLine, Save, Search, Settings, Trash2, Undo2, Utensils, X, type LucideIcon } from 'lucide-react';
import { api, CAT_COLOR, CATEGORIES, fmtDate, SCHOOLS, type FootprintFC, type Hours, type Place, type PlaceDetail } from '../api';
import { CampusMap, HoursField, Notice, Tags, useLoad, type MapPoint, type Ring } from '../ui';

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
const LABEL: Record<string, string> = { academic: 'Academic', admin: 'Administrative', services: 'Services', dining: 'Dining', residential: 'Residential', athletics: 'Athletics', facilities: 'Facilities' };
/** The same icons as the GoCampus app chips. */
export const CAT_ICON: Record<string, LucideIcon> = { academic: GraduationCap, admin: FileText, services: Info, dining: Utensils, residential: House, athletics: Dumbbell, facilities: Settings };

type Draft = { ring: Ring | null; coord: [number, number] | null; fromFootprint?: boolean };

/** Board 25: the campus map first; click a building to edit what its category allows. */
export default function Places({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const list = useLoad(api.places);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [panel, setPanel] = useState<string | null>(null);
  const match = (p: { name: string; aliases: string[]; category: string }) => (!cat || p.category === cat) && (!q || `${p.name} ${p.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const items = useMemo(() => (list.data ?? []).filter(match), [list.data, q, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = useLoad(() => (selected ? api.place(selected) : Promise.resolve(null)), [selected]);
  const [entranceSel, setEntranceSel] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [mode, setMode] = useState<'browse' | 'draw' | 'pin'>('browse');
  const [showFootprints, setShowFootprints] = useState(false);
  const footprints = useLoad(() => (showFootprints || mode === 'draw' ? api.footprints() : Promise.resolve(null as FootprintFC | null)), [showFootprints, mode === 'draw']);
  const [draft, setDraft] = useState<Draft | null>(null);
  const unnamed = (footprints.data?.features ?? []).filter(f => !f.properties.place_id).length;

  const points: MapPoint[] = [
    ...(list.data ?? []).map(p => ({ id: p.id, coord: p.coordinates, color: p.status === 'closed' ? '#6B7280' : CAT_COLOR[p.category], label: p.name, text: p.number ?? '', dim: !match(p), size: p.number ? 26 : 20 })),
    ...(detail.data?.entrances ?? []).map(e => ({ id: `e:${e.id}`, coord: e.coordinates, color: '#16A34A', label: `${e.name} (entrance)`, size: 16 })),
  ];
  const say = (text: string, undo?: () => void) => { setToast({ text, undo }); };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.undo ? 9000 : 4500); return () => clearTimeout(id); }, [toast]);

  const onMove = async (id: string, c: [number, number]) => {
    try {
      if (id.startsWith('e:')) await api.saveEntrance(id.slice(2), { coordinates: c });
      else await api.savePlace(id, { coordinates: c });
      say(id.startsWith('e:') ? 'Entrance moved. Routes now end at the new door.' : 'Pin moved and confirmed.');
      list.reload(); detail.reload();
    } catch (e) { say((e as Error).message); }
  };

  /** Deletes, then offers Undo: the place comes back with the same name, pin and outline. */
  const remove = useCallback(async (ids: string[]) => {
    const removed: Awaited<ReturnType<typeof api.deletePlace>>['deleted'][] = [];
    let unlinked = 0;
    for (const id of ids) {
      try { const r = await api.deletePlace(id); removed.push(r.deleted); unlinked += r.people_unlinked; } catch (e) { say((e as Error).message); }
    }
    if (ids.includes(selected ?? '')) select('');
    list.reload();
    if (!removed.length) return;
    say(`${removed.length === 1 ? `“${removed[0].name}” deleted` : `${removed.length} places deleted`}${unlinked ? ` · ${unlinked} office${unlinked > 1 ? 's' : ''} no longer linked` : ''}.`, async () => {
      for (const d of removed) {
        await api.createPlace({ name: d.name, number: d.number, category: d.category, coordinates: d.location.coordinates, footprint: d.footprint ?? null, height: d.height, description: d.description, aliases: d.aliases }).catch(() => {});
      }
      setToast({ text: 'Restored. Entrances are estimated again until you move them.' });
      list.reload();
    });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="head">
        <div><h1>Places & POIs</h1><p className="sub">{list.data?.length ?? '…'} places. Click a category to see and manage everything in it; click a building to edit it.</p></div>
        <div className="toolbar">
          <button className={`btn ${showFootprints ? 'dark' : ''}`} onClick={() => setShowFootprints(v => !v)} title="Every building outline from the map data and the satellite traces"><Building2 size={15} />Outlines{showFootprints && unnamed ? <span className="badge-inline">{unnamed} unnamed</span> : null}</button>
          <button className={`btn ${mode === 'pin' ? 'dark' : ''}`} onClick={() => { setMode(mode === 'pin' ? 'browse' : 'pin'); setDraft(null); }}><MapPinPlus size={15} />Drop a pin</button>
          <button className={`btn ${mode === 'draw' ? 'green' : 'primary'}`} onClick={() => { setMode(mode === 'draw' ? 'browse' : 'draw'); setDraft(null); }}><PenLine size={15} />{mode === 'draw' ? 'Drawing… (Esc to stop)' : 'Draw a building'}</button>
        </div>
      </div>
      <CampusMap points={points} selected={entranceSel ? `e:${entranceSel}` : selected} height={460}
        onSelect={id => { if (id.startsWith('e:')) setEntranceSel(id.slice(2)); else { setEntranceSel(null); select(id); } }} onMove={onMove}
        drawing={mode === 'draw'} onCancelDraw={() => setMode('browse')} onDraw={ring => { setDraft({ ring, coord: null }); setMode('browse'); }}
        footprints={showFootprints || mode === 'draw' ? footprints.data : null}
        onFootprint={f => { if (f.properties.place_id) { setEntranceSel(null); select(f.properties.place_id); } else { const g = f.geometry as { type: string; coordinates: Ring[] }; if (g.type === 'Polygon') setDraft({ ring: g.coordinates[0], coord: null, fromFootprint: true }); } }}
        onMapClick={c => { if (mode === 'pin') { setDraft({ ring: null, coord: c }); setMode('browse'); } }}>
        <div className="glass">
          <Search size={15} style={{ marginLeft: 6, color: 'var(--muted)' }} />
          <input className="search" style={{ width: 190, height: 32, border: 0, background: 'transparent' }} placeholder="Find a place" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a place" />
        </div>
        <div className="catrail" role="toolbar" aria-label="Categories">
          <button className={`catchip ${!cat ? 'on' : ''}`} style={!cat ? { background: '#15171A' } : undefined} onClick={() => { setCat(''); setPanel(null); }}>All</button>
          {CATEGORIES.map(c => {
            const Icon = CAT_ICON[c];
            const n = (list.data ?? []).filter(p => p.category === c).length;
            return (
              <button key={c} className={`catchip ${cat === c ? 'on' : ''}`} style={cat === c ? { background: CAT_COLOR[c] } : undefined} aria-pressed={cat === c}
                onClick={() => { if (cat === c && panel === c) { setCat(''); setPanel(null); } else { setCat(c); setPanel(c); } }}>
                <Icon size={15} strokeWidth={2.3} />{LABEL[c]}<span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      </CampusMap>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="btn sm" onClick={() => { const u = toast.undo!; setToast(null); u(); }}><Undo2 size={14} />Undo</button>}
          <button className="btn sm ghost" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}
      {draft && <NewPlace draft={draft} onClose={() => setDraft(null)} onCreated={(id, name) => { setDraft(null); list.reload(); footprints.reload(); select(id); say(`“${name}” added. Its entrance is estimated: drag the green dot to the real door.`); }} />}

      <div className="split">
        {panel ? <CategoryPanel category={panel} places={(list.data ?? []).filter(p => p.category === panel)} selected={selected} onOpen={id => { setEntranceSel(null); select(id); }} onDelete={remove} onClose={() => { setPanel(null); setCat(''); }} /> : <div className="card" style={{ padding: 8 }}>
          <p className="label" style={{ padding: '6px 6px 0' }}>{items.length} shown · click a category above to manage it</p>
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
        </div>}
        {selected && detail.data ? <PlaceEditor key={selected} place={detail.data} onSaved={() => { list.reload(); detail.reload(); }} onDelete={() => remove([selected])} /> : <div className="card empty"><MapPin size={22} /><p>Click a building on the map or in the list.</p></div>}
      </div>
    </>
  );
}

/**
 * Everything in one category, opened by clicking its chip. Select with a click (Shift for a range,
 * Ctrl/⌘ to add one, Ctrl/⌘+A for all), then press Delete or use the buttons. Esc closes it.
 */
function CategoryPanel({ category, places, selected, onOpen, onDelete, onClose }: {
  category: string; places: Place[]; selected?: string; onOpen: (id: string) => void; onDelete: (ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const shown = places.filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const Icon = CAT_ICON[category];
  useEffect(() => { setPicked([]); setAnchor(null); ref.current?.focus(); }, [category]);
  const click = (e: React.MouseEvent, i: number) => {
    const id = shown[i].id;
    if (e.shiftKey && anchor != null) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; setPicked(shown.slice(a, b + 1).map(p => p.id)); return; }
    if (e.ctrlKey || e.metaKey) { setPicked(ps => (ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id])); setAnchor(i); return; }
    setPicked([id]); setAnchor(i); onOpen(id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') { if (e.key === 'Escape') onClose(); return; }
    if (e.key === 'Escape') { if (confirm) setConfirm(null); else onClose(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length && !confirm) { e.preventDefault(); setConfirm(picked); }
    if (e.key === 'Enter' && confirm) { e.preventDefault(); void onDelete(confirm).then(() => { setConfirm(null); setPicked([]); }); }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPicked(shown.map(p => p.id)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = anchor ?? -1; const next = Math.max(0, Math.min(shown.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey && anchor != null) setPicked(ps => [...new Set([...ps, shown[next].id])]); else setPicked([shown[next].id]);
      setAnchor(next); onOpen(shown[next].id);
    }
  };
  return (
    <div className="catpanel card" ref={ref} tabIndex={-1} onKeyDown={onKey} role="dialog" aria-label={`${LABEL[category]} places`}>
      <div className="catpanel-head">
        <span className="caticon" style={{ background: CAT_COLOR[category] }}><Icon size={16} color="#fff" /></span>
        <div style={{ flex: 1 }}><b>{LABEL[category]}</b><small className="sub" style={{ display: 'block', margin: 0 }}>{places.length} places · click to open · Shift/Ctrl to select several · Delete to remove</small></div>
        <button className="btn sm ghost" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="toolbar" style={{ padding: '0 12px 8px' }}>
        <input className="i" style={{ flex: 1, height: 32 }} placeholder={`Filter ${LABEL[category].toLowerCase()}…`} value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn sm" onClick={() => setPicked(picked.length === shown.length ? [] : shown.map(p => p.id))}>{picked.length === shown.length && shown.length ? 'Select none' : 'Select all'}</button>
        <button className="btn sm danger" disabled={!picked.length} onClick={() => setConfirm(picked)}><Trash2 size={14} />Delete{picked.length ? ` (${picked.length})` : ''}</button>
      </div>
      <div className="catpanel-list" role="listbox" aria-multiselectable="true">
        {shown.map((p, i) => (
          <div key={p.id} role="option" aria-selected={picked.includes(p.id)} className={`catrow ${picked.includes(p.id) ? 'picked' : ''} ${selected === p.id ? 'open' : ''}`} onClick={e => click(e, i)}>
            <input type="checkbox" checked={picked.includes(p.id)} onClick={e => e.stopPropagation()} onChange={() => setPicked(ps => (ps.includes(p.id) ? ps.filter(x => x !== p.id) : [...ps, p.id]))} aria-label={`Select ${p.name}`} />
            <span className="grow"><b>{p.name}</b>{p.number && <small> · #{p.number}</small>}</span>
            {p.status === 'closed' && <span className="pill miss">closed</span>}
            {p.position_estimated && <span className="pill miss">pin?</span>}
            <button className="btn sm ghost rowdel" title="Delete this place" aria-label={`Delete ${p.name}`} onClick={e => { e.stopPropagation(); setConfirm([p.id]); }}><Trash2 size={14} /></button>
          </div>
        ))}
        {!shown.length && <p className="sub" style={{ padding: 12 }}>Nothing matches.</p>}
      </div>
      {confirm && (
        <div className="confirm" role="alertdialog" aria-label="Confirm delete">
          <b>Delete {confirm.length === 1 ? `“${places.find(p => p.id === confirm[0])?.name}”` : `${confirm.length} places`}?</b>
          <p className="sub" style={{ margin: '4px 0 10px' }}>They disappear from the app at once. Offices, events and procedures that pointed here stay, without a place. You can undo right after.</p>
          <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setConfirm(null)}>Cancel <kbd>Esc</kbd></button>
            <button className="btn sm danger-solid" autoFocus onClick={() => void onDelete(confirm).then(() => { setConfirm(null); setPicked([]); })}><Trash2 size={14} />Delete <kbd>Enter</kbd></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A building drawn on the satellite photo (or an unnamed outline, or a dropped pin) becomes a place. */
function NewPlace({ draft, onClose, onCreated }: { draft: Draft; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [category, setCategory] = useState(draft.ring ? 'academic' : 'services');
  const [height, setHeight] = useState(9);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api.createPlace({ name: name || (number ? `Building ${number}` : ''), number: number || null, category, height, ...(draft.ring ? { footprint: { type: 'Polygon', coordinates: [draft.ring] } } : { coordinates: draft.coord }) });
      onCreated(r._id, r.name);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card newplace" onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <b>{draft.ring ? (draft.fromFootprint ? 'Name this building' : 'New building from the photo') : 'New place at the pin'}</b>
        <button type="button" className="btn sm ghost" aria-label="Cancel" onClick={onClose}><X size={15} /></button>
      </div>
      {draft.ring && <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>{draft.ring.length - 1} corners. It shows as a 3D building in the app, gets an entrance on the nearest path, and the assistant learns its name.</p>}
      <div className="grid3">
        <label className="f">Building number<input className="i" value={number} onChange={e => setNumber(e.target.value)} placeholder="e.g. 13" autoFocus /></label>
        <label className="f" style={{ gridColumn: 'span 2' }}>Name<input className="i" value={name} onChange={e => setName(e.target.value)} placeholder={number ? `Building ${number}` : 'e.g. Building 13'} /></label>
      </div>
      <div className="grid2">
        <label className="f">Category<select className="i" value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c}>{LABEL[c]}</option>)}</select></label>
        {draft.ring && <label className="f">Height (m) · about 3 per floor<input className="i" type="number" min={3} max={60} value={height} onChange={e => setHeight(Number(e.target.value))} /></label>}
      </div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || (!name && !number)}><Save size={15} />Add to the map</button>
      </div>
    </form>
  );
}

function PlaceEditor({ place, onSaved, onDelete }: { place: PlaceDetail; onSaved: () => void; onDelete: () => void }) {
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
            <button className="btn danger" title="Delete this place" disabled={busy} onClick={() => { if (confirm(`Delete “${place.name}”? You can undo right after.`)) onDelete(); }}><Trash2 size={15} /></button>
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
