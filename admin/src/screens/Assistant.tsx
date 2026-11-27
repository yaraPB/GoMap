import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, FlaskConical, MessageSquarePlus, Play, Plus, Save, Sparkles, Trash2, Wand2, X, Zap } from 'lucide-react';
import { api, ago, type AssistantTest, type Rule, type TryAnswer } from '../api';
import { Heatmap, Notice, Tags, useLoad } from '../ui';

type Tab = 'try' | 'rules' | 'tests' | 'log';
const INTENTS = ['place', 'person', 'procedure', 'service', 'events', 'info', 'help', 'unknown'];

/**
 * The assistant's control room. The admin writes the rules (their own answers), tries any question
 * and sees exactly how it was answered, and keeps a test suite that must stay green after edits.
 */
export default function Assistant({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((['try', 'rules', 'tests', 'log'] as Tab[]).includes(initial as Tab) ? initial as Tab : 'try');
  const status = useLoad(api.assistantStatus);
  const [ruleDraft, setRuleDraft] = useState<Partial<Rule> | null>(null);
  const [testDraft, setTestDraft] = useState<string | null>(null);
  const writeRule = (question: string) => { setRuleDraft({ title: question.slice(0, 80), triggers: [question.toLowerCase()], answer: '' }); setTab('rules'); };
  const m = status.data?.model;
  return (
    <>
      <div className="head">
        <div><h1>Assistant</h1><p className="sub">Your rules come first, then the campus records; the AI model only picks which record answers. Nothing is invented.</p></div>
        <div className="modelcard">
          <Bot size={18} />
          <div><b>{m ? `${m.provider === 'claude' ? 'Claude' : 'Gemini'} · ${m.model}` : 'No AI model'}</b>
            <small>{m ? 'answers open questions' : 'local answers only: add a key in server/.env'} · {status.data?.rules ?? 0} rules{status.data?.transcription ? ` · voice: ${status.data.transcription}` : ''}</small></div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([['try', 'Try a question', Sparkles], ['rules', 'Rules', Wand2], ['tests', 'Tests', FlaskConical], ['log', 'What people asked', MessageSquarePlus]] as const).map(([id, name, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}><Icon size={15} />{name}</button>
        ))}
      </div>
      {tab === 'try' && <TryIt onRule={writeRule} onTest={q => { setTestDraft(q); setTab('tests'); }} />}
      {tab === 'rules' && <Rules draft={ruleDraft} clearDraft={() => setRuleDraft(null)} onChanged={status.reload} />}
      {tab === 'tests' && <Tests draft={testDraft} clearDraft={() => setTestDraft(null)} aiReady={!!m} />}
      {tab === 'log' && <Log onRule={writeRule} />}
    </>
  );
}

/** Why a question was refused (the reply itself is fixed text, written once in server/src/assistant/guard.ts). */
const DECLINED: Record<NonNullable<TryAnswer['declined']>, string> = {
  off_topic: 'refused: not about AUI', dangerous: 'refused: harmful request', injection: 'refused: tried to change the rules', nonsense: 'refused: no clear meaning',
};

