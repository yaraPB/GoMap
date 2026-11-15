import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BriefcaseBusiness, Code2, GraduationCap, KeyRound, LogOut, Presentation, Search, ShieldCheck, Trash2, UserPlus, Users, type LucideIcon } from 'lucide-react';
import '../styles.css';
import { API_URL, ago } from '../api';
import { clearSession, type SessionUser } from '../auth';
import { SignIn } from '../signin';
import { Notice, Tags, useLoad } from '../ui';
import { clearDevToken, dev, setDevToken, type DevUser, type Resolution, type Role } from './api';

const LOOK: Record<Role, { name: string; icon: LucideIcon; color: string; bg: string }> = {
  student: { name: 'Student', icon: GraduationCap, color: '#2563EB', bg: '#EEF3FF' },
  faculty: { name: 'Faculty', icon: Presentation, color: '#0B7A47', bg: '#E5F5EC' },
  staff: { name: 'Staff', icon: BriefcaseBusiness, color: '#8A5A00', bg: '#FFF4DC' },
  admin: { name: 'Admin', icon: ShieldCheck, color: '#6D28D9', bg: '#F1E8FF' },
  dev: { name: 'Developer', icon: Code2, color: '#B91C1C', bg: '#FEECEC' },
};
const ROLES = Object.keys(LOOK) as Role[];
const SOURCE: Record<string, string> = { dev: 'assigned here', directory: 'from the faculty directory', domain: 'allowed domain', bootstrap: 'DEV_EMAILS', test: 'test account' };

function RolePill({ role }: { role: Role }) {
  const l = LOOK[role]; const Icon = l.icon;
  return <span className="pill" style={{ background: l.bg, color: l.color }}><Icon size={13} />{l.name}</span>;
}

