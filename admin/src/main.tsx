import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot, Wrench, CalendarClock, CalendarDays, ClipboardList, Flag, LayoutDashboard, LogOut, MapPinned, Signpost, Building2, Users, type LucideIcon } from 'lucide-react';
import './styles.css';
import { api, API_URL, clearToken, setToken } from './api';
import type { SessionUser } from './auth';
import { SignIn } from './signin';
import Overview from './screens/Overview';
import Places from './screens/Places';
import Offices from './screens/Offices';
import Procedures from './screens/Procedures';
import Reports from './screens/Reports';
import Services from './screens/Services';
import Issues from './screens/Issues';
import OfficeTime from './screens/OfficeTime';
import Assistant from './screens/Assistant';
import Events from './screens/Events';

const SECTIONS: [string, string, LucideIcon][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['places', 'Places & POIs', MapPinned],
  ['events', 'Events', CalendarDays],
  ['services', 'Offices & services', Building2],
  ['issues', 'Where to go for…', Signpost],
  ['offices', 'Faculty & staff', Users],
  ['time', 'Office time', CalendarClock],
  ['procedures', 'Procedures', ClipboardList],
  ['reports', 'Reports', Flag],
  ['assistant', 'Assistant', Bot],
];
type Section = string;

/** Section and selection live in the URL hash, so a link opens the same screen. */
function useHash(): [Section, string | undefined, (s: string, id?: string) => void] {
  const read = () => { const [s, id] = location.hash.replace('#', '').split('/'); return [(SECTIONS.some(x => x[0] === s) || s === 'log' ? s : 'overview'), id || undefined] as const; };
  const [state, setState] = useState(read);
  useEffect(() => { const on = () => setState(read()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return [state[0], state[1], (s, id) => { location.hash = id ? `${s}/${id}` : s; }];
}

function Login({ onIn }: { onIn: (u: SessionUser | null) => void }) {
  return (
    <SignIn title="GoMap Admin" subtitle="Al Akhawayn University" allowed={['admin', 'dev']} onIn={onIn}
      tokenLabel="Admin token" tokenHint={<>API: {API_URL}. The token is ADMIN_TOKEN in server/.env (local default <code>dev-admin-token</code>).</>}
      tryToken={async t => { setToken(t); try { await api.overview(); } catch (err) { clearToken(); throw err; } }}
      resume={async () => { if (!sessionStorage.getItem('gomap-admin-token')) return false; try { await api.overview(); return true; } catch { return false; } }} />
  );
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [who, setWho] = useState<SessionUser | null>(null);
  const [section, id, go] = useHash();
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => { if (authed) api.overview().then(o => setBadges({ reports: o.counts.open_reports, offices: o.counts.conflicts, assistant: o.counts.unanswered })).catch(() => {}); }, [authed, section]);
  if (!authed) return <Login onIn={u => { setWho(u); setAuthed(true); }} />;
  return (
    <div className="shell">
      <nav className="side" aria-label="Sections">
        <div className="brand"><div className="logo">G</div><div><b>GoMap Admin</b><small>Al Akhawayn University</small></div></div>
        {SECTIONS.map(([sid, name, Icon]) => (
          <button key={sid} className={`nav ${section === sid ? 'on' : ''}`} aria-current={section === sid ? 'page' : undefined} onClick={() => go(sid)}>
            <Icon size={17} strokeWidth={2} aria-hidden />{name}{badges[sid] ? <span className="badge">{badges[sid]}</span> : null}
          </button>
        ))}
        <div style={{ marginTop: 'auto' }}>
          {who && <div className="whoami"><b>{who.name}</b><small>{who.email} · {who.role}</small></div>}
          {who?.role === 'dev' && <a className="nav" href="dev.html"><Wrench size={17} aria-hidden />Dev dashboard</a>}
          <button className="nav" onClick={() => { clearToken(); setAuthed(false); setWho(null); }}><LogOut size={17} aria-hidden />Sign out</button>
        </div>
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
        {section === 'events' && <Events />}
        {section === 'assistant' && <Assistant tab={id} />}
        {section === 'log' && <Assistant tab="log" />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
