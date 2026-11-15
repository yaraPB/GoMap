/**
 * Sign in with Outlook, end to end against a stand-in for Microsoft: our own RSA key plays
 * Microsoft's signing key, served as its JWKS. Everything the server does with a real token runs.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { boot } from '../src/boot.js';
import { createApp } from '../src/app.js';
import { signSession, verifyMicrosoftIdToken, verifySession } from '../src/auth/tokens.js';

const AUTHORITY = 'https://login.example-microsoft.test';
const CLIENT = '11111111-2222-3333-4444-555555555555';
const TID = 'aui-tenant-id';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown> = {}, key = privateKey, kid = 'test-key') {
  const t = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64({ iss: `${AUTHORITY}/${TID}/v2.0`, aud: CLIENT, tid: TID, oid: 'oid-1', name: 'Test Person', preferred_username: 'someone@aui.ma', iat: t, nbf: t, exp: t + 3600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const fakeMicrosoft = (async (url: string | URL | Request) => {
  if (String(url).startsWith(AUTHORITY) && String(url).endsWith('/discovery/v2.0/keys')) return Response.json({ keys: [jwk] });
  return new Response('not found', { status: 404 });
}) as typeof fetch;
const cfg = { clientId: CLIENT, tenant: 'organizations', authority: AUTHORITY, fetchImpl: fakeMicrosoft };

test('a genuine Microsoft ID token is accepted; forged, foreign or expired ones are not', async () => {
  const me = await verifyMicrosoftIdToken(idToken({ preferred_username: 'A.Student@AUI.ma' }), cfg);
  assert.equal(me.email, 'a.student@aui.ma');
  await assert.rejects(verifyMicrosoftIdToken(idToken({}, other), cfg), /signature/);
  await assert.rejects(verifyMicrosoftIdToken(idToken({ aud: 'another-app' }), cfg), /another app/);
  await assert.rejects(verifyMicrosoftIdToken(idToken({ iss: 'https://evil.test/x/v2.0' }), cfg), /issuer/);
  await assert.rejects(verifyMicrosoftIdToken(idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), cfg), /expired/);
  await assert.rejects(verifyMicrosoftIdToken(idToken({}, privateKey, 'unknown-kid'), cfg), /Unknown signing key/);
  await assert.rejects(verifyMicrosoftIdToken(idToken(), { ...cfg, tenant: 'real-aui-tenant' }), /issuer|Al Akhawayn/);
});

test('GoMap sessions: valid, tampered, expired', () => {
  const s = signSession({ sub: 'u1', email: 'x@aui.ma' }, 'secret');
  assert.equal(verifySession(s, 'secret').sub, 'u1');
  assert.throws(() => verifySession(s, 'other-secret'), /signature/);
  assert.throws(() => verifySession(signSession({ sub: 'u1', email: 'x' }, 'secret', -10), 'secret'), /expired/);
  const [h, , sig] = s.split('.');
  assert.throws(() => verifySession(`${h}.${b64({ sub: 'admin', email: 'x', iss: 'gomap', exp: 9e9 })}.${sig}`, 'secret'), /signature/);
});

let server: Server;
let base = '';
let ctx: Awaited<ReturnType<typeof boot>>;
const env = { MICROSOFT_CLIENT_ID: CLIENT, MICROSOFT_AUTHORITY: AUTHORITY, MICROSOFT_TENANT: 'organizations', SESSION_SECRET: 'test-secret', DEV_EMAILS: 'boss@aui.ma', DEV_TOKEN: '' };
const saved: Record<string, string | undefined> = {};
before(async () => {
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  ctx = await boot({ mongoUri: '', sqliteFile: ':memory:', geminiKey: '', provider: 'gemini', quiet: true });
  server = createApp({ ...ctx, fetchImpl: fakeMicrosoft }).listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>(r => server.close(() => r())); await ctx.close();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const call = async (path: string, opts: { token?: string; method?: string; body?: unknown } = {}) => {
  const r = await fetch(base + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, body: await r.json() as any };
};
const signIn = async (email: string) => call('/api/auth/microsoft', { body: { id_token: idToken({ preferred_username: email, oid: `oid-${email}` }) } });

test('the apps learn how to start a Microsoft sign-in', async () => {
  const { body } = await call('/api/auth/config');
  assert.deepEqual(body.microsoft, { client_id: CLIENT, tenant: 'organizations', authority: AUTHORITY });
});

test('roles on first sign-in: aui.ma → student, directory → faculty with their office card, outsiders refused', async () => {
  const student = await signIn('new.student@aui.ma');
  assert.equal(student.status, 200, JSON.stringify(student.body));
  assert.equal(student.body.user.role, 'student');
  assert.equal((await call('/api/auth/me', { token: student.body.token })).body.email, 'new.student@aui.ma');

  const prof = await signIn('h.satt@aui.ma');
  assert.equal(prof.body.user.role, 'faculty');
  assert.equal(prof.body.user.person_id, 'harit-satt');
  // signed-in faculty set their own status; a student cannot set it for them
  const own = await call('/api/people/harit-satt/presence', { token: prof.body.token, method: 'PUT', body: { status: 'keep', note: 'Back at 3', note_kind: 'back_soon' } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal((await call('/api/people/harit-satt/presence', { token: student.body.token, method: 'PUT', body: { status: 'out' } })).status, 403);

  const outsider = await signIn('someone@gmail.com');
  assert.equal(outsider.status, 403);
  assert.match(outsider.body.error, /not allowed/);
  assert.equal((await call('/api/auth/microsoft', { body: { id_token: idToken({ aud: 'other' }) } })).status, 401);
});

test('dev dashboard: only developers; they assign roles to emails and the change applies at once', async () => {
  const student = await signIn('new.student@aui.ma');
  assert.equal((await call('/api/dev/users', { token: student.body.token })).status, 403);
  assert.equal((await call('/api/admin/overview', { token: student.body.token })).status, 403);

  const boss = await signIn('boss@aui.ma'); // DEV_EMAILS
  assert.equal(boss.body.user.role, 'dev');
  const list = await call('/api/dev/users', { token: boss.body.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.roles.some((r: { id: string }) => r.id === 'admin'));

  // promote the student to admin: their next request already has admin rights
  const assigned = await call('/api/dev/users', { token: boss.body.token, body: { email: 'NEW.student@aui.ma', role: 'admin' } });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  assert.equal((await call('/api/admin/overview', { token: student.body.token })).status, 200);
  assert.equal((await call('/api/dev/users', { token: student.body.token })).status, 403, 'admin is not dev');

  // an outsider let in by name, and a preview of what a new email would get
  await call('/api/dev/users', { token: boss.body.token, body: { email: 'visiting.prof@gmail.com', role: 'faculty' } });
  assert.equal((await signIn('visiting.prof@gmail.com')).body.user.role, 'faculty');
  assert.deepEqual((await call('/api/dev/check?email=h.satt@aui.ma', { token: boss.body.token })).body.role, 'faculty');

  // bulk: one per line, bad lines reported
  const bulk = await call('/api/dev/users/bulk', { token: boss.body.token, body: { text: 'a@aui.ma\nb@aui.ma, staff\nnot-an-email', role: 'student' } });
  assert.equal(bulk.body.assigned, 2);
  assert.equal(bulk.body.failed.length, 1);

  // settings: open the gate to another domain
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { allowed_domains: ['aui.ma', 'alumni.aui.ma'] } });
  assert.equal((await signIn('old.grad@alumni.aui.ma')).body.user.role, 'student');
  assert.equal((await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { default_role: 'admin' } })).status, 400, 'nobody becomes admin by default');
});

test('demo accounts can be switched off: then unsigned requests are visitors', async () => {
  const boss = await signIn('boss@aui.ma');
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { demo_accounts: false } });
  assert.deepEqual((await call('/api/accounts')).body, []);
  const r = await fetch(`${base}/api/people/harit-satt/presence`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-gomap-user': 'harit-satt' }, body: JSON.stringify({ status: 'out' }) });
  assert.equal(r.status, 403, 'the demo faculty account no longer works');
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { demo_accounts: true } });
});

test('a developer cannot remove or demote their own account (their session would break)', async () => {
  const boss = await signIn('boss@aui.ma');
  const meRow = (await call('/api/dev/users', { token: boss.body.token })).body.users.find((u: { email: string }) => u.email === 'boss@aui.ma');
  const del = await call(`/api/dev/users/${meRow.id}`, { token: boss.body.token, method: 'DELETE' });
  assert.equal(del.status, 400);
  assert.match(del.body.error, /your own account/);
  assert.equal((await call(`/api/dev/users/${meRow.id}`, { token: boss.body.token, method: 'PUT', body: { role: 'student' } })).status, 400);
  assert.equal((await call('/api/auth/me', { token: boss.body.token })).body.role, 'dev');
});
