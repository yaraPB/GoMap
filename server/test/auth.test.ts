/**
 * Accounts end to end: email + password sign-up and sign-in, the seeded test accounts, roles,
 * the dev dashboard, and the sessions the apps carry.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { boot } from '../src/boot.js';
import { createApp } from '../src/app.js';
import { checkPassword, hashPassword, LoginThrottle, signSession, verifySession } from '../src/auth/tokens.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('passwords are salted scrypt hashes, never the password itself', () => {
  const a = hashPassword('123abc');
  const b = hashPassword('123abc');
  assert.notEqual(a, b, 'a fresh salt each time');
  assert.ok(!a.includes('123abc'));
  assert.ok(checkPassword('123abc', a));
  assert.ok(!checkPassword('123abd', a));
  assert.ok(!checkPassword('123abc', null));
  assert.ok(!checkPassword('123abc', 'garbage'));
});

test('GoMap sessions: valid, tampered, expired', () => {
  const s = signSession({ sub: 'u1', email: 'x@aui.ma' }, 'secret');
  assert.equal(verifySession(s, 'secret').sub, 'u1');
  assert.throws(() => verifySession(s, 'other-secret'), /signature/);
  assert.throws(() => verifySession(signSession({ sub: 'u1', email: 'x' }, 'secret', -10), 'secret'), /expired/);
  const [h, , sig] = s.split('.');
  assert.throws(() => verifySession(`${h}.${b64({ sub: 'admin', email: 'x', iss: 'gomap', exp: 9e9 })}.${sig}`, 'secret'), /signature/);
});

test('the login throttle: 8 wrong passwords, then a minute of waiting', () => {
  const t = new LoginThrottle();
  for (let i = 0; i < 8; i++) { t.check('x', 1000); t.failed('x', 1000); }
  assert.throws(() => t.check('x', 2000), /Too many/);
  assert.doesNotThrow(() => t.check('x', 62_000));
});

let server: Server;
let base = '';
let ctx: Awaited<ReturnType<typeof boot>>;
const env = { SESSION_SECRET: 'test-secret', DEV_EMAILS: 'boss@aui.ma', DEV_TOKEN: '' };
const saved: Record<string, string | undefined> = {};
before(async () => {
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  ctx = await boot({ mongoUri: '', sqliteFile: ':memory:', geminiKey: '', provider: 'gemini', quiet: true });
  server = createApp(ctx).listen(0, '127.0.0.1');
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
const login = (email: string, password = '123abc') => call('/api/auth/login', { body: { email, password } });
/** Signs in, creating the account the first time. */
const account = async (email: string, password = 'pass123') => {
  const r = await login(email, password);
  return r.status === 200 ? r : call('/api/auth/signup', { body: { email, password } });
};

test('the sign-in screens learn the domains and the test accounts', async () => {
  const { body } = await call('/api/auth/config');
  assert.deepEqual(body.allowed_domains, ['aui.ma']);
  assert.equal(body.test_password, '123abc');
  assert.deepEqual(body.test_accounts.map((a: { email: string }) => a.email), ['s.student@aui.ma', 'f.faculty@aui.ma', 'st.staff@aui.ma', 'a.admin@aui.ma', 'd.dev@aui.ma']);
});

test('every test account signs in with 123abc and gets its role', async () => {
  const want: Record<string, string> = { 's.student@aui.ma': 'student', 'f.faculty@aui.ma': 'faculty', 'st.staff@aui.ma': 'staff', 'a.admin@aui.ma': 'admin', 'd.dev@aui.ma': 'dev' };
  for (const [email, role] of Object.entries(want)) {
    const r = await login(email);
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.user.role, role);
    assert.equal((await call('/api/auth/me', { token: r.body.token })).body.email, email);
  }
  assert.equal((await login('F.Faculty@AUI.ma')).body.user.person_id, 'harit-satt', 'email case does not matter; faculty is linked to an office card');
  const wrong = await login('s.student@aui.ma', 'nope');
  assert.equal(wrong.status, 401);
  assert.match(wrong.body.error, /Wrong password/);
  assert.match((await login('nobody@aui.ma')).body.error, /No GoMap account/);
});

