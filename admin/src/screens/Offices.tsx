import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CalendarClock, Save, Search, Timer } from 'lucide-react';
import { api, fmtDate, fmtMin, type Hours, type Person } from '../api';
import { Heatmap, HoursField, Notice, useLoad } from '../ui';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Posted office hours of everyone, as professors per weekday × hour. */
function postedHeat(people: Person[]) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const p of people) DAY_KEYS.forEach((d, i) => {
    for (const [a, b] of p.hours?.[d] ?? []) for (let h = Math.floor(toMin(a) / 60); h < Math.ceil(toMin(b) / 60); h++) grid[i][h]++;
  });
  return grid;
}

/** Board 26: faculty and staff. Calendar first: when people are available, then their records. */
export default function Offices({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const people = useLoad(api.people);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'conflict' | 'missing' | 'stale'>('all');
  const list = useMemo(() => (people.data ?? []).filter(p => (!q || `${p.name} ${p.office_number ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    && (filter === 'all' || (filter === 'conflict' && p.conflict) || (filter === 'missing' && p.missing.length) || (filter === 'stale' && p.stale))), [people.data, q, filter]);
  const count = (f: typeof filter) => (people.data ?? []).filter(p => (f === 'conflict' ? p.conflict : f === 'missing' ? p.missing.length : p.stale)).length;
  return (
    <>
      <div className="head"><div><h1>Faculty & staff</h1><p className="sub">From the school directories on aui.ma. An empty day publishes “no office hours”, never a guess.</p></div></div>
      {!selected && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="label" style={{ margin: 0 }}><CalendarClock size={13} /> Posted office hours this week · professors available per hour</p>
            <span className="sub" style={{ margin: 0, fontSize: 12 }}>Pick someone to edit their calendar</span>
          </div>
          <Heatmap grid={postedHeat(people.data ?? [])} from={7} to={21} color="11,122,71" unit="professors" />
        </div>
      )}
      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} />
            <input className="search" style={{ paddingLeft: 32 }} placeholder="Name or office number" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person" />
          </div>
          <div className="chips" style={{ marginBottom: 6 }}>
            {(['all', 'conflict', 'missing', 'stale'] as const).map(f => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : `${f === 'conflict' ? 'Conflicts' : f === 'missing' ? 'Missing' : 'Past review'} · ${count(f)}`}</button>)}
          </div>
          <div className="list" style={{ maxHeight: '64vh', overflow: 'auto' }}>
            {list.map(p => (
              <button key={p.id} className={`row ${selected === p.id ? 'on' : ''}`} onClick={() => select(p.id)}>
                <span className="grow"><b>{p.name}</b><small>{p.place ? `${p.place.name}${p.office_number ? `, ${p.office_number}` : ''}` : 'no office'} · {p.department?.id}</small></span>
                {p.conflict ? <span className="pill miss">conflict</span> : p.missing.length ? <span className="pill busy">{p.missing.length} missing</span> : null}
              </button>
            ))}
          </div>
        </div>
        {selected ? <PersonEditor key={selected} id={selected} onSaved={people.reload} /> : <div className="card empty">Choose a person to edit their calendar and office.</div>}
      </div>
    </>
  );
}

function PersonEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { data, error, reload } = useLoad(() => api.person(id), [id]);
  const places = useLoad(api.places);
  const campus = useLoad(api.campus);
  const time = useLoad(() => api.officeTime(30), []);
  const [f, setF] = useState<Person | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (error) return <Notice tone="miss">{error}</Notice>;
  if (!f) return <div className="card empty">Loading…</div>;
  const mine = time.data?.people.find(p => p.id === id);
  const week = weekMinutes(mine?.by_day);
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
          <div className="toolbar"><button className="btn green" onClick={() => save({ verify: true })}><BadgeCheck size={15} />Save and verify</button><button className="btn primary" onClick={() => save()}><Save size={15} />Save</button></div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <p className="label" style={{ margin: 0 }}>Office hours</p>
        {f.hours_raw && <p className="sub" style={{ margin: 0 }}>Posted on aui.ma as: “{f.hours_raw}”</p>}
        <HoursField value={f.hours} lunch={campus.data?.lunch} onChange={(hours: Hours | null) => setF({ ...f, hours })} />
      </div>

      <div className="cols">
        <div className="card stack">
          <p className="label" style={{ margin: 0 }}><Timer size={13} /> Time spent in the office</p>
          <div className="tiles" style={{ marginBottom: 0 }}>
            <div className="tile"><div className="l">Last 7 days</div><div className="v">{fmtMin(week)}</div></div>
            <div className="tile"><div className="l">Last 30 days</div><div className="v">{fmtMin(mine?.in_min ?? 0)}</div></div>
          </div>
          {mine?.heat && mine.in_min > 0 ? <Heatmap grid={mine.heat} from={8} to={19} /> : <p className="sub" style={{ margin: 0 }}>No time marked yet. Professors mark themselves “in” from the app.</p>}
        </div>
        <div className="card stack">
          <p className="label" style={{ margin: 0 }}>Office and contact</p>
          {f.conflict && (
            <div className="notice miss" style={{ flexDirection: 'column' }}>
              <b>The sources disagree on the {f.conflict.field.replace('_', ' ')}. Pick the right one:</b>
              <div className="toolbar">
                {f.conflict.values.map(v => <button key={v.source} className="btn sm" onClick={() => save({ office_number: v.value, place_id: v.place_id, resolve_conflict: true, verify: true })}>Office {v.value} · {v.source}</button>)}
              </div>
            </div>
          )}
          {f.missing.length > 0 && <Notice>Not published: {f.missing.join(', ')}. The app says so instead of guessing.</Notice>}
          <label className="f">Title<input className="i" value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <div className="grid2">
            <label className="f">Email<input className="i" type="email" value={f.email ?? ''} onChange={e => setF({ ...f, email: e.target.value })} /></label>
            <label className="f">Phone<input className="i" value={f.phone ?? ''} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
          </div>
          <label className="f">Building<select className="i" value={f.place?.id ?? ''} onChange={e => setF({ ...f, place: e.target.value ? { id: e.target.value, name: e.target.selectedOptions[0].text } : null })}>
            <option value="">Not published</option>{(places.data ?? []).filter(p => ['academic', 'admin', 'services'].includes(p.category)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <div className="grid2">
            <label className="f">Office<input className="i" value={f.office_number ?? ''} onChange={e => setF({ ...f, office_number: e.target.value })} /></label>
            <label className="f">Floor<input className="i" type="number" value={f.floor ?? ''} onChange={e => setF({ ...f, floor: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minutes over the last 7 days from a per-day map (YYYY-MM-DD → minutes). */
function weekMinutes(byDay?: Record<string, number>) {
  if (!byDay) return 0;
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return Object.entries(byDay).filter(([d]) => d >= since).reduce((s, [, v]) => s + v, 0);
}
