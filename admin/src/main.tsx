import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarClock, ClipboardList, Flag, LayoutDashboard, LogOut, MapPinned, MessageSquareText, Signpost, Building2, Users, type LucideIcon } from 'lucide-react';
import './styles.css';
import { api, API_URL, clearToken, getToken, setToken } from './api';
import Overview from './screens/Overview';
import Places from './screens/Places';
import Offices from './screens/Offices';
import Procedures from './screens/Procedures';
import Reports from './screens/Reports';
import Services from './screens/Services';
import Issues from './screens/Issues';
import OfficeTime from './screens/OfficeTime';
import { AssistantLog } from './screens/Log';
import { Notice } from './ui';

const SECTIONS: [string, string, LucideIcon][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['places', 'Places & POIs', MapPinned],
  ['services', 'Offices & services', Building2],
  ['issues', 'Where to go for…', Signpost],
  ['offices', 'Faculty & staff', Users],
  ['time', 'Office time', CalendarClock],
  ['procedures', 'Procedures', ClipboardList],
  ['reports', 'Reports', Flag],
  ['log', 'Assistant log', MessageSquareText],
];
type Section = string;

/** Section and selection live in the URL hash, so a link opens the same screen. */
function useHash(): [Section, string | undefined, (s: string, id?: string) => void] {
  const read = () => { const [s, id] = location.hash.replace('#', '').split('/'); return [(SECTIONS.some(x => x[0] === s) ? s : 'overview'), id || undefined] as const; };
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
        {SECTIONS.map(([sid, name, Icon]) => (
          <button key={sid} className={`nav ${section === sid ? 'on' : ''}`} aria-current={section === sid ? 'page' : undefined} onClick={() => go(sid)}>
            <Icon size={17} strokeWidth={2} aria-hidden />{name}{badges[sid] ? <span className="badge">{badges[sid]}</span> : null}
          </button>
        ))}
        <div style={{ marginTop: 'auto' }}><button className="nav" onClick={() => { clearToken(); setAuthed(false); }}><LogOut size={17} aria-hidden />Sign out</button></div>
      </nav>
      <main className="main" key={section}>
        {section === 'overview' && <Overview go={go} />}
        {section === 'places' && <Places selected={id} select={pid => go('places', pid || undefined)} />}
        {section === 'services' && <Services selected={id} select={sid => go('services', sid || undefined)} />}
        {section === 'issues' && <Issues />}
        {section === 'time' && <OfficeTime go={go} />}
        {section === 'offices' && <Offices selected={id} select={pid => go('offices', pid)} />}
        {section === 'procedures' && <Procedures selected={id} select={pid => go('procedures', pid)} />}
        {section === 'reports' && <Reports />}
        {section === 'log' && <AssistantLog />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
