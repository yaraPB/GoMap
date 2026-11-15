import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { authConfig, finishMicrosoftSignIn, me, MicrosoftMark, startMicrosoftSignIn, type AuthConfig, type SessionUser } from './auth';
import { Notice } from './ui';

/**
 * One sign-in screen for both dashboards: "Sign in with Outlook" (the AUI Microsoft account), and the
 * server token as a fallback for setup. `allowed` decides which roles may enter this dashboard.
 */
export function SignIn({ title, subtitle, allowed, tokenLabel, tokenHint, tryToken, onIn, resume }: {
  title: string; subtitle: string; allowed: SessionUser['role'][]; tokenLabel: string; tokenHint: React.ReactNode;
  tryToken: (token: string) => Promise<void>; onIn: (user: SessionUser | null) => void;
  /** a token typed earlier in this tab still works: go straight in */
  resume?: () => Promise<boolean>;
}) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        if (resume && await resume()) { onIn(null); return; }
        const c = await authConfig();
        setCfg(c);
        const back = await finishMicrosoftSignIn();
        const u = back ?? await me();
        if (u) {
          if (allowed.includes(u.role)) { onIn(u); return; }
          setError(`You are signed in as ${u.email} (${u.role}). This dashboard is for ${allowed.join(' or ')} accounts: ask the GoMap team for access.`);
        }
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await tryToken(token); onIn(null); } catch (err) { setError((err as Error).message); }
  };
  return (
    <div className="login">
      <div className="card signin">
        <div className="brand" style={{ padding: 0 }}><div className="logo">G</div><div><b>{title}</b><small>{subtitle}</small></div></div>
        {cfg?.microsoft ? (
          <button className="btn ms" disabled={busy} onClick={() => startMicrosoftSignIn(cfg.microsoft!)}><MicrosoftMark />Sign in with Outlook</button>
        ) : !busy && <Notice tone="info">Sign in with Outlook is not set up on the server yet (MICROSOFT_CLIENT_ID, see the setup guide). Use the token below.</Notice>}
        {busy && <p className="sub" style={{ textAlign: 'center' }}>Checking your sign-in…</p>}
        {error && <Notice tone="miss">{error}</Notice>}
        {cfg?.microsoft && !showToken ? (
          <button className="btn ghost sm" onClick={() => setShowToken(true)}><KeyRound size={14} />Use a server token instead</button>
        ) : (
          <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
            <label className="f">{tokenLabel}<input className="i" type="password" value={token} onChange={e => setToken(e.target.value)} autoFocus={!cfg?.microsoft} /></label>
            <button className="btn dark" type="submit" disabled={!token}>Sign in with the token</button>
            <p className="sub" style={{ fontSize: 12, margin: 0 }}>{tokenHint}</p>
          </form>
        )}
      </div>
    </div>
  );
}
