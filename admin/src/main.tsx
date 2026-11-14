import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, API_URL, clearToken, getToken, setToken } from './api';
import Overview from './screens/Overview';
import Places from './screens/Places';
import Offices from './screens/Offices';
import Procedures from './screens/Procedures';
import Reports from './screens/Reports';
import { AssistantLog, Changes } from './screens/Log';
import { Notice } from './ui';

const SECTIONS = [
  ['overview', 'Overview'], ['places', 'Places & POIs'], ['offices', 'Offices & hours'], ['procedures', 'Services & procedures'],
  ['reports', 'Reports'], ['log', 'Assistant log'], ['changes', 'Change history'],
] as const;
type Section = typeof SECTIONS[number][0];

/** Section and selection live in the URL hash, so a link opens the same screen. */
function useHash(): [Section, string | undefined, (s: string, id?: string) => void] {
  const read = () => { const [s, id] = location.hash.replace('#', '').split('/'); return [(SECTIONS.some(x => x[0] === s) ? s : 'overview') as Section, id || undefined] as const; };
  const [state, setState] = useState(read);
  useEffect(() => { const on = () => setState(read()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return [state[0], state[1], (s, id) => { location.hash = id ? `${s}/${id}` : s; }];
}

function Login({ onIn }: { onIn: () => void }) {
  const [token, setT] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setToken(token);
    try { await api.overview(); onIn(); } catch (err) { clearToken(); setError((err as Error).message); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="logo">G</div><div><b>GoMap Admin</b><small>Al Akhawayn University</small></div></div>
        {/* TODO: replace with GoCampus SSO */}
        <label className="f">Admin token<input className="i" type="password" value={token} onChange={e => setT(e.target.value)} autoFocus placeholder="ADMIN_TOKEN from server/.env" /></label>
        {error && <Notice tone="miss">{error}</Notice>}
        <button className="btn dark" type="submit">Sign in</button>
        <p className="sub" style={{ fontSize: 12 }}>API: {API_URL}. Local default token: <code>dev-admin-token</code>.</p>
      </form>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [section, id, go] = useHash();
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => { if (authed) api.overview().then(o => setBadges({ reports: o.counts.open_reports, offices: o.counts.conflicts, log: o.counts.unanswered })).catch(() => {}); }, [authed, section]);
  if (!authed) return <Login onIn={() => setAuthed(true)} />;
  return (
    <div className="shell">
      <nav className="side" aria-label="Sections">
        <div className="brand"><div className="logo">G</div><div><b>GoMap Admin</b><small>Al Akhawayn University</small></div></div>
        {SECTIONS.map(([sid, name]) => (
          <button key={sid} className={`nav ${section === sid ? 'on' : ''}`} aria-current={section === sid ? 'page' : undefined} onClick={() => go(sid)}>
            {name}{badges[sid] ? <span className="badge">{badges[sid]}</span> : null}
          </button>
        ))}
        <div style={{ marginTop: 'auto' }}><button className="nav" onClick={() => { clearToken(); setAuthed(false); }}>Sign out</button></div>
      </nav>
      <main className="main">
        {section === 'overview' && <Overview go={go} />}
        {section === 'places' && <Places selected={id} select={pid => go('places', pid)} />}
        {section === 'offices' && <Offices selected={id} select={pid => go('offices', pid)} />}
        {section === 'procedures' && <Procedures selected={id} select={pid => go('procedures', pid)} />}
        {section === 'reports' && <Reports />}
        {section === 'log' && <AssistantLog />}
        {section === 'changes' && <Changes />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
