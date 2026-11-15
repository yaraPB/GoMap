import { useMemo, useState } from 'react';
import { CalendarPlus, Save, Trash2, X } from 'lucide-react';
import { api, AUDIENCES, EVENT_KINDS, type CampusEvent } from '../api';
import { CampusMap, Notice, TimeField, useLoad, type MapPoint } from '../ui';

const KIND_COLOR: Record<string, string> = { talk: '#7E22CE', sport: '#11864F', club: '#B7791F', culture: '#BE185D', official: '#2563EB', career: '#0F766E', other: '#4B5563' };
const TZ = 'Africa/Casablanca';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
/** Minutes Ifrane is ahead of UTC on that date (UTC+1, but UTC+0 during Ramadan). */
const offsetMin = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t: string) => Number(p.find(x => x.type === t)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - d.getTime()) / 60000;
};
/** A campus-time day and time → ISO. */
const toIso = (day: string, time: string) => { const utc = new Date(`${day}T${time}:00Z`); return new Date(utc.getTime() - offsetMin(utc) * 60000).toISOString(); };

type Form = { id: string | null; title: string; kind: string; audience: string; place_id: string; location_text: string; day: string; start: string; end: string; organizer: string; link: string; description: string; sample?: boolean };
const blank = (day: string): Form => ({ id: null, title: '', kind: 'talk', audience: 'all', place_id: '', location_text: '', day, start: '18:00', end: '19:30', organizer: '', link: '', description: '' });
const fromEvent = (e: CampusEvent): Form => ({ id: e.id, title: e.title, kind: e.kind, audience: e.audience, place_id: e.place?.id ?? '', location_text: e.location_text ?? '', day: dayKey(new Date(e.starts_at)), start: hm(e.starts_at), end: hm(e.ends_at), organizer: e.organizer ?? '', link: e.link ?? '', description: e.description ?? '', sample: e.sample });