test('sign-up: aui.ma → student, directory → faculty with their office card, outsiders refused, no duplicates', async () => {
  const student = await call('/api/auth/signup', { body: { email: 'New.Student@aui.ma', password: 'pass123', name: 'New Student' } });
  assert.equal(student.status, 201, JSON.stringify(student.body));
  assert.equal(student.body.user.role, 'student');
  assert.equal(student.body.user.name, 'New Student');
  assert.equal((await call('/api/auth/signup', { body: { email: 'new.student@aui.ma', password: 'other1' } })).status, 409);
  assert.equal((await login('new.student@aui.ma', 'pass123')).status, 200);
  assert.equal((await call('/api/auth/signup', { body: { email: 'short@aui.ma', password: '123' } })).status, 400);

  const prof = await account('h.satt@aui.ma');
  assert.equal(prof.body.user.role, 'faculty');
  assert.equal(prof.body.user.person_id, 'harit-satt');
  // signed-in faculty set their own status; a student cannot set it for them
  const own = await call('/api/people/harit-satt/presence', { token: prof.body.token, method: 'PUT', body: { status: 'keep', note: 'Back at 3', note_kind: 'back_soon' } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal((await call('/api/people/harit-satt/presence', { token: student.body.token, method: 'PUT', body: { status: 'out' } })).status, 403);

  const outsider = await call('/api/auth/signup', { body: { email: 'someone@gmail.com', password: 'pass123' } });
  assert.equal(outsider.status, 403);
  assert.match(outsider.body.error, /cannot have a GoMap account/);
});

test('change your own password', async () => {
  const me = await account('changer@aui.ma', 'first1');
  assert.equal((await call('/api/auth/password', { token: me.body.token, body: { current: 'wrong', password: 'second2' } })).status, 401);
  assert.equal((await call('/api/auth/password', { token: me.body.token, body: { current: 'first1', password: 'second2' } })).status, 200);
  assert.equal((await login('changer@aui.ma', 'first1')).status, 401);
  assert.equal((await login('changer@aui.ma', 'second2')).status, 200);
});

test('dev dashboard: only developers; they assign roles to emails and the change applies at once', async () => {
  const student = await account('new.student@aui.ma');
  assert.equal((await call('/api/dev/users', { token: student.body.token })).status, 403);
  assert.equal((await call('/api/admin/overview', { token: student.body.token })).status, 403);

  const boss = await account('boss@aui.ma'); // DEV_EMAILS
  assert.equal(boss.body.user.role, 'dev');
  const list = await call('/api/dev/users', { token: boss.body.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.roles.some((r: { id: string }) => r.id === 'admin'));
  assert.ok(list.body.users.every((u: Record<string, unknown>) => !('password_hash' in u)), 'hashes never leave the server');
  assert.ok(list.body.users.find((u: { email: string }) => u.email === 'd.dev@aui.ma').test);

  // promote the student to admin: their next request already has admin rights
  const assigned = await call('/api/dev/users', { token: boss.body.token, body: { email: 'NEW.student@aui.ma', role: 'admin' } });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  assert.equal((await call('/api/admin/overview', { token: student.body.token })).status, 200);
  assert.equal((await call('/api/dev/users', { token: student.body.token })).status, 403, 'admin is not dev');

  // an outsider let in by name claims the role when they create the account
  await call('/api/dev/users', { token: boss.body.token, body: { email: 'visiting.prof@gmail.com', role: 'faculty' } });
  assert.match((await login('visiting.prof@gmail.com', 'pass123')).body.error, /no password yet/);
  assert.equal((await call('/api/auth/signup', { body: { email: 'visiting.prof@gmail.com', password: 'pass123' } })).body.user.role, 'faculty');
  assert.deepEqual((await call('/api/dev/check?email=h.satt@aui.ma', { token: boss.body.token })).body.role, 'faculty');

  // a developer sets someone's password
  const row = (await call('/api/dev/users', { token: boss.body.token })).body.users.find((u: { email: string }) => u.email === 'visiting.prof@gmail.com');
  const reset = await call(`/api/dev/users/${row.id}/password`, { token: boss.body.token, method: 'PUT', body: { password: 'reset99' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.has_password, true);
  assert.equal((await login('visiting.prof@gmail.com', 'reset99')).status, 200);

  // bulk: one per line, bad lines reported
  const bulk = await call('/api/dev/users/bulk', { token: boss.body.token, body: { text: 'a@aui.ma\nb@aui.ma, staff\nnot-an-email', role: 'student' } });
  assert.equal(bulk.body.assigned, 2);
  assert.equal(bulk.body.failed.length, 1);

  // settings: open the gate to another domain
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { allowed_domains: ['aui.ma', 'alumni.aui.ma'] } });
  assert.equal((await account('old.grad@alumni.aui.ma')).body.user.role, 'student');
  assert.equal((await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { default_role: 'admin' } })).status, 400, 'nobody becomes admin by default');
});

test('test accounts can be switched off: they no longer sign in, and unsigned requests are visitors', async () => {
  const boss = await account('boss@aui.ma');
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { demo_accounts: false } });
  assert.deepEqual((await call('/api/auth/config')).body.test_accounts, []);
  assert.equal((await login('a.admin@aui.ma')).status, 403);
  assert.deepEqual((await call('/api/accounts')).body, []);
  const r = await fetch(`${base}/api/people/harit-satt/presence`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-gomap-user': 'harit-satt' }, body: JSON.stringify({ status: 'out' }) });
  assert.equal(r.status, 403, 'the demo faculty account no longer works');
  await call('/api/dev/settings', { token: boss.body.token, method: 'PUT', body: { demo_accounts: true } });
  assert.equal((await login('a.admin@aui.ma')).status, 200);
});

test('a developer cannot remove or demote their own account (their session would break)', async () => {
  const boss = await account('boss@aui.ma');
  const meRow = (await call('/api/dev/users', { token: boss.body.token })).body.users.find((u: { email: string }) => u.email === 'boss@aui.ma');
  const del = await call(`/api/dev/users/${meRow.id}`, { token: boss.body.token, method: 'DELETE' });
  assert.equal(del.status, 400);
  assert.match(del.body.error, /your own account/);
  assert.equal((await call(`/api/dev/users/${meRow.id}`, { token: boss.body.token, method: 'PUT', body: { role: 'student' } })).status, 400);
  assert.equal((await call('/api/auth/me', { token: boss.body.token })).body.role, 'dev');
});
