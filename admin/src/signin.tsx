import { useEffect, useState } from 'react';
import { KeyRound, LogIn } from 'lucide-react';
import { authConfig, clearSession, logIn, me, type AuthConfig, type SessionUser } from './auth';
import { Notice } from './ui';

/**
 * One sign-in screen for both dashboards: email + password, one-tap test accounts while they are on,
 * and the server token as a fallback for setup. `allowed` decides which roles may enter this dashboard.
 */
export function SignIn({ title, subtitle, allowed, tokenLabel, tokenHint, tryToken, onIn, resume }: {
  title: string; subtitle: string; allowed: SessionUser['role'][]; tokenLabel: string; tokenHint: React.ReactNode;
  tryToken: (token: string) => Promise<void>; onIn: (user: SessionUser | null) => void;
  /** a token typed earlier in this tab still works: go straight in */
  resume?: () => Promise<boolean>;
}) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>('start');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const enter = (u: SessionUser) => {
    if (allowed.includes(u.role)) { onIn(u); return true; }
    clearSession();
    setError(`${u.email} is a ${u.role} account. This dashboard is for ${allowed.join(' or ')} accounts: ask the GoMap team for access.`);
    return false;
  };
  useEffect(() => {
    (async () => {
      try {
        if (resume && await resume()) { onIn(null); return; }
        authConfig().then(setCfg).catch(() => setError('Cannot reach the GoMap API. Is the server running?'));
        const u = await me();
        if (u) enter(u);
      } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (e: string, p: string, key: string) => {
    setError(null); setBusy(key);
    try { enter(await logIn(e, p)); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };
  const submitToken = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await tryToken(token); onIn(null); } catch (err) { setError((err as Error).message); }
  };
  const tests = (cfg?.test_accounts ?? []).filter(a => allowed.includes(a.role));

  return (
    <div className="login">
      <div className="card signin">
        <div className="brand" style={{ padding: 0 }}><div className="logo">G</div><div><b>{title}</b><small>{subtitle}</small></div></div>
        {busy === 'start' && <p className="sub" style={{ textAlign: 'center' }}>Checking your sign-in…</p>}
        <form className="stack" style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); void signIn(email.trim(), password, 'form'); }}>
          <label className="f">Email<input className="i" type="email" autoComplete="username" placeholder={`you@${cfg?.allowed_domains[0] ?? 'aui.ma'}`} value={email} onChange={e => setEmail(e.target.value)} autoFocus /></label>
          <label className="f">Password<input className="i" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          <button className="btn dark" type="submit" disabled={!email || !password || !!busy}><LogIn size={15} />{busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {error && <Notice tone="miss">{error}</Notice>}

        {!!tests.length && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="sub" style={{ margin: '4px 0 0', fontSize: 12 }}>Test accounts · password <b>{cfg?.test_password}</b></p>
            {tests.map(a => (
              <button key={a.email} className="btn testacct" disabled={!!busy} onClick={() => signIn(a.email, cfg?.test_password ?? '', a.email)}>
                <span className={`pill role-${a.role}`}>{a.role}</span><span style={{ flex: 1, textAlign: 'left' }}>{a.email}</span>{busy === a.email && '…'}
              </button>
            ))}
          </div>
        )}

        {!showToken ? (
          <button className="btn ghost sm" onClick={() => setShowToken(true)}><KeyRound size={14} />Use a server token instead</button>
        ) : (
          <form className="stack" style={{ gap: 10 }} onSubmit={submitToken}>
            <label className="f">{tokenLabel}<input className="i" type="password" value={token} onChange={e => setToken(e.target.value)} autoFocus /></label>
            <button className="btn" type="submit" disabled={!token}>Sign in with the token</button>
            <p className="sub" style={{ fontSize: 12, margin: 0 }}>{tokenHint}</p>
          </form>
        )}
        <p className="sub" style={{ fontSize: 12, margin: 0 }}>No account yet? Create one in the GoMap app (Your account → Create account), then ask a developer for the role.</p>
      </div>
    </div>
  );
}
