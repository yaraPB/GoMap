/**
 * GoMap end-to-end tests: the real apps in a real browser.
 *
 *   cd e2e && npm install && npm test            (all)        npm test -- ar admin   (only some groups)
 *
 * Starts everything itself, on a throwaway database:
 *   fake Microsoft (4100) · API (4000, in-memory Mongo + temp SQLite) · admin (5173) · mobile web (8081)
 * Then drives Edge/Chrome headless through each scenario, with a fake camera, a GPS fix on the plaza
 * and simulated motion sensors. Screenshots of every step go to e2e/out/. Exit code 1 if anything fails.
 * Ports must be free (stop your own dev servers first).
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright-core';
import { startFakeMicrosoft } from './fake-microsoft.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(here, 'out');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = group => !only.length || only.includes(group);
const API = 'http://localhost:4000', ADMIN = 'http://localhost:5173', APP = 'http://localhost:8081';
const PLAZA = { latitude: 33.53925, longitude: -5.10655 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the stack ───────────────────────────────────────────────────────────────
const procs = [];
const portFree = port => new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
function start(name, cmd, args, cwd, env) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
  procs.push({ name, p, log: () => log });
  return p;
}
async function waitFor(url, label, ms = 240_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ } await sleep(1500); }
  throw new Error(`${label} did not start (${url})`);
}
function stopAll() {
  for (const { p } of procs) {
    try { if (process.platform === 'win32') execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' }); else process.kill(-p.pid); } catch { /* already gone */ }
  }
}
process.on('exit', stopAll); process.on('SIGINT', () => { stopAll(); process.exit(130); });

