import { useEffect, useState } from 'react';
import { api, fmtDate, type Procedure } from '../api';
import { Notice, Tags, useLoad } from '../ui';

const EMPTY: Procedure = { id: 'new', title: '', summary: '', owner_office: '', place_id: null, contact_email: null, steps: [{ title: '', body: '' }], match_phrases: [], source: '', status: 'draft', verified_at: null, unverified: true };

/** Board 27: the register the assistant answers from. Linking a place is what makes "guide me there" route. */
export default function Procedures({ selected, select }: { selected?: string; select: (id: string) => void }) {
  const list = useLoad(api.procedures);
  return (
    <>
      <div className="head">
        <div><h1>Services the assistant answers from</h1><p className="sub">Only <b>live</b> entries answer without an “unverified” banner. Draft and review entries are flagged in the app.</p></div>
        <button className="btn dark" onClick={() => select('new')}>New procedure</button>
      </div>
      <div className="split">
        <div className="card" style={{ padding: 10 }}>
          <div className="list">
            {(list.data ?? []).map(p => (
              <button key={p.id} className={`row ${selected === p.id ? 'on' : ''}`} onClick={() => select(p.id)}>
                <span className="grow"><b>{p.title}</b><small>{p.owner_office}</small></span>
                <span className={`pill ${p.status === 'live' ? 'ok' : p.status === 'review' ? 'busy' : 'miss'}`}>{p.status}</span>
              </button>
            ))}
          </div>
        </div>
        {selected ? <Editor key={selected} initial={selected === 'new' ? EMPTY : list.data?.find(p => p.id === selected) ?? null} onSaved={id => { list.reload(); select(id); }} /> : <div className="card empty">Choose a procedure.</div>}
      </div>
    </>
  );
}

function Editor({ initial, onSaved }: { initial: Procedure | null; onSaved: (id: string) => void }) {
  const places = useLoad(api.places);
  const [f, setF] = useState<Procedure | null>(initial);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.preview>> | null>(null);
  useEffect(() => { setF(initial); setQuestion(initial?.match_phrases[0] ?? ''); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div className="card empty">Loading…</div>;
  const body = () => ({ title: f.title, summary: f.summary, owner_office: f.owner_office, place_id: f.place_id, contact_email: f.contact_email ?? '', steps: f.steps.filter(s => s.title.trim()), match_phrases: f.match_phrases, source: f.source ?? '', status: f.status });
  const save = async (extra: Record<string, unknown> = {}) => {
    setMsg(null);
    try {
      if (f.id === 'new') { const r = await api.createProcedure({ ...body(), ...extra }); onSaved(r.id); }
      else { await api.saveProcedure(f.id, { ...body(), ...extra }); onSaved(f.id); }
      setMsg({ tone: 'ok', text: 'Saved. The assistant answers from it immediately.' });
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  const runPreview = async () => { try { setPreview(await api.preview(question)); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } };
  return (
    <div className="cols" style={{ gridTemplateColumns: '1fr 360px' }}>
      <div className="card stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={{ fontSize: 20 }}>{f.id === 'new' ? 'New procedure' : f.title}</h2><p className="sub">{f.verified_at ? `Verified ${fmtDate(f.verified_at)}` : 'Not verified'}</p></div>
          <div className="toolbar">
            <select className="i" value={f.status} onChange={e => setF({ ...f, status: e.target.value as Procedure['status'] })} aria-label="Status"><option value="draft">draft</option><option value="review">review</option><option value="live">live</option></select>
            <button className="btn primary" onClick={() => save()}>Save</button>
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="grid2">
          <label className="f">Title<input className="i" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <label className="f">Owning office<input className="i" value={f.owner_office} onChange={e => setF({ ...f, owner_office: e.target.value })} /></label>
          <label className="f">Where it happens (makes “guide me there” work)<select className="i" value={f.place_id ?? ''} onChange={e => setF({ ...f, place_id: e.target.value || null })}>
            <option value="">No place</option>{(places.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label className="f">Contact email<input className="i" value={f.contact_email ?? ''} onChange={e => setF({ ...f, contact_email: e.target.value })} /></label>
        </div>
        <label className="f">What the student is told first<textarea className="i" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} /></label>
        <div>
          <p className="label">Steps</p>
          {f.steps.map((s, i) => (
            <div key={i} className="step">
              <input className="i" placeholder={`Step ${i + 1}`} value={s.title} onChange={e => setF({ ...f, steps: f.steps.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
              <input className="i" placeholder="Details" value={s.body} onChange={e => setF({ ...f, steps: f.steps.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)) })} />
              <button className="btn sm" aria-label="Remove step" onClick={() => setF({ ...f, steps: f.steps.filter((_, k) => k !== i) })}>✕</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setF({ ...f, steps: [...f.steps, { title: '', body: '' }] })}>+ step</button>
        </div>
        <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Phrasings a question should match (answered instantly, without the model)
          <Tags value={f.match_phrases} onChange={match_phrases => setF({ ...f, match_phrases })} placeholder="e.g. declare a minor, press Enter" />
        </div>
        <label className="f">Source shown to students<input className="i" value={f.source ?? ''} onChange={e => setF({ ...f, source: e.target.value })} /></label>
      </div>
      <div className="stack">
        <p className="label">What the student will be told</p>
        <div className="phone stack">
          <div className="toolbar"><input className="i" style={{ flex: 1 }} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask as a student would" aria-label="Preview question" /><button className="btn sm primary" onClick={runPreview}>Ask</button></div>
          {preview ? (
            <div className="stack" style={{ gap: 8 }}>
              <div>{preview.text}</div>
              {preview.procedure?.steps.map((s, i) => <div key={i}><b>{i + 1}. {s.title}</b><div className="sub" style={{ marginTop: 0 }}>{s.body}</div></div>)}
              {preview.place && <div className="pill">{preview.place.name} · {preview.place.hours ?? 'hours not published'}</div>}
              {preview.unverified && <Notice>Not yet verified — check with the office</Notice>}
              <div className="sub" style={{ fontSize: 11.5 }}>{preview.source} · answered {preview.answered_by === 'local' ? 'instantly from the register' : `by ${preview.answered_by}`}</div>
            </div>
          ) : <p className="sub">Save, then ask a question to see the real answer.</p>}
        </div>
      </div>
    </div>
  );
}
