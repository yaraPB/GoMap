import { useEffect, useState } from 'react';
import { api, type Issue } from '../api';
import { Notice, useLoad } from '../ui';

type Draft = { issue: string; go_to: string; service_id: string | null; location_text: string; place_id: string | null; notes: string; keywords: string };
const draftOf = (i?: Issue): Draft => ({
  issue: i?.issue ?? '', go_to: i?.go_to ?? '', service_id: i?.service_id ?? null, location_text: i?.location_text ?? '',
  place_id: i?.place?.id ?? null, notes: i?.notes ?? '', keywords: (i?.keywords ?? []).join(', '),
});

/** "I have problem X: where do I go?" Each row is an answer the assistant gives, with directions. */
export default function Issues() {
  const list = useLoad(api.issues);
  const services = useLoad(api.services);
  const places = useLoad(api.places);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const rows = (list.data ?? []).filter(i => !q || `${i.issue} ${i.go_to} ${i.keywords.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const save = async (id: string, d: Draft) => {
    setMsg(null);
    const body = { ...d, keywords: d.keywords.split(',').map(k => k.trim()).filter(Boolean), service_id: d.service_id || null, place_id: d.place_id || null };
    try {
      if (id === 'new') await api.createIssue(body); else await api.saveIssue(id, body);
      setMsg({ tone: 'ok', text: 'Saved. The assistant routes this problem now.' });
      list.reload();
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  const remove = async (i: Issue) => {
    if (!confirm(`Delete “${i.issue}”?`)) return;
    try { await api.deleteIssue(i.id); list.reload(); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  return (
    <>
      <div className="head">
        <div><h1>Where to go for…</h1><p className="sub">Student problems and the office that solves them. Linking an office gives the answer its hours, contact and directions.</p></div>
        <input className="search" style={{ width: 300 }} placeholder="Filter" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter problems" />
      </div>
      {msg && <div style={{ marginBottom: 12 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {list.error && <Notice tone="miss">{list.error}</Notice>}
      <div className="card tablewrap" style={{ padding: 6 }}>
        <table>
          <thead><tr><th style={{ width: '24%' }}>Problem</th><th style={{ width: '18%' }}>Office</th><th style={{ width: '15%' }}>Where</th><th style={{ width: '14%' }}>Map pin</th><th>Notes · words students use</th><th /></tr></thead>
          <tbody>
            <Row key="new" id="new" initial={draftOf()} services={services.data ?? []} places={places.data ?? []} onSave={save} />
            {rows.map(i => <Row key={i.id} id={i.id} initial={draftOf(i)} edited={i.admin_edited} services={services.data ?? []} places={places.data ?? []} onSave={save} onDelete={() => remove(i)} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ id, initial, edited, services, places, onSave, onDelete }: {
  id: string; initial: Draft; edited?: boolean; services: { id: string; short_name: string; name: string; location_text: string | null; places: { id: string }[] }[];
  places: { id: string; name: string }[]; onSave: (id: string, d: Draft) => void; onDelete?: () => void;
}) {
  const [d, setD] = useState(initial);
  useEffect(() => setD(initial), [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const pickService = (sid: string) => {
    const s = services.find(x => x.id === sid);
    setD({ ...d, service_id: sid || null, go_to: s ? s.name : d.go_to, location_text: s?.location_text ?? d.location_text, place_id: s?.places[0]?.id ?? d.place_id });
  };
  return (
    <tr style={id === 'new' ? { background: '#FBFBFA' } : undefined}>
      <td><textarea className="i" rows={2} value={d.issue} placeholder={id === 'new' ? 'New problem, e.g. “Lost my student card”' : ''} onChange={e => setD({ ...d, issue: e.target.value })} /></td>
      <td>
        <select className="i" value={d.service_id ?? ''} onChange={e => pickService(e.target.value)} aria-label="Office">
          <option value="">Not linked</option>{services.map(s => <option key={s.id} value={s.id}>{s.short_name}</option>)}
        </select>
        {!d.service_id && <input className="i" style={{ marginTop: 4 }} value={d.go_to} placeholder="Go to…" onChange={e => setD({ ...d, go_to: e.target.value })} />}
      </td>
      <td><input className="i" value={d.location_text} onChange={e => setD({ ...d, location_text: e.target.value })} /></td>
      <td>
        <select className="i" value={d.place_id ?? ''} onChange={e => setD({ ...d, place_id: e.target.value || null })} aria-label="Map pin">
          <option value="">None</option>{places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td>
        <input className="i" value={d.notes} placeholder="Note for the student" onChange={e => setD({ ...d, notes: e.target.value })} />
        <input className="i" style={{ marginTop: 4 }} value={d.keywords} placeholder="words, comma separated" onChange={e => setD({ ...d, keywords: e.target.value })} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <div className="toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <button className={`btn sm ${dirty ? 'primary' : ''}`} disabled={!dirty || !d.issue.trim() || !(d.go_to.trim() || d.service_id)} onClick={() => onSave(id, d)}>{id === 'new' ? 'Add' : 'Save'}</button>
          {onDelete && <button className="btn sm danger" onClick={onDelete}>Delete</button>}
          {edited && <span className="pill" title="Edited here; the JSON import leaves it alone">edited</span>}
        </div>
      </td>
    </tr>
  );
}