/** Events: what's on, shown in the app's map, visitor card and assistant. Calendar and map first. */
export default function Events() {
  const list = useLoad(api.events);
  const places = useLoad(api.places);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() + i * 86400000); return { key: dayKey(d), d }; }), []);
  const events = (list.data ?? []).filter(e => e.state !== 'past');
  const points: MapPoint[] = events.filter(e => e.place).map(e => ({ id: e.id, coord: e.place!.coordinates, color: KIND_COLOR[e.kind] ?? '#4B5563', label: `${e.title} · ${hm(e.starts_at)}`, text: '★', size: 24 }));

  const save = async () => {
    if (!form) return;
    setBusy(true); setMsg(null);
    const body = { title: form.title, kind: form.kind, audience: form.audience, place_id: form.place_id || null, location_text: form.location_text || null,
      starts_at: toIso(form.day, form.start), ends_at: toIso(form.end <= form.start ? new Date(new Date(`${form.day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) : form.day, form.end),
      organizer: form.organizer || null, link: form.link || null, description: form.description || null };
    try {
      const e = form.id ? await api.saveEvent(form.id, body) : await api.createEvent(body);
      setForm(fromEvent(e)); setMsg({ tone: 'ok', text: 'Saved. It is on the map and the assistant knows about it.' });
      list.reload();
    } catch (err) { setMsg({ tone: 'miss', text: (err as Error).message }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!form?.id || !confirm(`Delete “${form.title}”?`)) return;
    await api.deleteEvent(form.id); setForm(null); list.reload();
  };
  const set = (p: Partial<Form>) => form && setForm({ ...form, ...p });

  return (
    <>
      <div className="head">
        <div><h1>Events</h1><p className="sub">{events.length} upcoming. They appear as badges on the app's map, in the visitor welcome and when students ask “what's on?”.</p></div>
        <button className="btn primary" onClick={() => { setForm(blank(today)); setMsg(null); }}><CalendarPlus size={15} />New event</button>
      </div>
      <CampusMap points={points} selected={form?.id ?? null} onSelect={id => { const e = events.find(x => x.id === id); if (e) { setForm(fromEvent(e)); setMsg(null); } }}
        onMapClick={c => { if (!form) return; const near = (places.data ?? []).map(p => ({ p, d: Math.hypot(p.coordinates[0] - c[0], (p.coordinates[1] - c[1]) * 1.2) })).sort((a, b) => a.d - b.d)[0]; if (near && near.d < 0.0006) set({ place_id: near.p.id }); }} height={300} />

      <div className="cal14" role="grid" aria-label="Next two weeks">
        {days.map(({ key, d }) => {
          const items = events.filter(e => dayKey(new Date(e.starts_at)) === key);
          return (
            <div key={key} role="gridcell" className={`calday ${key === today ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`} onDoubleClick={() => { setForm(blank(key)); setMsg(null); }} title="Double-click to add an event on this day">
              <div className="calday-h">{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: TZ }).format(d)} <b>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: TZ }).format(d)}</b></div>
              {items.map(e => (
                <button key={e.id} className={`calev ${form?.id === e.id ? 'sel' : ''} ${e.state === 'now' ? 'now' : ''}`} style={{ borderLeftColor: KIND_COLOR[e.kind] }} onClick={() => { setForm(fromEvent(e)); setMsg(null); }}>
                  <small>{hm(e.starts_at)}{e.sample ? ' · sample' : ''}</small>{e.title}
                </button>
              ))}
              <button className="caladd" aria-label={`Add an event on ${key}`} onClick={() => { setForm(blank(key)); setMsg(null); }}>+</button>
            </div>
          );
        })}
      </div>

      {form && (
        <div className="card stack" style={{ marginTop: 16 }}>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{form.id ? 'Edit event' : 'New event'}{form.sample && <span className="pill busy" style={{ marginLeft: 8 }}>sample: saving makes it real</span>}</h2>
            <div className="toolbar">
              {form.id && <button className="btn danger" onClick={remove}><Trash2 size={15} />Delete</button>}
              <button className="btn primary" disabled={busy || !form.title} onClick={save}><Save size={15} />Save</button>
              <button className="btn ghost" aria-label="Close" onClick={() => setForm(null)}><X size={15} /></button>
            </div>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="grid3">
            <label className="f" style={{ gridColumn: 'span 2' }}>Title<input className="i" value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Career fair" autoFocus /></label>
            <label className="f">Kind<select className="i" value={form.kind} onChange={e => set({ kind: e.target.value })}>{EVENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <div className="toolbar" style={{ alignItems: 'flex-end', gap: 14 }}>
            <label className="f">Day<input className="i" type="date" value={form.day} onChange={e => set({ day: e.target.value })} /></label>
            <TimeField label="Starts" value={form.start} onChange={start => set({ start })} presets={['09:00', '12:00', '16:00', '18:00']} />
            <TimeField label="Ends" value={form.end} onChange={end => set({ end })} presets={['12:00', '14:00', '18:00', '20:00']} />
            <label className="f">Who it is for<select className="i" value={form.audience} onChange={e => set({ audience: e.target.value })}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <div className="grid2">
            <label className="f">Place on the map (click a building above)<select className="i" value={form.place_id} onChange={e => set({ place_id: e.target.value })}>
              <option value="">— no place —</option>{(places.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Room or details<input className="i" value={form.location_text} onChange={e => set({ location_text: e.target.value })} placeholder="e.g. Room 102, the lawn behind it" /></label>
          </div>
          <div className="grid2">
            <label className="f">Organiser<input className="i" value={form.organizer} onChange={e => set({ organizer: e.target.value })} /></label>
            <label className="f">Link (optional)<input className="i" value={form.link} onChange={e => set({ link: e.target.value })} placeholder="https://" /></label>
          </div>
          <label className="f">Description<textarea className="i" value={form.description} onChange={e => set({ description: e.target.value })} /></label>
          {!form.place_id && <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>Without a place, students see the event but get no directions.</p>}
        </div>
      )}
    </>
  );
}