// ── a tiny harness ──────────────────────────────────────────────────────────
const results = [];
let shotN = 0;
async function shot(page, name) { await page.screenshot({ path: join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`) }).catch(() => {}); }
async function check(group, name, page, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ group, name, ok: true, ms: Date.now() - t0 }); console.log(`  ✔ ${name}`); }
  catch (e) { results.push({ group, name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).split('\n')[0] }); console.log(`  ✖ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); if (page) await shot(page, `FAILED-${name.replace(/\W+/g, '-').slice(0, 40)}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const api = async (path, opts = {}) => { const r = await fetch(API + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

/** Through the fake Microsoft page, like a person would. Works for a full-page redirect or a popup. */
async function microsoftLogin(page, email) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// ── main ────────────────────────────────────────────────────────────────────
console.log('Starting the stack…');
for (const port of [4000, 4100, 5173, 8081]) if (!(await portFree(port))) { console.error(`Port ${port} is busy: stop the dev server using it first.`); process.exit(2); }
await startFakeMicrosoft(4100);
const db = join(tmpdir(), `gomap-e2e-${Date.now()}.sqlite`);
const serverEnv = { MONGODB_URI: '', GOMAP_DB: db, PORT: '4000', ADMIN_TOKEN: 'e2e-admin', SESSION_SECRET: 'e2e-secret', DEV_TOKEN: '',
  MICROSOFT_CLIENT_ID: 'e2e-client', MICROSOFT_AUTHORITY: 'http://localhost:4100', MICROSOFT_TENANT: 'organizations', DEV_EMAILS: 'dev@aui.ma',
  GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', SONIOX_API_KEY: '' };
start('api', 'npx', ['tsx', 'src/server.ts'], join(root, 'server'), serverEnv);
if (want('admin') || want('dev')) start('admin', 'npx', ['vite', '--port', '5173', '--strictPort'], join(root, 'admin'), { VITE_API_URL: API });
if (want('app') || want('ar') || want('signin')) start('app', 'npx', ['expo', 'start', '--web', '--port', '8081'], join(root, 'mobile'), { EXPO_PUBLIC_API_URL: API, CI: '1', BROWSER: 'none' });
try {
  await waitFor(`${API}/api/health`, 'API');
  if (want('admin') || want('dev')) await waitFor(ADMIN, 'admin');
  if (want('app') || want('ar') || want('signin')) await waitFor(APP, 'mobile web');
} catch (e) { console.error(String(e)); for (const p of procs) console.error(`--- ${p.name}\n${p.log().slice(-2000)}`); stopAll(); process.exit(2); }

const channel = process.env.E2E_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({ channel, headless: process.env.E2E_HEADED ? false : true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const desktop = () => browser.newContext({ viewport: { width: 1440, height: 950 } });
const phone = () => browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, reducedMotion: 'reduce', geolocation: { ...PLAZA, accuracy: 5 }, permissions: ['geolocation', 'camera'] });
const appReady = async page => { await page.goto(APP, { timeout: 180_000 }); await page.getByLabel('Ask GoMap').first().waitFor({ timeout: 120_000 }); await sleep(6000); };

// ── dev dashboard & admin (Outlook sign-in) ─────────────────────────────────
if (want('dev') || want('admin')) {
  console.log('\nDev dashboard and admin');
  const ctx = await desktop(); const page = await ctx.newPage();
  await check('dev', 'a developer signs in to the dev dashboard with Outlook', page, async () => {
    await page.goto(`${ADMIN}/dev.html`);
    await page.getByRole('button', { name: 'Sign in with Outlook' }).click();
    await microsoftLogin(page, 'dev@aui.ma');
    await page.getByRole('heading', { name: 'Roles' }).waitFor({ timeout: 20_000 });
    assert(await page.getByText('dev@aui.ma').first().isVisible(), 'signed-in email not shown');
    await shot(page, 'dev-dashboard');
  });
  await check('dev', 'the email preview says what a new person would get', page, async () => {
    await page.getByLabel('Email', { exact: true }).fill('h.satt@aui.ma');
    await page.getByText('Today they would sign in as').waitFor({ timeout: 5000 });
    assert(await page.getByText('from the faculty directory').isVisible(), 'directory source not shown');
    await page.getByLabel('Email', { exact: true }).fill('someone@gmail.com');
    await page.getByText('cannot sign in').waitFor({ timeout: 5000 });
  });
  await check('dev', 'assign admin and staff roles to emails', page, async () => {
    await page.getByLabel('Email', { exact: true }).fill('new.admin@aui.ma');
    await page.getByLabel('Role', { exact: true }).selectOption('admin');
    await page.getByRole('button', { name: 'Assign' }).click();
    await page.getByText('new.admin@aui.ma is now admin.').waitFor({ timeout: 5000 });
    const r = await api('/api/dev/check?email=new.admin@aui.ma', { headers: { authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('gomap-session'))}` } });
    assert(r.body.role === 'admin', `server says ${JSON.stringify(r.body)}`);
    await shot(page, 'dev-assigned');
  });
  await check('dev', 'change a role inline from the table', page, async () => {
    await page.getByLabel('Role of new.admin@aui.ma').selectOption('staff');
    await page.getByText('new.admin@aui.ma is now staff.').waitFor({ timeout: 5000 });
    await page.getByLabel('Role of new.admin@aui.ma').selectOption('admin');
    await page.getByText('new.admin@aui.ma is now admin.').waitFor({ timeout: 5000 });
  });
  await check('dev', 'a developer cannot remove or demote their own account', page, async () => {
    page.once('dialog', d => d.accept());
    await page.getByLabel('Remove dev@aui.ma').click();
    await page.getByText('You cannot remove your own account').waitFor({ timeout: 5000 });
    await page.getByLabel('Role of dev@aui.ma').selectOption('student');
    await page.getByText('You cannot demote your own account').waitFor({ timeout: 5000 });
    assert((await page.evaluate(() => fetch('http://localhost:4000/api/auth/me', { headers: { authorization: `Bearer ${localStorage.getItem('gomap-session')}` } }).then(r => r.json()))).role === 'dev', 'still dev');
  });
  await ctx.close();

  const a = await desktop(); const ap = await a.newPage();
  await check('admin', 'the new admin signs in to the admin with Outlook', ap, async () => {
    await ap.goto(ADMIN);
    await ap.getByRole('button', { name: 'Sign in with Outlook' }).click();
    await microsoftLogin(ap, 'new.admin@aui.ma');
    await ap.getByRole('heading', { name: 'What needs you today' }).waitFor({ timeout: 20_000 });
    assert(await ap.getByText('new.admin@aui.ma · admin').isVisible(), 'role not shown in the sidebar');
    await shot(ap, 'admin-signed-in');
  });
  await check('admin', 'Places: open a category, keyboard-delete a place, then undo', ap, async () => {
    await ap.goto(`${ADMIN}/#places`); await sleep(4000);
    const before = (await api('/api/places')).body.length;
    await ap.getByRole('button', { name: /^Dining/ }).first().click();
    await ap.getByRole('dialog', { name: 'Dining places' }).waitFor();
    await ap.getByRole('option').first().click();
    await ap.keyboard.press('Delete');
    await ap.getByRole('alertdialog').waitFor();
    await ap.keyboard.press('Enter');
    await ap.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 10_000 });
    assert((await api('/api/places')).body.length === before - 1, 'place not deleted on the server');
    await shot(ap, 'admin-deleted');
    await ap.getByRole('button', { name: 'Undo' }).click();
    await ap.getByText(/Restored/).waitFor({ timeout: 10_000 });
    assert((await api('/api/places')).body.length === before, 'undo did not restore the place');
  });
  await check('admin', 'Places: satellite view and building outlines', ap, async () => {
    await ap.getByRole('radio', { name: 'Satellite' }).first().click();
    await ap.getByRole('button', { name: /Outlines/ }).click();
    await ap.getByText(/unnamed/).waitFor({ timeout: 15_000 });
    await sleep(3000); await shot(ap, 'admin-satellite-outlines');
  });
  await check('admin', 'Events: create one, it appears on the calendar and in the app feed', ap, async () => {
    await ap.goto(`${ADMIN}/#events`); await sleep(2000);
    await ap.getByRole('button', { name: 'New event' }).click();
    await ap.getByPlaceholder('e.g. Career fair').fill('E2E robotics demo');
    await ap.locator('select').filter({ hasText: '— no place —' }).selectOption('building-7');
    await ap.getByRole('button', { name: 'Save' }).click();
    await ap.getByText('Saved. It is on the map').waitFor({ timeout: 10_000 });
    assert((await api('/api/events')).body.some(e => e.title === 'E2E robotics demo'), 'event not in the public feed');
    await shot(ap, 'admin-event');
  });
  await check('admin', 'Assistant: write a rule; the assistant answers with it', ap, async () => {
    await ap.goto(`${ADMIN}/#assistant/rules`); await sleep(1500);
    await ap.getByRole('button', { name: 'New rule' }).click();
    await ap.getByPlaceholder('e.g. Printing on campus').fill('Printing');
    const tags = ap.getByPlaceholder(/print, printer/);
    await tags.fill('print'); await tags.press('Enter');
    await ap.getByPlaceholder(/Exactly what the assistant should say/).fill('Print at the library desk with your student card.');
    await ap.getByRole('button', { name: 'Save' }).first().click();
    await ap.getByText('What a student now gets').waitFor({ timeout: 10_000 });
    const r = await api('/api/assistant/ask', { method: 'POST', body: JSON.stringify({ text: 'where can I print', lang: 'en' }) });
    assert(/library desk/.test(r.body.text), `assistant said: ${r.body.text}`);
    await shot(ap, 'admin-rule');
  });
  await check('admin', 'Assistant: the starter test suite passes', ap, async () => {
    await ap.getByRole('tab', { name: 'Tests' }).click();
    await ap.getByRole('button', { name: /Run all \(free\)/ }).click();
    await ap.getByText(/\d+ \/ \d+ passing/).waitFor({ timeout: 30_000 });
    const label = await ap.getByText(/\d+ \/ \d+ passing/).textContent();
    const [p, t] = label.match(/(\d+) \/ (\d+)/).slice(1).map(Number);
    assert(p === t, `only ${label}`);
    await shot(ap, 'admin-tests');
  });
  await a.close();

  const s = await desktop(); const sp = await s.newPage();
  await check('admin', 'a student account is refused by the admin, with a clear message', sp, async () => {
    await sp.goto(ADMIN);
    await sp.getByRole('button', { name: 'Sign in with Outlook' }).click();
    await microsoftLogin(sp, 'plain.student@aui.ma');
    await sp.getByText(/This dashboard is for admin or dev accounts/).waitFor({ timeout: 20_000 });
  });
  await check('admin', 'an outsider is refused at sign-in', sp, async () => {
    await sp.evaluate(() => localStorage.clear()); await sp.goto(`${ADMIN}/dev.html`);
    await sp.getByRole('button', { name: 'Sign in with Outlook' }).click();
    await microsoftLogin(sp, 'stranger@gmail.com');
    await sp.getByText(/not allowed to sign in/).waitFor({ timeout: 20_000 });
  });
  await s.close();
}