function AnswerView({ a }: { a: TryAnswer }) {
  const target = a.rule ? `rule: ${a.rule.title}` : a.route_from && a.place ? `route: ${a.route_from.name} → ${a.place.name}` : a.department ? `school: ${a.department.name}` : a.browse ? `map filter: ${a.browse.category} (${a.browse.count})`
    : a.place ? `place: ${a.place.name}` : a.service ? `office: ${a.service.short_name}` : a.procedure ? `procedure: ${a.procedure.title}` : a.person ? `person: ${a.person.name}` : a.events ? `${a.events.length} events` : null;
  const refused = a.declined ? DECLINED[a.declined] : null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {a.alert && <Notice tone={a.alert.tone === 'urgent' ? 'miss' : 'warn'}>{a.alert.text}</Notice>}
      <div className="bubble">{a.text}</div>
      <div className="toolbar">
        <span className={`pill ${a.intent === 'unknown' ? 'miss' : 'ok'}`}>{a.intent}</span>
        {refused && <span className="pill miss" title="The guard refused it with a fixed reply; nothing was invented">{refused}</span>}
        {target && <span className="pill blue">{target}</span>}
        <span className="pill">{a.answered_by === 'local' ? 'answered locally (free, instant)' : `answered with ${a.answered_by}`}</span>
        {a.trace && <span className="pill">{a.trace.ms} ms</span>}
        {a.unverified && <span className="pill busy">not verified</span>}
      </div>
      {a.trace && (
        <details className="trace" open>
          <summary>How it was found</summary>
          {a.trace.candidates.length ? (
            <table><thead><tr><th>Candidate</th><th>Record</th><th>Score (lower is better)</th></tr></thead><tbody>
              {a.trace.candidates.map((c, i) => <tr key={i}><td>{c.intent}</td><td><code>{c.id}</code></td><td>{c.score}</td></tr>)}
            </tbody></table>
          ) : <p className="sub">No local match: the question went to the AI model.</p>}
          {!!a.trace.tools.length && <p className="sub" style={{ marginTop: 8 }}>Model tool calls: {a.trace.tools.map(t => `${t.name}(${Object.values(t.args).join(', ')}) → ${t.found ? 'found' : 'nothing'}`).join(' · ')}</p>}
        </details>
      )}
    </div>
  );
}