/** Link a faculty / staff account to their office card, so they can post their status. */
function PersonPicker({ value, onPick }: { value: DevUser['person']; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const found = useLoad(() => (open && q.length > 1 ? dev.people(q) : Promise.resolve([])), [q, open]);
  if (!open) return <button className="btn sm ghost" onClick={() => setOpen(true)}>{value ? value.name : 'Link office card'}</button>;
  return (
    <div style={{ position: 'relative' }}>
      <input className="i" style={{ height: 30, width: 180 }} autoFocus placeholder="Type a name…" value={q} onChange={e => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {!!found.data?.length && (
        <div className="pop" style={{ top: 34, left: 0, width: 260, padding: 6 }}>
          {found.data.map(p => <button key={p.id} className="row" onMouseDown={() => { onPick(p.id); setOpen(false); }}><span className="grow"><b>{p.name}</b><small>{p.email ?? 'no email'} · {p.role}</small></span></button>)}
          {value && <button className="row" onMouseDown={() => { onPick(null); setOpen(false); }}><span className="grow"><small>Unlink {value.name}</small></span></button>}
        </div>
      )}
    </div>
  );
}

function Dashboard({ who, onOut }: { who: SessionUser | null; onOut: () => void }) {
  const data = useLoad(dev.users);
  const activity = useLoad(dev.activity);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('student');
  const [bulk, setBulk] = useState('');
  const [check, setCheck] = useState<{ email: string; r: Resolution } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'miss'; text: string } | null>(null);
  const users = data.data?.users ?? [];
  const shown = useMemo(() => users.filter(u => (!role || u.role === role) && (!q || `${u.email} ${u.name ?? ''} ${u.person?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [users, q, role]);
  const counts = useMemo(() => Object.fromEntries(ROLES.map(r => [r, users.filter(u => u.role === r).length])), [users]);
  const run = async (f: () => Promise<unknown>, ok: string) => { setMsg(null); try { await f(); setMsg({ tone: 'ok', text: ok }); data.reload(); activity.reload(); } catch (e) { setMsg({ tone: 'miss', text: (e as Error).message }); } };
  const s = data.data?.settings;

  useEffect(() => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setCheck(null); return; }
    const id = setTimeout(() => dev.check(e).then(r => setCheck({ email: e, r })).catch(() => {}), 300);
    return () => clearTimeout(id);
  }, [email]);

  return (
    <div className="devshell">
      <header className="devhead">
        <div className="brand" style={{ padding: 0 }}><div className="logo" style={{ background: 'linear-gradient(135deg,#B91C1C,#6D28D9)' }}>D</div><div><b>GoMap Dev</b><small>Who can do what</small></div></div>
        <div className="toolbar">
          {who && <span className="sub" style={{ margin: 0 }}>{who.email}</span>}
          <a className="btn sm" href="./">Admin dashboard</a>
          <button className="btn sm ghost" onClick={onOut}><LogOut size={14} />Sign out</button>
        </div>
      </header>
      <main className="main" style={{ margin: '0 auto' }}>
        <div className="head"><div><h1>Roles</h1><p className="sub">People create their account in the app with their email and a password. A role assigned here wins over every automatic rule, and applies at their next tap, no sign-out needed. Assign an email before they sign up and the role is waiting for them.</p></div></div>
        {data.error && <Notice tone="miss">{data.error}</Notice>}
        {msg && <div style={{ marginBottom: 12 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}

        <div className="tiles">
          {ROLES.map(r => { const l = LOOK[r]; const Icon = l.icon; return (
            <button key={r} className="tile" style={{ textAlign: 'left', cursor: 'pointer', outline: role === r ? `2px solid ${l.color}` : undefined }} onClick={() => setRole(role === r ? '' : r)}>
              <div className="toolbar" style={{ color: l.color }}><Icon size={16} /><span className="l" style={{ color: l.color }}>{l.name}</span></div>
              <div className="v">{counts[r] ?? 0}</div>
              <div className="sub" style={{ fontSize: 11.5 }}>{data.data?.roles.find(x => x.id === r)?.can}</div>
            </button>
          ); })}
        </div>

        <div className="cols" style={{ marginBottom: 16 }}>
          <form className="card stack" style={{ gap: 12 }} onSubmit={e => { e.preventDefault(); void run(async () => { await dev.assign({ email, role: newRole }); setEmail(''); }, `${email} is now ${LOOK[newRole].name.toLowerCase()}.`); }}>
            <h2 style={{ margin: 0 }}><UserPlus size={16} style={{ verticalAlign: -3 }} /> Give someone a role</h2>
            <div className="toolbar">
              <input className="i" style={{ flex: 1, minWidth: 220 }} type="email" placeholder="name@aui.ma" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" />
              <select className="i" value={newRole} onChange={e => setNewRole(e.target.value as Role)} aria-label="Role">{ROLES.map(r => <option key={r} value={r}>{LOOK[r].name}</option>)}</select>
              <button className="btn primary" disabled={!email}>Assign</button>
            </div>
            {check && check.email === email.trim() && (
              'refused' in check.r
                ? <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>Today this email <b>cannot create an account</b>. Assigning a role lets them in.</p>
                : <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>Today their account would be <RolePill role={check.r.role} /> ({SOURCE[check.r.source] ?? check.r.source}{check.r.name ? ` · ${check.r.name}` : ''}).</p>
            )}
            <details>
              <summary className="sub" style={{ cursor: 'pointer' }}>Many at once</summary>
              <textarea className="i" style={{ width: '100%', marginTop: 8 }} rows={4} placeholder={'one per line:\nname@aui.ma\nother@aui.ma, staff'} value={bulk} onChange={e => setBulk(e.target.value)} />
              <button type="button" className="btn sm" style={{ marginTop: 6 }} disabled={!bulk.trim()} onClick={() => void run(async () => { const r = await dev.bulk(bulk, newRole); setBulk(''); if (r.failed.length) throw new Error(`${r.assigned} assigned; not understood: ${r.failed.map(f => f.line).join(', ')}`); }, 'All assigned.')}>Assign all (default role: {LOOK[newRole].name})</button>
            </details>
          </form>

          {s && (
            <div className="card stack" style={{ gap: 12 }}>
              <h2 style={{ margin: 0 }}><Users size={16} style={{ verticalAlign: -3 }} /> Who may create an account without being listed</h2>
              <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Email domains let in automatically
                <Tags value={s.allowed_domains} onChange={allowed_domains => void run(() => dev.saveSettings({ allowed_domains }), 'Domains saved.')} placeholder="e.g. alumni.aui.ma — press Enter" />
              </div>
              <label className="f" style={{ maxWidth: 260 }}>…and they start as
                <select className="i" value={s.default_role} onChange={e => void run(() => dev.saveSettings({ default_role: e.target.value as Role }), 'Default role saved.')}>
                  {(['student', 'faculty', 'staff'] as Role[]).map(r => <option key={r} value={r}>{LOOK[r].name}</option>)}
                </select>
              </label>
              <p className="sub" style={{ margin: 0, fontSize: 12.5 }}>Faculty and staff found in the directory get their role and office card automatically.</p>
              <label className="toolbar" style={{ fontSize: 13 }}><input type="checkbox" checked={s.demo_accounts} onChange={e => void run(() => dev.saveSettings({ demo_accounts: e.target.checked }), e.target.checked ? 'Test accounts on.' : 'Test accounts off: s.student@aui.ma and the others can no longer sign in.')} />Test accounts (s.student@aui.ma, f.faculty@aui.ma, st.staff@aui.ma, a.admin@aui.ma, d.dev@aui.ma · password 123abc). Turn off before launch</label>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="toolbar" style={{ padding: 12, borderBottom: '1px solid var(--hair)' }}>
            <Search size={15} color="var(--muted)" />
            <input className="search" style={{ flex: 1, border: 0 }} placeholder="Find an email or name" value={q} onChange={e => setQ(e.target.value)} />
            {role && <button className="chip on" onClick={() => setRole('')}>{LOOK[role].name} ✕</button>}
            <span className="sub" style={{ margin: 0 }}>{shown.length} of {users.length}</span>
          </div>
          <div className="tablewrap"><table><thead><tr><th>Person</th><th>Role</th><th>Office card</th><th>How</th><th>Last sign-in</th><th /></tr></thead><tbody>
            {shown.map(u => (
              <tr key={u.id}>
                <td><b>{u.name ?? u.email.split('@')[0]}</b><div className="sub" style={{ margin: 0, fontSize: 12 }}>{u.email}</div></td>
                <td><select className="i" style={{ height: 32, color: LOOK[u.role].color, fontWeight: 600 }} value={u.role} aria-label={`Role of ${u.email}`}
                  onChange={e => void run(() => dev.update(u.id, { role: e.target.value as Role }), `${u.email} is now ${LOOK[e.target.value as Role].name.toLowerCase()}.`)}>
                  {ROLES.map(r => <option key={r} value={r}>{LOOK[r].name}</option>)}</select></td>
                <td>{u.role === 'faculty' || u.role === 'staff' ? <PersonPicker value={u.person} onPick={id => void run(() => dev.update(u.id, { person_id: id }), id ? 'Office card linked.' : 'Office card unlinked.')} /> : <span className="sub">—</span>}</td>
                <td className="sub">{SOURCE[u.source] ?? u.source}{u.assigned_by ? ` · by ${u.assigned_by}` : ''}</td>
                <td className="sub">{!u.has_password ? 'no account yet (role waiting)' : u.last_login_at ? `${ago(u.last_login_at)} · ${u.logins}×` : 'never'}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" aria-label={`Set a password for ${u.email}`} title="Set or reset their password"
                  onClick={() => { const p = prompt(`New password for ${u.email} (at least 6 characters). Tell them; they can change it in the app.`); if (p) void run(() => dev.setPassword(u.id, p), `Password set for ${u.email}.`); }}><KeyRound size={14} /></button>
                <button className="btn sm ghost" aria-label={`Remove ${u.email}`} title="Remove: they fall back to the automatic rules"
                  onClick={() => { if (confirm(`Remove ${u.email}? They fall back to the automatic rules (domain / directory).`)) void run(() => dev.remove(u.id), `${u.email} removed.`); }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody></table>{!shown.length && <p className="empty">{users.length ? 'Nobody matches.' : 'Nobody yet. People appear here when they create an account or when you assign them.'}</p>}</div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <p className="label">Recent changes</p>
          <div className="list">
            {(activity.data ?? []).slice(0, 15).map(a => (
              <div key={a.id} className="row" style={{ cursor: 'default' }}>
                <span className="grow"><b>{a.action}</b> {String(a.detail?.email ?? a.entity_id)}{a.detail?.role ? ` → ${String(a.detail.role)}` : ''}{a.detail?.to ? ` → ${String(a.detail.to)}` : ''}<small>{a.actor} · {ago(a.created_at)}</small></span>
              </div>
            ))}
            {activity.data && !activity.data.length && <p className="sub">Nothing yet.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const [state, setState] = useState<{ in: boolean; who: SessionUser | null }>({ in: false, who: null });
  if (!state.in) return (
    <SignIn title="GoMap Dev" subtitle="Roles and access" allowed={['dev']} onIn={who => setState({ in: true, who })}
      tokenLabel="Dev token" tokenHint={<>API: {API_URL}. The token is DEV_TOKEN in server/.env (setup and scripts; d.dev@aui.ma / 123abc works while test accounts are on).</>}
      tryToken={async t => { setDevToken(t); try { await dev.users(); } catch (err) { clearDevToken(); throw err; } }}
      resume={async () => { if (!sessionStorage.getItem('gomap-dev-token')) return false; try { await dev.users(); return true; } catch { return false; } }} />
  );
  return <Dashboard who={state.who} onOut={() => { clearDevToken(); clearSession(); setState({ in: false, who: null }); }} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