// ── the app ─────────────────────────────────────────────────────────────────
/** Keeps feeding the phone's orientation (W3C degrees) like real sensors at ~30 Hz. */
const feed = (page, alpha, beta, ms) => page.evaluate(async ({ alpha, beta, ms }) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const type of ['deviceorientationabsolute', 'deviceorientation']) { const e = new Event(type); Object.assign(e, { alpha, beta, gamma: 0, absolute: true }); window.dispatchEvent(e); }
    await new Promise(r => setTimeout(r, 33));
  }
}, { alpha, beta, ms });
const arrowAngle = async page => {
  const label = await page.locator('[aria-label^="Way to go"]').first().getAttribute('aria-label');
  if (/straight/.test(label)) return 0;
  const n = Number(label.match(/(\d+)°/)[1]);
  return /right/.test(label) ? n : -n;
};

if (want('signin') || want('app')) {
  console.log('\nApp: sign-in and roles');
  const ctx = await phone(); const page = await ctx.newPage();
  await check('signin', 'the app loads on campus with the GoCampus map', page, async () => { await appReady(page); await shot(page, 'app-home'); });
  await check('signin', 'a professor signs in with Outlook and gets the faculty view', page, async () => {
    await page.getByLabel(/^View: /).click();
    const popup = ctx.waitForEvent('page');
    await page.getByLabel('Sign in with Outlook').click();
    const p = await popup;
    await microsoftLogin(p, 'h.satt@aui.ma');
    // the sheet closes itself once signed in; reopen it to see who we are
    await page.getByLabel('Sign in with Outlook').waitFor({ state: 'detached', timeout: 20_000 });
    await sleep(1500);
    await page.getByLabel(/^View: /).click();
    await page.getByText('h.satt@aui.ma').waitFor({ timeout: 10_000 });
    assert(await page.getByText(/Faculty ·/).first().isVisible(), 'not shown as faculty');
    await shot(page, 'app-signed-in');
  });
  await check('signin', 'the professor publishes "on leave this semester" from their office screen', page, async () => {
    await page.goto(`${APP}/faculty-status`); await sleep(4000);
    await page.getByLabel('On leave this semester').click();
    await page.getByText('Your status is set to Away for the same time').waitFor();
    await page.getByText('Publish my status').click();
    await page.getByText(/Published/).waitFor({ timeout: 10_000 });
    const me = (await api('/api/people/harit-satt')).body;
    assert(me.note_kind === 'semester_off' && me.presence?.status === 'out', `server: note ${me.note_kind}, presence ${me.presence?.status}`);
    await shot(page, 'app-faculty-status');
  });
  await check('signin', 'signing out returns to the demo student', page, async () => {
    await page.goto(APP); await page.getByLabel('Ask GoMap').first().waitFor({ timeout: 60_000 }); await sleep(3000);
    await page.getByLabel(/^View: /).click();
    await page.getByText('Sign out').click();
    await page.getByLabel('Sign in with Outlook').waitFor();
  });
  await ctx.close();
}