function TryIt({ onRule, onTest }: { onRule: (q: string) => void; onTest: (q: string) => void }) {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('en');
  const [a, setA] = useState<TryAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (text = q) => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { setA(await api.tryAsk(text, lang)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const samples = ['Where can I print?', 'I lost my student card', 'What is happening this week?', 'Où est la bibliothèque ?', 'Where is Harit Satt\'s office?', 'Emergency, someone is hurt'];
  return (
    <div className="cols">
      <div className="card stack">
        <form className="toolbar" onSubmit={e => { e.preventDefault(); void ask(); }}>
          <input className="i" style={{ flex: 1 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Ask what a student would ask…" autoFocus />
          <select className="i" value={lang} onChange={e => setLang(e.target.value)} style={{ width: 80 }}><option value="en">EN</option><option value="fr">FR</option><option value="ar">AR</option></select>
          <button className="btn primary" disabled={busy}><Play size={15} />Ask</button>
        </form>
        <div className="chips">{samples.map(s => <button key={s} className="chip" onClick={() => { setQ(s); void ask(s); }}>{s}</button>)}</div>
        <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>Nothing here is logged or shown to students. Questions that reach the AI model cost a fraction of a cent.</p>
      </div>
      <div className="card stack">
        {error && <Notice tone="miss">{error}</Notice>}
        {a ? (
          <>
            <AnswerView a={a} />
            <div className="toolbar">
              <button className="btn" onClick={() => onRule(q)}><Wand2 size={15} />Write my own answer for this</button>
              <button className="btn" onClick={() => onTest(q)}><FlaskConical size={15} />Keep as a test</button>
            </div>
          </>
        ) : <div className="empty"><Sparkles size={22} /><p>The answer, and how it was found, shows here.</p></div>}
      </div>
    </div>
  );
}

function Rules({ draft, clearDraft, onChanged }: { draft: Partial<Rule> | null; clearDraft: () => void; onChanged: () => void }) {
  const rules = useLoad(api.rules);
  const places = useLoad(api.places);
  const services = useLoad(api.services);
  const procedures = useLoad(api.procedures);
  const [form, setForm] = useState<Partial<Rule> | null>(draft);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const [preview, setPreview] = useState<TryAnswer | null>(null);
  useEffect(() => { if (draft) { setForm(draft); clearDraft(); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Rule>) => form && setForm({ ...form, ...p });
  const save = async () => {
    if (!form) return;
    setMsg(null);
    try {
      const body = { title: form.title, triggers: form.triggers ?? [], answer: form.answer, answer_fr: form.answer_fr || null, answer_ar: form.answer_ar || null,
        place_id: form.place_id || null, service_id: form.service_id || null, procedure_id: form.procedure_id || null, urgent: !!form.urgent, enabled: form.enabled !== false };
      const r = form.id ? await api.saveRule(form.id, body) : await api.createRule(body);
      setForm(r); rules.reload(); onChanged();
      // show straight away what a student now gets for the first trigger
      if (r.triggers[0]) setPreview(await api.tryAsk(r.triggers[0]));
      setMsg({ tone: 'ok', text: 'Saved. The assistant uses it from now on.' });
    } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); }
  };
  const remove = async () => {
    if (!form?.id || !confirm(`Delete the rule “${form.title}”?`)) return;
    await api.deleteRule(form.id); setForm(null); setPreview(null); rules.reload(); onChanged();
  };
  return (
    <div className="split">
      <div className="card" style={{ padding: 8 }}>
        <div className="toolbar" style={{ justifyContent: 'space-between', padding: 6 }}>
          <p className="label" style={{ margin: 0 }}>{rules.data?.length ?? 0} rules</p>
          <button className="btn sm primary" onClick={() => { setForm({ title: '', triggers: [], answer: '', enabled: true }); setPreview(null); setMsg(null); }}><Plus size={14} />New rule</button>
        </div>
        <div className="list">
          {(rules.data ?? []).map(r => (
            <button key={r.id} className={`row ${form?.id === r.id ? 'on' : ''}`} onClick={() => { setForm(r); setPreview(null); setMsg(null); }}>
              {r.urgent ? <Zap size={15} color="#C4362A" /> : <Wand2 size={15} color={r.enabled ? 'var(--blue)' : 'var(--muted)'} />}
              <span className="grow"><b style={{ opacity: r.enabled ? 1 : 0.5 }}>{r.title}</b><small>{r.triggers.slice(0, 3).join(' · ') || 'no trigger phrases'}</small></span>
              <span className="pill">{r.hits} used</span>
            </button>
          ))}
          {rules.data && !rules.data.length && <p className="empty">No rules yet. Write the answers you want students to get, word for word.</p>}
        </div>
      </div>
      {form ? (
        <div className="stack">
          <div className="card stack">
            <div className="toolbar" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{form.id ? 'Edit rule' : 'New rule'}</h2>
              <div className="toolbar">
                <label className="toolbar" style={{ fontSize: 13, gap: 6 }}><input type="checkbox" checked={form.enabled !== false} onChange={e => set({ enabled: e.target.checked })} />On</label>
                <label className="toolbar" style={{ fontSize: 13, gap: 6 }} title="Shown in red at the top, with a call button"><input type="checkbox" checked={!!form.urgent} onChange={e => set({ urgent: e.target.checked })} />Urgent</label>
                {form.id && <button className="btn danger" onClick={remove}><Trash2 size={15} /></button>}
                <button className="btn primary" onClick={save} disabled={!form.title || !form.answer}><Save size={15} />Save</button>
                <button className="btn ghost" aria-label="Close" onClick={() => setForm(null)}><X size={15} /></button>
              </div>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <label className="f">Name (for you)<input className="i" value={form.title ?? ''} onChange={e => set({ title: e.target.value })} placeholder="e.g. Printing on campus" /></label>
            <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
              When someone says… (any language; one phrase per tag)
              <Tags value={form.triggers ?? []} onChange={triggers => set({ triggers })} placeholder="e.g. print, printer, imprimer, طباعة — press Enter" />
            </div>
            <label className="f">Answer (English)<textarea className="i" value={form.answer ?? ''} onChange={e => set({ answer: e.target.value })} placeholder="Exactly what the assistant should say. One or two sentences." /></label>
            <div className="grid2">
              <label className="f">Answer in French (optional)<textarea className="i" value={form.answer_fr ?? ''} onChange={e => set({ answer_fr: e.target.value })} /></label>
              <label className="f">Answer in Arabic (optional)<textarea className="i" dir="rtl" value={form.answer_ar ?? ''} onChange={e => set({ answer_ar: e.target.value })} /></label>
            </div>
            <p className="label" style={{ margin: 0 }}>Show with the answer (optional)</p>
            <div className="grid3">
              <label className="f">Directions to<select className="i" value={form.place_id ?? ''} onChange={e => set({ place_id: e.target.value || null })}><option value="">—</option>{(places.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="f">Office card<select className="i" value={form.service_id ?? ''} onChange={e => set({ service_id: e.target.value || null })}><option value="">—</option>{(services.data ?? []).map(s => <option key={s.id} value={s.id}>{s.short_name}</option>)}</select></label>
              <label className="f">Procedure steps<select className="i" value={form.procedure_id ?? ''} onChange={e => set({ procedure_id: e.target.value || null })}><option value="">—</option>{(procedures.data ?? []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
            </div>
          </div>
          {preview && <div className="card"><p className="label">What a student now gets for “{form.triggers?.[0]}”</p><AnswerView a={preview} /></div>}
        </div>
      ) : <div className="card empty"><Wand2 size={22} /><p>Pick a rule, or write a new one. Rules are your own answers: they beat everything else the assistant knows.</p></div>}
    </div>
  );
}

function Tests({ draft, clearDraft, aiReady }: { draft: string | null; clearDraft: () => void; aiReady: boolean }) {
  const tests = useLoad(api.tests);
  const [running, setRunning] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ question: string; lang: string; expect_intent: string; expect_id: string; expect_text: string } | null>(null);
  useEffect(() => { if (draft) { setAdding({ question: draft, lang: 'en', expect_intent: '', expect_id: '', expect_text: '' }); clearDraft(); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (localOnly: boolean, id?: string) => {
    setRunning(id ?? (localOnly ? 'local' : 'ai'));
    try { await api.runTests({ id, local_only: localOnly }); tests.reload(); } finally { setRunning(null); }
  };
  const rows = tests.data ?? [];
  const passed = rows.filter(t => t.last_result?.pass).length, ran = rows.filter(t => t.last_result).length;
  const add = async () => {
    if (!adding?.question) return;
    await api.createTest({ question: adding.question, lang: adding.lang, expect_intent: adding.expect_intent || null, expect_id: adding.expect_id || null, expect_text: adding.expect_text || null });
    setAdding(null); tests.reload();
  };
  const summary = useMemo(() => (ran ? `${passed} / ${ran} passing` : 'not run yet'), [passed, ran]);
  return (
    <div className="stack">
      <div className="card toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="toolbar">
          <span className={`pill ${ran && passed === ran ? 'ok' : ran ? 'miss' : ''}`} style={{ fontSize: 13, height: 28 }}>{summary}</span>
          <span className="sub" style={{ margin: 0 }}>Run after every change to rules, offices or places.</span>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setAdding({ question: '', lang: 'en', expect_intent: '', expect_id: '', expect_text: '' })}><Plus size={15} />Add a question</button>
          <button className="btn primary" disabled={!!running} onClick={() => run(true)}><Play size={15} />{running === 'local' ? 'Running…' : 'Run all (free)'}</button>
          <button className="btn" disabled={!!running || !aiReady} title={aiReady ? 'Questions with no local answer go to the AI model' : 'No AI key on the server'} onClick={() => run(false)}><Bot size={15} />{running === 'ai' ? 'Running…' : 'Run with the AI model'}</button>
        </div>
      </div>
      {adding && (
        <div className="card stack">
          <div className="grid3">
            <label className="f" style={{ gridColumn: 'span 2' }}>Question<input className="i" value={adding.question} onChange={e => setAdding({ ...adding, question: e.target.value })} autoFocus /></label>
            <label className="f">Language<select className="i" value={adding.lang} onChange={e => setAdding({ ...adding, lang: e.target.value })}><option value="en">English</option><option value="fr">French</option><option value="ar">Arabic</option></select></label>
          </div>
          <div className="grid3">
            <label className="f">Should be answered as<select className="i" value={adding.expect_intent} onChange={e => setAdding({ ...adding, expect_intent: e.target.value })}><option value="">anything</option>{INTENTS.map(i => <option key={i} value={i}>{i}</option>)}<option value="rule">one of my rules</option></select></label>
            <label className="f">With the record (id, optional)<input className="i" value={adding.expect_id} onChange={e => setAdding({ ...adding, expect_id: e.target.value })} placeholder="e.g. building-15" /></label>
            <label className="f">Answer must contain (optional)<input className="i" value={adding.expect_text} onChange={e => setAdding({ ...adding, expect_text: e.target.value })} placeholder="e.g. 2222" /></label>
          </div>
          <div className="toolbar" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setAdding(null)}>Cancel</button><button className="btn primary" onClick={add} disabled={!adding.question}><Save size={15} />Add</button></div>
        </div>
      )}
      <div className="card tablewrap" style={{ padding: 0 }}>
        <table><thead><tr><th style={{ width: 28 }} /><th>Question</th><th>Expected</th><th>Got</th><th>Answer</th><th /></tr></thead><tbody>
          {rows.map((t: AssistantTest) => {
            const r = t.last_result;
            return (
              <tr key={t.id}>
                <td>{!r ? <span className="sub">—</span> : r.pass ? <CheckCircle2 size={17} color="var(--green)" /> : <CircleAlert size={17} color="var(--miss)" />}</td>
                <td><b>{t.question}</b>{t.lang !== 'en' && <span className="pill" style={{ marginLeft: 6 }}>{t.lang}</span>}</td>
                <td className="sub">{[t.expect_intent, t.expect_id, t.expect_text && `“${t.expect_text}”`].filter(Boolean).join(' · ') || 'anything'}</td>
                <td className="sub">{r ? `${r.intent}${r.id ? ` · ${r.id}` : ''} · ${r.answered_by}` : ''}{r && !r.pass && <div style={{ color: 'var(--miss)' }}>{r.why.join('; ')}</div>}</td>
                <td style={{ maxWidth: 320, fontSize: 12.5 }}>{r?.text}</td>
                <td><div className="toolbar" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn sm ghost" title="Run this one" disabled={!!running} onClick={() => run(!aiReady, t.id)}><Play size={13} /></button>
                  <button className="btn sm ghost" title="Delete" onClick={async () => { await api.deleteTest(t.id); tests.reload(); }}><Trash2 size={13} /></button>
                </div></td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
    </div>
  );
}

/** What people asked and how it was answered. Unanswered questions become rules in one click. */
function Log({ onRule }: { onRule: (q: string) => void }) {
  const { data, error } = useLoad(api.log);
  const [onlyGaps, setOnlyGaps] = useState(true);
  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const r of data ?? []) { const d = new Date(r.created_at); g[(d.getDay() + 6) % 7][d.getHours()]++; }
    return g;
  }, [data]);
  const rows = (data ?? []).filter(r => !onlyGaps || r.intent === 'unknown' || r.intent === 'error');
  const gaps = (data ?? []).filter(r => r.intent === 'unknown' || r.intent === 'error').length;
  return (
    <>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="label">When questions come in · last {data?.length ?? 0}</p>
        <Heatmap grid={heat} from={7} to={23} color="124,58,237" unit="questions" />
      </div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`chip ${onlyGaps ? 'on' : ''}`} onClick={() => setOnlyGaps(true)}>Not answered · {gaps}</button>
        <button className={`chip ${!onlyGaps ? 'on' : ''}`} onClick={() => setOnlyGaps(false)}>All · {data?.length ?? 0}</button>
      </div>
      <div className="card tablewrap" style={{ padding: 0, maxHeight: 620 }}><table><thead><tr><th>Question</th><th>Lang</th><th>Intent</th><th>Answered by</th><th>When</th><th /></tr></thead><tbody>
        {rows.map(r => (
          <tr key={r.id}><td>{r.question}</td><td>{r.lang}</td><td><span className={`pill ${r.intent === 'unknown' || r.intent === 'error' ? 'miss' : 'ok'}`}>{r.intent}</span></td><td>{r.answered_by}</td><td className="sub">{ago(r.created_at)}</td>
            <td>{(r.intent === 'unknown' || r.intent === 'error') && <button className="btn sm" onClick={() => onRule(r.question)}><Wand2 size={13} />Answer it</button>}</td></tr>
        ))}
      </tbody></table>{data && !rows.length && <p className="empty">Nothing here. Every question got an answer.</p>}</div>
    </>
  );
}
