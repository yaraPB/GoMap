/**
 * A stand-in for login.microsoftonline.com, for end-to-end tests only. It speaks the same protocol
 * (OpenID discovery, authorize page, token endpoint with PKCE, signing keys), so the real sign-in
 * code in the app, the dashboards and the server runs unchanged. Point MICROSOFT_AUTHORITY at it.
 *
 *   node fake-microsoft.mjs [port]     → http://localhost:4100
 */
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export const TID = 'e2e-aui-tenant';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e-key', use: 'sig', alg: 'RS256' };
const codes = new Map();
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function startFakeMicrosoft(port = 4100) {
  const base = `http://localhost:${port}`;
  const idToken = (email, clientId, nonce) => {
    const t = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'e2e-key' });
    const body = b64({ iss: `${base}/${TID}/v2.0`, aud: clientId, tid: TID, oid: `oid-${email}`, name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      preferred_username: email, email, iat: t, nbf: t, exp: t + 3600, ...(nonce ? { nonce } : {}) });
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, base);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    const m = url.pathname.match(/^\/([^/]+)\/(.*)$/);
    if (!m) { json(404, { error: 'not_found' }); return; }
    const [, tenant, rest] = m;
    if (rest === 'v2.0/.well-known/openid-configuration') {
      json(200, { issuer: `${base}/{tenantid}/v2.0`, authorization_endpoint: `${base}/${tenant}/oauth2/v2.0/authorize`, token_endpoint: `${base}/${tenant}/oauth2/v2.0/token`,
        jwks_uri: `${base}/${tenant}/discovery/v2.0/keys`, response_types_supported: ['code'], subject_types_supported: ['pairwise'], id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'profile', 'email'], code_challenge_methods_supported: ['S256'] });
      return;
    }
    if (rest === 'discovery/v2.0/keys') { json(200, { keys: [jwk] }); return; }
    if (rest === 'oauth2/v2.0/authorize') {
      const p = Object.fromEntries(url.searchParams);
      if (p.email) { // the account was picked: issue a code and go back to the app, like Microsoft
        const code = randomBytes(16).toString('hex');
        codes.set(code, { email: p.email.toLowerCase(), client_id: p.client_id, redirect_uri: p.redirect_uri, challenge: p.code_challenge, nonce: p.nonce });
        const back = new URL(p.redirect_uri); back.searchParams.set('code', code); if (p.state) back.searchParams.set('state', p.state);
        res.writeHead(302, { location: back.toString() }); res.end(); return;
      }
      const hidden = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>Sign in to your account</title><body style="font-family:Segoe UI,Arial;max-width:420px;margin:60px auto">
        <h1 style="font-size:22px">Fake Microsoft sign-in (tests)</h1><form method="get">${hidden}
        <input name="email" aria-label="Email" placeholder="someone@aui.ma" style="width:100%;padding:8px;font-size:15px">
        <button type="submit" style="margin-top:12px;padding:8px 16px">Sign in</button></form></body>`);
      return;
    }
    if (rest === 'oauth2/v2.0/token' && req.method === 'POST') {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        const p = Object.fromEntries(new URLSearchParams(data));
        const c = codes.get(p.code);
        if (!c) { json(400, { error: 'invalid_grant', error_description: 'AADSTS70008: The code expired or was already used.' }); return; }
        codes.delete(p.code);
        const challenge = createHash('sha256').update(p.code_verifier ?? '').digest('base64url');
        if (challenge !== c.challenge) { json(400, { error: 'invalid_grant', error_description: 'AADSTS501481: The code_verifier does not match the code_challenge.' }); return; }
        if (p.client_id !== c.client_id || p.redirect_uri !== c.redirect_uri) { json(400, { error: 'invalid_grant', error_description: 'AADSTS50148: client or redirect_uri mismatch.' }); return; }
        json(200, { token_type: 'Bearer', scope: 'openid profile email', expires_in: 3600, access_token: randomBytes(24).toString('hex'), id_token: idToken(c.email, c.client_id, c.nonce) });
      });
      return;
    }
    json(404, { error: 'not_found', path: url.pathname });
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, base })));
}

if (process.argv[1]?.endsWith('fake-microsoft.mjs')) {
  const { base } = await startFakeMicrosoft(Number(process.argv[2] ?? 4100));
  console.log(`fake Microsoft on ${base}`);
}