if (want('app')) {
  console.log('\nApp: map, search, routes, events, assistant, languages');
  const ctx = await phone(); const page = await ctx.newPage();
  await appReady(page);
  await check('app', 'search the library and walk there (route, start, turn-by-turn)', page, async () => {
    await page.getByLabel('Search the campus').click();
    await page.getByPlaceholder('A place, a professor, an office').fill('library');
    await page.getByText('Mohammed VI Library').first().click();
    await page.getByText('Directions').click();
    await page.getByText('Start').waitFor({ timeout: 15_000 });
    await shot(page, 'app-route-preview');
    await page.getByText('Start').click();
    await page.getByText('End').waitFor({ timeout: 10_000 });
    await shot(page, 'app-turn-by-turn');
    await page.getByText('End').click();
  });
  await check('app', 'Building 14 has a route (the old "no path" bug)', page, async () => {
    await page.getByLabel('Ask GoMap').first().click();
    const box = page.getByPlaceholder('Type a question');
    await box.fill('take me to building 14'); await box.press('Enter');
    await page.getByText('Start').waitFor({ timeout: 20_000 });
    await shot(page, 'app-building-14');
    await page.goBack().catch(() => {}); await page.goto(APP); await page.getByLabel('Ask GoMap').first().waitFor({ timeout: 60_000 }); await sleep(3000);
  });
  await check('app', 'scenes switch, satellite turns 3D off, no high contrast option', page, async () => {
    await page.getByLabel('Map style and layers').click();
    for (const scene of ['Day', 'Evening', 'Dark', 'GoCampus']) { await page.getByRole('radio', { name: scene }).click(); await sleep(1500); await shot(page, `app-scene-${scene}`); }
    assert(!(await page.getByText('High contrast').count()), 'high contrast is still offered');
    await page.getByRole('radio', { name: 'Satellite' }).click();
    await page.getByText('Off on satellite').waitFor();
    await sleep(2500); await shot(page, 'app-satellite');
    await page.getByRole('radio', { name: 'Map' }).click();
  });
  await check('app', 'French then Arabic: the interface changes language', page, async () => {
    await page.getByRole('radio', { name: 'Français' }).click();
    await page.getByText('Ambiance').waitFor();
    await page.getByRole('radio', { name: 'العربية' }).click();
    await page.getByText('المشهد').waitFor();
    await shot(page, 'app-arabic');
    await page.getByRole('radio', { name: 'English' }).click();
    await page.getByLabel('Close').first().click();
  });
  await check('app', 'events: the chip opens what\'s on, with directions to an event', page, async () => {
    await page.getByText('Events', { exact: true }).first().click();
    await page.getByText("What's on at AUI").waitFor();
    // any upcoming event: rows are labelled "title, when"
    await page.getByRole('button', { name: /, (Today|On now|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/ }).first().click();
    await page.getByText('Take me there').waitFor();
    await shot(page, 'app-event');
    await page.getByLabel('Close').first().click();
  });
  await check('app', 'the assistant answers: events, the mosque (local), printing (an admin rule)', page, async () => {
    const rules = (await api('/api/admin/rules', { headers: { authorization: 'Bearer e2e-admin' } })).body;
    if (!rules.some(r => r.triggers?.includes('print'))) {
      await api('/api/admin/rules', { method: 'POST', headers: { authorization: 'Bearer e2e-admin' }, body: JSON.stringify({ title: 'Printing', triggers: ['print'], answer: 'Print at the library desk with your student card.' }) });
    }
    await page.getByLabel('Ask GoMap').first().click();
    const box = page.getByPlaceholder('Type a question');
    await box.fill('what is happening this week'); await box.press('Enter');
    await page.getByText('All events').waitFor({ timeout: 15_000 });
    // a place question opens the walk straight away (the chat steps aside)
    await box.fill('where can I pray'); await box.press('Enter');
    await page.getByText(/Masjid Al Akhawayn is \d+ m away/).first().waitFor({ timeout: 15_000 });
    await page.getByText('Start').waitFor();
    await shot(page, 'app-assistant-mosque');
    await page.goto(APP); await page.getByLabel('Ask GoMap').first().waitFor({ timeout: 60_000 }); await sleep(3000);
    await page.getByLabel('Ask GoMap').first().click();
    await box.fill('where can I print'); await box.press('Enter');
    await page.getByText(/library desk/).waitFor({ timeout: 15_000 });
    await shot(page, 'app-assistant');
  });
  await ctx.close();
}

if (want('ar')) {
  console.log('\nApp: AR guidance and calibration');
  const ctx = await phone(); const page = await ctx.newPage();
  await appReady(page);
  const route = (await api('/api/route', { method: 'POST', body: JSON.stringify({ from: { lat: PLAZA.latitude, lng: PLAZA.longitude }, to_place_id: 'building-14', mode: 'walk' }) })).body;
  await check('ar', 'AR opens from the assistant with the instruction in words', page, async () => {
    assert(route.geometry, 'no route to building 14');
    await page.getByLabel('Ask GoMap').first().click();
    const box = page.getByPlaceholder('Type a question');
    await box.fill('take me to building 14 in AR'); await box.press('Enter');
    await page.waitForURL(/\/ar$/, { timeout: 20_000 });
    await feed(page, 0, 70, 3000);
    await page.getByText(/^in \d+ m$/).first().waitFor({ timeout: 10_000 });
  });
  // face 40° away from the path (W3C alpha = 360 − heading)
  const c = route.geometry?.coordinates ?? [];
  let i = 1; while (i < c.length - 1 && Math.hypot((c[i][0] - c[0][0]) * 92700, (c[i][1] - c[0][1]) * 111000) < 8) i++;
  const brg = c.length ? (Math.atan2((c[i][0] - c[0][0]) * Math.cos(c[0][1] * Math.PI / 180), c[i][1] - c[0][1]) * 180 / Math.PI + 360) % 360 : 0;
  await check('ar', 'the floor arrow follows the phone as it turns', page, async () => {
    await feed(page, (360 - brg) % 360, 70, 2500);
    const a1 = await arrowAngle(page);
    await feed(page, (360 - brg - 60 + 720) % 360, 70, 2500); // turn 60° right
    const a2 = await arrowAngle(page);
    const turned = ((a1 - a2 + 540) % 360) - 180;
    assert(Math.abs(turned - 60) < 15, `turning 60° right moved the arrow ${turned}° (from ${a1}° to ${a2}°)`);
    await shot(page, 'ar-turned');
  });
  await check('ar', 'calibration: "Align with the path" straightens the arrows', page, async () => {
    // the compass is off by 50°: the phone points along the path but thinks it points elsewhere
    const along = (360 - brg + 720) % 360;
    const offBy50 = (along + 50) % 360;
    await feed(page, offBy50, 70, 2500);
    const before = Math.abs(await arrowAngle(page));
    // the user points the phone along the path (real direction), but the sensors report offBy50
    await page.getByLabel('Accuracy and calibration').click();
    await page.getByText('Line up the arrows').waitFor();
    await shot(page, 'ar-calibration');
    const keep = feed(page, offBy50, 70, 4000);
    await page.getByText('Align with the path', { exact: true }).last().click();
    await keep;
    const after = Math.abs(await arrowAngle(page));
    assert(before > 25, `before calibrating the arrow should be off (was ${before}°)`);
    assert(after < 12, `after "Align with the path" the arrow should point ahead (is ${after}°)`);
    await page.getByText('Aligned with the path').first().waitFor();
    await shot(page, 'ar-aligned');
  });
  // after alignment, the reading that was 50° off now means "along the path"
  const alongNow = (360 - brg + 50 + 720) % 360;
  await check('ar', '"Turn around" appears after facing away, and goes when you turn back', page, async () => {
    await feed(page, (alongNow + 180) % 360, 70, 2600);
    await page.getByText('Turn around').waitFor({ timeout: 3000 });
    await shot(page, 'ar-turn-around');
    await feed(page, alongNow, 70, 1500);
    assert(!(await page.getByText('Turn around').count()), '"Turn around" stayed after turning back');
  });
  await check('ar', 'the tilt coach: phone flat → "Raise your phone a little"', page, async () => {
    await feed(page, alongNow, 5, 2000);
    await page.getByText('Raise your phone a little').waitFor({ timeout: 3000 });
    await feed(page, alongNow, 70, 2500);
    await shot(page, 'ar-tilt-fixed');
  });
  await check('ar', 'the map toggle opens the mini map; Stop returns to the 2D map', page, async () => {
    await page.getByLabel('Show the map').click();
    await page.getByLabel('Hide the map').waitFor();
    await shot(page, 'ar-mini-map');
    await page.getByLabel('Stop AR guidance').click();
    await page.waitForURL(u => !/\/ar$/.test(String(u)), { timeout: 10_000 });
  });
  await ctx.close();
}

await browser.close();
stopAll();
try { if (existsSync(db)) rmSync(db); } catch { /* still locked on Windows */ }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in e2e/out/`);
for (const f of failed) console.log(`  ✖ [${f.group}] ${f.name}\n      ${f.error}`);
process.exit(failed.length ? 1 : 0);
