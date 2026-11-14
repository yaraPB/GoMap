import { api, ago } from '../api';
import { Notice, useLoad } from '../ui';

export function AssistantLog() {
  const { data, error } = useLoad(api.log);
  return (
    <>
      <div className="head"><div><h1>Assistant log</h1><p className="sub">What people asked, and how it was answered. “unknown” rows are gaps to fill in the register.</p></div></div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card"><table><thead><tr><th>Question</th><th>Lang</th><th>Intent</th><th>Answered by</th><th>When</th></tr></thead><tbody>
        {(data ?? []).map(r => <tr key={r.id}><td>{r.question}</td><td>{r.lang}</td><td><span className={`pill ${r.intent === 'unknown' || r.intent === 'error' ? 'miss' : 'ok'}`}>{r.intent}</span></td><td>{r.answered_by}</td><td className="sub">{ago(r.created_at)}</td></tr>)}
      </tbody></table>{data && !data.length && <p className="empty">No questions yet.</p>}</div>
    </>
  );
}

export function Changes() {
  const { data, error } = useLoad(api.changes);
  return (
    <>
      <div className="head"><div><h1>Change history</h1><p className="sub">Every edit made here, newest first.</p></div></div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card"><table><thead><tr><th>What</th><th>Action</th><th>Details</th><th>Who</th><th>When</th></tr></thead><tbody>
        {(data ?? []).map(c => <tr key={c.id}><td>{c.entity} <b>{c.entity_id}</b></td><td>{c.action}</td><td className="sub" style={{ fontSize: 12, maxWidth: 420, wordBreak: 'break-word' }}>{c.detail ? JSON.stringify(c.detail).slice(0, 220) : ''}</td><td>{c.actor}</td><td className="sub">{ago(c.created_at)}</td></tr>)}
      </tbody></table>{data && !data.length && <p className="empty">No changes yet.</p>}</div>
    </>
  );
}
