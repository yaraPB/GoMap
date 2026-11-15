import { useMemo, useState } from 'react';
import { api, ago } from '../api';
import { Heatmap, Notice, useLoad } from '../ui';

/** What people asked and how it was answered. The calendar shows when questions come in. */
export function AssistantLog() {
  const { data, error } = useLoad(api.log);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const heat = useMemo(() => {
    const g = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const r of data ?? []) { const d = new Date(r.created_at); g[(d.getDay() + 6) % 7][d.getHours()]++; }
    return g;
  }, [data]);
  const rows = (data ?? []).filter(r => !onlyGaps || r.intent === 'unknown' || r.intent === 'error');
  const gaps = (data ?? []).filter(r => r.intent === 'unknown' || r.intent === 'error').length;
  return (
    <>
      <div className="head"><div><h1>Assistant log</h1><p className="sub">What people asked, and how it was answered. Unanswered questions are gaps to fill in the register.</p></div></div>
      {error && <Notice tone="miss">{error}</Notice>}
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="label">When questions come in · last {data?.length ?? 0}</p>
        <Heatmap grid={heat} from={7} to={23} color="124,58,237" unit="questions" />
      </div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`chip ${!onlyGaps ? 'on' : ''}`} onClick={() => setOnlyGaps(false)}>All · {data?.length ?? 0}</button>
        <button className={`chip ${onlyGaps ? 'on' : ''}`} onClick={() => setOnlyGaps(true)}>Not answered · {gaps}</button>
      </div>
      <div className="card tablewrap" style={{ padding: 0, maxHeight: 620 }}><table><thead><tr><th>Question</th><th>Lang</th><th>Intent</th><th>Answered by</th><th>When</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{r.question}</td><td>{r.lang}</td><td><span className={`pill ${r.intent === 'unknown' || r.intent === 'error' ? 'miss' : 'ok'}`}>{r.intent}</span></td><td>{r.answered_by}</td><td className="sub">{ago(r.created_at)}</td></tr>)}
      </tbody></table>{data && !rows.length && <p className="empty">No questions here.</p>}</div>
    </>
  );
}
