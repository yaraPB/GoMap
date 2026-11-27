import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Position } from 'geojson';
import { Assistant } from './assistant/assistant.js';
import { sonioxTemporaryKey } from './assistant/soniox.js';
import type { Lang } from './assistant/router.js';
import { config, SERVER_DIR } from './config.js';
import { CATEGORIES, Entrance, Place, Report, SCHOOLS } from './db/mongo.js';
import { json, type Sql } from './db/sqlite.js';
import { formatHours, openState, parseHours, type Hours } from './lib/hours.js';
import type { RouteMode } from './routing/route.js';
import type { Campus } from './services/campus.js';
import { DEPARTMENTS, Directory, isStale, NOTE_KINDS, noteExpiry, REASONS, type PersonRow } from './services/directory.js';
import { Offices, SERVICE_CATEGORIES, weeklyMinutes, type IssueRow, type ServiceRow } from './services/offices.js';
import { meta } from './db/sqlite.js';
import * as turf from '@turf/turf';
import { loadGeo } from './seed/seed.js';
import { AUDIENCES, EVENT_KINDS, Events, type PlaceRef } from './services/events.js';
import { newId, ruleView, runTest, testView, type RuleRow, type TestRow } from './services/assistantAdmin.js';
import { AuthError, checkPassword, LoginThrottle, signSession, verifySession } from './auth/tokens.js';
import { MIN_PASSWORD, migrateUsers, publicUser, ROLE_INFO, ROLES, safeUser, SignInError, TEST_ACCOUNTS, TEST_PASSWORD, Users, type Role, type UserRow } from './auth/users.js';
import type { CampusHours } from './seed/services.js';

export type AppContext = { db: Sql; campus: Campus; assistant: Assistant; uploadsDir?: string; fetchImpl?: typeof fetch };

/** Fallback when the accounts table is empty. Real list: SQLite `accounts`. TODO: replace with GoCampus SSO */
export const MOCK_USERS = [
  { id: 'demo-student', name: 'Student', role: 'student' },
  { id: 'harit-satt', name: 'Harit Satt', role: 'faculty' },
  { id: 'demo-staff', name: 'Staff', role: 'staff' },
  { id: 'guest', name: 'Visitor', role: 'guest' },
] as const;
type Account = { id: string; name: string; role: string; person_id?: string | null; description?: string | null; email?: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const bad = (msg: string) => new HttpError(400, msg);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) ? n : undefined; };
const LANGS = ['en', 'fr', 'ar'];
const now = () => new Date().toISOString();

function coord(v: unknown): Position | null {
  if (!v || typeof v !== 'object') return null;
  const { lat, lng } = v as { lat?: unknown; lng?: unknown };
  const la = num(lat), ln = num(lng);
  return la !== undefined && ln !== undefined && Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? [ln, la] : null;
}

function hoursInput(v: unknown): Hours | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') throw bad('hours must be an object like {"mon":[["09:00","11:00"]]}');
  const out: Hours = {};
  for (const [day, ranges] of Object.entries(v)) {
    if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(day)) throw bad(`unknown day ${day}`);
    if (!Array.isArray(ranges) || ranges.some(r => !Array.isArray(r) || r.length !== 2 || r.some(t => typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) || r[0] >= r[1])) throw bad(`bad ranges for ${day}`);
    out[day as keyof Hours] = ranges as [string, string][];
  }
  return out;
}

const strList = (v: unknown, max = 120) => {
  if (!Array.isArray(v)) throw new HttpError(400, 'expected a list of strings');
  return v.map(x => str(x, max)).filter((x): x is string => !!x);
};

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(ctx: AppContext) {
  const { db, campus, assistant } = ctx;
  const directory = new Directory(db);
  const offices = new Offices(db);
  const events = new Events(db);
  migrateUsers(db);
  const users = new Users(db, () => config.devEmails);
  users.seedTestAccounts();
  // Bumped on every edit; the app polls /api/version and refetches when it moves.
  let version = Date.now();
  const bump = () => { version = Math.max(Date.now(), version + 1); };
  const uploadsDir = ctx.uploadsDir ?? join(SERVER_DIR, 'data', 'uploads');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-GoMap-User' });
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/uploads', express.static(uploadsDir, { maxAge: '1h' }));

  const accounts = (): Account[] => {
    const rows = db.prepare('SELECT id, name, role, person_id, description FROM accounts ORDER BY sort, name').all() as Account[];
    return rows.length ? rows : [...MOCK_USERS];
  };
  /** The signed-in person (email + password), from the session token. Their role comes from the database on every request. */
  const sessionUser = (req: Request): UserRow | null => {
    const h = req.header('authorization');
    if (!h?.startsWith('Bearer ') || h === `Bearer ${config.adminToken}` || (config.devToken && h === `Bearer ${config.devToken}`)) return null;
    try { return users.byId(verifySession(h.slice(7), config.sessionSecret).sub) ?? null; } catch { return null; }
  };
  /** Who is asking: the signed-in user, else a demo account (while demo accounts are on), else a visitor. */
  const userOf = (req: Request): Account => {
    const u = sessionUser(req);
    if (u) return { id: u.person_id ?? u.id, name: u.name ?? u.email, role: u.role, person_id: u.person_id, email: u.email };
    const list = accounts();
    if (!users.settings().demo_accounts) return list.find(a => a.role === 'guest') ?? { id: 'guest', name: 'Visitor', role: 'guest' };
    return list.find(a => a.id === req.header('x-gomap-user')) ?? list[0];
  };
  const changeLog = (entity: string, id: string, action: string, detail: unknown, actor: string) => {
    db.prepare('INSERT INTO change_log (id, entity, entity_id, action, detail, actor, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), entity, id, action, detail == null ? null : JSON.stringify(detail), actor, now());
    bump();
  };
  const placeNames = async () => new Map((await Place.find({}, { name: 1 }).lean()).map(p => [String(p._id), p.name]));
  const placeRefs = async () => new Map<string, PlaceRef>((await Place.find({}, { name: 1, location: 1, category: 1 }).lean()).map(p => [String(p._id), { id: String(p._id), name: p.name, coordinates: p.location!.coordinates as Position, category: p.category }]));
  // building footprints the basemap does not draw: traced from satellite imagery by the team
  let tracedCache: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] | null = null;
  const tracedBuildings = () => (tracedCache ??= loadGeo().buildings.filter(b => b.properties.source === 'trace' || b.properties.source === 'survey')
    .map((b, i) => ({ type: 'Feature' as const, geometry: b.geometry as unknown, properties: { id: `${b.properties.source}-${i}`, height: b.properties.height ?? 8, source: b.properties.source } as Record<string, unknown> })));

  // ── public ────────────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/mock-users', (_req, res) => { res.json(accounts()); });
  app.get('/api/accounts', (_req, res) => { res.json(users.settings().demo_accounts ? accounts() : []); });
  app.get('/api/version', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ version }); });

  // ── accounts: email + password ────────────────────────────────────────────

  const throttle = new LoginThrottle();
  const session = (u: UserRow) => ({ token: signSession({ sub: u.id, email: u.email }, config.sessionSecret), user: publicUser(u) });
  const signInFail = (e: unknown) => (e instanceof SignInError ? new HttpError(e.status, e.message) : e instanceof AuthError ? new HttpError(429, e.message) : e);

  /** What the sign-in screens show: the allowed domains, and the test accounts while they are on (all public). */
  app.get('/api/auth/config', (_req, res) => {
    const s = users.settings();
    res.json({
      allowed_domains: s.allowed_domains, min_password: MIN_PASSWORD, demo_accounts: s.demo_accounts,
      test_accounts: s.demo_accounts ? TEST_ACCOUNTS.map(a => ({ email: a.email, name: a.name, role: a.role })) : [],
      test_password: s.demo_accounts ? TEST_PASSWORD : null,
    });
  });

  app.post('/api/auth/signup', (req, res) => {
    const email = str(req.body?.email, 200) ?? '';
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    let u: UserRow;
    try { u = users.signUp({ email, password, name: str(req.body?.name, 120) ?? null }); } catch (e) { throw signInFail(e); }
    changeLog('user', u.id, 'sign-up', { email: u.email, role: u.role, source: u.source }, u.email);
    res.status(201).json(session(u));
  });

  app.post('/api/auth/login', (req, res) => {
    const email = (str(req.body?.email, 200) ?? '').toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!email || !password) throw bad('Enter your email and password.');
    let u: UserRow;
    try {
      throttle.check(email);
      try { u = users.logIn(email, password); } catch (e) { if (e instanceof SignInError && e.status === 401) throttle.failed(email); throw e; }
    } catch (e) { throw signInFail(e); }
    throttle.ok(email);
    changeLog('user', u.id, 'sign-in', { email: u.email, role: u.role }, u.email);
    res.json(session(u));
  });

  /** Change your own password (needs the current one). */
  app.post('/api/auth/password', (req, res) => {
    const u = sessionUser(req);
    if (!u) throw new HttpError(401, 'Not signed in');
    const current = typeof req.body?.current === 'string' ? req.body.current : '';
    const next = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (u.password_hash && !checkPassword(current, u.password_hash)) throw new HttpError(401, 'Your current password is not right.');
    try { users.setPassword(u.id, next); } catch (e) { throw signInFail(e); }
    changeLog('user', u.id, 'password', { email: u.email }, u.email);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const u = sessionUser(req);
    if (!u) throw new HttpError(401, 'Not signed in');
    res.json(publicUser(u));
  });

  app.get('/api/campus', (_req, res) => {
    const c = offices.campus();
    res.json({ ...c, timezone: config.timezone, office_hours_text: `Mon–Fri ${c.open}–${c.close} · lunch ${c.lunch[0]}–${c.lunch[1]}` });
  });

  app.get('/api/services', wrap(async (req, res) => {
    const names = await placeNames();
    const q = str(req.query.q)?.toLowerCase();
    const category = str(req.query.category);
    const views = offices.list().map(r => offices.view(r, names))
      .filter(v => (!category || category === 'all' || v.category === category)
        && (!q || `${v.name} ${v.short_name} ${v.handles.join(' ')} ${v.keywords.join(' ')}`.toLowerCase().includes(q)));
    res.json(views);
  }));
  app.get('/api/services/:id', wrap(async (req, res) => {
    const r = offices.row(String(req.params.id));
    if (!r) throw new HttpError(404, 'Service not found');
    const names = await placeNames();
    res.json({ ...offices.view(r, names), issues: offices.issues().filter(i => i.service_id === r.id).map(i => offices.issueView(i, names)) });
  }));
  app.get('/api/issues', wrap(async (_req, res) => {
    const names = await placeNames();
    res.json(offices.issues().map(i => offices.issueView(i, names)));
  }));

  const placeLite = (p: Record<string, unknown> & { _id: unknown; location: { coordinates: Position } | null }, counts: Map<string, number>) => {
    const hours = p.hours as Hours | null;
    return {
      id: String(p._id), name: p.name, number: p.number, category: p.category, schools: p.schools, aliases: p.aliases,
      coordinates: p.location!.coordinates, status: p.status, closed_reason: p.closed_reason, closed_until: p.closed_until,
      open: openState(hours, config.timezone).state, people_count: counts.get(String(p._id)) ?? 0,
      position_estimated: p.position_estimated, verified: !!p.verified_at && !isStale(p.verified_at as string, (p.review_months as number) ?? 6),
    };
  };
  const peopleCounts = () => new Map((db.prepare('SELECT place_id, COUNT(*) AS n FROM people WHERE place_id IS NOT NULL GROUP BY place_id').all() as { place_id: string; n: number }[]).map(r => [r.place_id, r.n]));

  app.get('/api/places', wrap(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const category = str(req.query.category), school = str(req.query.school), q = str(req.query.q);
    if (category && category !== 'all') filter.category = category;
    if (school && school !== 'all') filter.schools = school;
    let places = await Place.find(filter).sort({ name: 1 }).lean();
    if (q) {
      const t = q.toLowerCase();
      places = places.filter(p => `${p.name} ${p.number ?? ''} ${(p.aliases ?? []).join(' ')} ${p.description ?? ''}`.toLowerCase().includes(t));
    }
    const counts = peopleCounts();
    res.json(places.map(p => placeLite(p as never, counts)));
  }));

  app.get('/api/places/:id', wrap(async (req, res) => {
    const p = await Place.findById(req.params.id).lean();
    if (!p) throw new HttpError(404, 'Place not found');
    const entrances = await Entrance.find({ place_id: p._id }).lean();
    const deps = db.prepare('SELECT department, COUNT(*) AS n FROM people WHERE place_id = ? GROUP BY department ORDER BY n DESC').all(p._id) as { department: string; n: number }[];
    const hours = p.hours as Hours | null;
    res.json({
      ...placeLite(p as never, peopleCounts()),
      description: p.description, footprint: p.footprint, height: p.height,
      hours, hours_text: formatHours(hours), open_state: openState(hours, config.timezone),
      closed_from: p.closed_from, verified_at: p.verified_at, review_months: p.review_months, source: p.source,
      entrances: entrances.map(e => ({ id: e._id, name: e.name, coordinates: e.location!.coordinates, step_free: e.step_free, estimated: e.estimated })),
      departments: deps.map(d => ({ id: d.department, name: DEPARTMENTS[d.department]?.name ?? d.department, count: d.n })),
    });
  }));

  app.get('/api/places/:id/people', wrap(async (req, res) => {
    const names = await placeNames();
    if (!names.has(String(req.params.id))) throw new HttpError(404, 'Place not found');
    const dep = str(req.query.department);
    const views = directory.list({ placeId: String(req.params.id), department: dep }).map(r => directory.view(r, names));
    const floors = new Map<string, typeof views>();
    for (const v of views) {
      const key = v.floor == null ? 'unknown' : String(v.floor);
      floors.set(key, [...(floors.get(key) ?? []), v]);
    }
    const order = [...floors.keys()].sort((a, b) => (a === 'unknown' ? 99 : Number(a)) - (b === 'unknown' ? 99 : Number(b)));
    res.json({ place_id: req.params.id, total: views.length, floors: order.map(f => ({ floor: f === 'unknown' ? null : Number(f), people: floors.get(f)!.sort((a, b) => (a.office_number ?? '').localeCompare(b.office_number ?? '', undefined, { numeric: true })) })) });
  }));

  app.get('/api/people', wrap(async (req, res) => {
    const names = await placeNames();
    let views = directory.list({ q: str(req.query.q), department: str(req.query.department) }).map(r => directory.view(r, names));
    if (req.query.open_now === 'true' || req.query.open_now === '1') views = views.filter(v => ['open', 'in'].includes(v.availability.state));
    res.json(views.slice(0, Math.min(200, num(req.query.limit) ?? 200)));
  }));

  app.get('/api/people/:id', wrap(async (req, res) => {
    const r = directory.row(String(req.params.id));
    if (!r) throw new HttpError(404, 'Person not found');
    res.json(directory.view(r, await placeNames()));
  }));

  app.put('/api/people/:id/presence', wrap(async (req, res) => {
    const user = userOf(req);
    const id = String(req.params.id);
    // A faculty member sets their own status; the admin can set anyone's.
    const isAdmin = req.header('authorization') === `Bearer ${config.adminToken}` || ['admin', 'dev'].includes(sessionUser(req)?.role ?? '');
    const isSelf = (user.role === 'faculty' || user.role === 'staff') && (user.person_id ?? user.id) === id;
    if (!(isAdmin || isSelf)) throw new HttpError(403, 'Only this faculty member or an authenticated admin can set their status.');
    if (!directory.row(id)) throw new HttpError(404, 'Person not found');
    const status = req.body?.status;
    if (!['in', 'busy', 'out', 'clear', 'keep'].includes(status)) throw bad('status must be in, busy, out, clear or keep');
    const reason = req.body?.reason ?? null;
    if (reason !== null && !(REASONS as readonly string[]).includes(reason)) throw bad('unknown reason');
    const until = req.body?.until ?? null;
    if (until !== null && (typeof until !== 'string' || Number.isNaN(Date.parse(until)))) throw bad('until must be an ISO timestamp or null');
    if (until && Date.parse(until) - Date.now() > 200 * 86400000) throw bad('an absence can last at most one semester (200 days)');
    if (until && Date.parse(until) - Date.now() > 86400000 && status !== 'out') throw bad('only "out" can last several days');
    if (req.body?.note !== undefined && req.body.note !== null && typeof req.body.note !== 'string') throw bad('note must be text');
    const noteKind = req.body?.note_kind ?? null;
    if (noteKind !== null && !NOTE_KINDS.includes(noteKind)) throw bad(`note_kind must be one of ${NOTE_KINDS.join(', ')}`);
    const lunch = req.body?.lunch;
    if (lunch !== undefined && lunch !== null && (!Array.isArray(lunch) || lunch.length !== 2 || !lunch.every((t: unknown) => typeof t === 'string' && TIME.test(t)) || lunch[0] >= lunch[1])) throw bad('lunch must be ["HH:MM","HH:MM"] or null');
    if (status !== 'keep') directory.setPresence(id, { status, reason, until }, user.name);
    if (req.body?.note !== undefined) saveNote(id, req.body.note, noteKind);
    if (lunch !== undefined) db.prepare('UPDATE people SET lunch = ? WHERE id = ?').run(lunch ? JSON.stringify(lunch) : null, id);
    db.prepare('DELETE FROM assistant_cache').run();
    bump();
    res.json(directory.view(directory.row(id)!, await placeNames()));
  }));

  function saveNote(id: string, raw: unknown, kind: string | null) {
    const note = str(raw, 500);
    if (note || kind) db.prepare('INSERT INTO office_notes (person_id,note,kind,updated_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(person_id) DO UPDATE SET note=excluded.note,kind=excluded.kind,updated_at=excluded.updated_at,expires_at=excluded.expires_at').run(id, note ?? '', kind, now(), noteExpiry(kind));
    else db.prepare('DELETE FROM office_notes WHERE person_id = ?').run(id);
  }

  app.get('/api/procedures', (req, res) => {
    const q = str(req.query.q)?.toLowerCase();
    const rows = db.prepare('SELECT * FROM procedures ORDER BY title').all() as Record<string, string | null>[];
    res.json(rows.filter(r => !q || `${r.title} ${r.summary} ${r.match_phrases}`.toLowerCase().includes(q))
      .map(r => ({ ...r, steps: json.parse(r.steps, []), match_phrases: json.parse(r.match_phrases, []), unverified: r.status !== 'live' || isStale(r.verified_at) })));
  });

  app.post('/api/route', (req, res) => {
    const from = coord(req.body?.from);
    if (!from) throw bad('from {lat, lng} is required');
    const mode = (req.body?.mode ?? (req.body?.step_free ? 'step_free' : 'walk')) as RouteMode;
    if (!['walk', 'step_free', 'drive'].includes(mode)) throw bad('mode must be walk, step_free or drive');
    const placeId = str(req.body?.to_place_id);
    const to = coord(req.body?.to);
    if (!placeId && !to) throw bad('to_place_id or to {lat, lng} is required');
    const result = campus.route(from, { placeId, coord: to ?? undefined }, mode);
    if ('error' in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  });

  app.get('/api/geo/walkways', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ type: 'FeatureCollection', attribution: '© Mapbox © OpenStreetMap contributors', features: campus.walkways.map(w => ({ ...w, properties: { ...w.properties, closed: false } })) });
  });

  /** How hard each path is on wheels (gentle / moderate / steep / stairs): the app's step-free view. */
  app.get('/api/geo/slopes', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ...campus.slopes(), note: 'Slopes estimated from 10 m contour lines (© Mapbox Terrain).' });
  });

  /** Footprints of known places with their open state: the map lights up open buildings after dark. */
  app.get('/api/geo/buildings', wrap(async (_req, res) => {
    const places = await Place.find({ footprint: { $ne: null } }, { name: 1, category: 1, footprint: 1, height: 1, hours: 1, status: 1 }).lean();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ type: 'FeatureCollection', features: places.map(p => ({
      type: 'Feature', geometry: p.footprint,
      properties: { id: String(p._id), category: p.category, height: Math.max(4, Number(p.height) || 8), open: p.status !== 'closed' && openState(p.hours as Hours | null, config.timezone).state === 'open' },
    })) });
  }));

  /** What's on: under way and coming up, with the place to walk to. */
  app.get('/api/events', wrap(async (req, res) => {
    const days = Math.max(1, Math.min(60, num(req.query.days) ?? 21));
    const role = str(req.query.audience);
    const refs = await placeRefs();
    const list = events.list({ days }).map(e => events.view(e, refs))
      .filter(e => !role || e.audience === 'all' || e.audience === role || (role === 'guest' && e.audience === 'visitors') || (role === 'student' && e.audience === 'students'));
    res.set('Cache-Control', 'no-store');
    res.json(list);
  }));

  /** Footprints the basemap lacks (traced from satellite imagery or drawn in the admin): the app extrudes them. */
  app.get('/api/geo/extra-buildings', wrap(async (_req, res) => {
    const drawn = await Place.find({ source: 'admin', footprint: { $ne: null } }, { name: 1, category: 1, footprint: 1, height: 1 }).lean();
    // a traced shape that an admin-drawn building now covers is dropped
    const traced = tracedBuildings().filter(t => {
      const c = turf.centroid(t as never);
      return !drawn.some(d => d.footprint?.type === 'Polygon' && turf.booleanPointInPolygon(c, d.footprint as never));
    });
    const features = [
      ...drawn.map(p => ({ type: 'Feature', geometry: p.footprint, properties: { id: String(p._id), name: p.name, category: p.category, height: Math.max(4, Number(p.height) || 9), source: 'admin' } })),
      ...traced,
    ];
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ type: 'FeatureCollection', features });
  }));

  app.get('/api/geo/closures', wrap(async (_req, res) => {
    const reports = await Report.find({ status: 'confirmed', closure: { $ne: null } }).lean();
    const seen = new Set<string>();
    res.json(reports.filter(r => !seen.has(r.cluster_id) && seen.add(r.cluster_id)).map(r => ({ id: r._id, cluster_id: r.cluster_id, kind: r.kind, coordinates: r.location!.coordinates, place_id: r.place_id, reason: r.closure!.reason, from: r.closure!.from, until: r.closure!.until, radius_m: r.closure!.radius_m })));
  }));

  app.get('/api/crowding', (req, res) => {
    const today = (new Date().getDay() + 6) % 7;
    const weekday = Math.max(0, Math.min(6, num(req.query.weekday) ?? today));
    const hour = Math.max(8, Math.min(20, num(req.query.hour) ?? 12));
    const loads = new Map((db.prepare('SELECT edge_id, load FROM crowding WHERE weekday = ? AND hour = ?').all(weekday, hour) as { edge_id: string; load: number }[]).map(r => [r.edge_id, r.load]));
    const features = campus.walkways.filter(w => loads.has(w.properties.id)).map(w => {
      const load = loads.get(w.properties.id)!;
      let len = 0; const c = w.geometry.coordinates;
      for (let i = 1; i < c.length; i++) len += Math.hypot((c[i][0] - c[i - 1][0]) * 92700, (c[i][1] - c[i - 1][1]) * 110540);
      return { type: 'Feature', geometry: w.geometry, properties: { id: w.properties.id, load, delay_s: Math.round(len / 1.3 * load * 0.6), level: load > 0.66 ? 'high' : load > 0.33 ? 'medium' : 'low' } };
    });
    res.json({ type: 'FeatureCollection', weekday, hour, basis: 'Typical weekday, past four weeks (simulated until GPS traces exist)', features });
  });

  app.post('/api/assistant/ask', wrap(async (req, res) => {
    const text = str(req.body?.text, 500);
    if (!text) throw bad('Ask a question of up to 500 characters.');
    const lang = (LANGS.includes(req.body?.lang) ? req.body.lang : 'en') as Lang;
    const history = Array.isArray(req.body?.history) ? (req.body.history as unknown[]).slice(-6).filter((h): h is { role: 'user' | 'assistant'; text: string } =>
      !!h && typeof h === 'object' && ['user', 'assistant'].includes((h as { role: string }).role) && typeof (h as { text: unknown }).text === 'string').map(h => ({ role: h.role, text: h.text.slice(0, 500) })) : [];
    res.json(await assistant.ask({ text, lang, from: coord(req.body?.from), history, localOnly: req.body?.local_only === true }));
  }));

  /** Live speech: a 5-minute Soniox key for the phone's WebSocket. 404 when Soniox is not set up. */
  let sttKeys = 0, sttWindow = Date.now();
  // which engine turns speech into text on the server: the app avoids single-language on-device recognition when it is Soniox
  app.get('/api/assistant/voice', (_req, res) => { res.json({ transcription: config.sonioxKey ? 'soniox' : config.geminiKey ? 'gemini' : null }); });
  app.post('/api/assistant/stt-session', wrap(async (_req, res) => {
    if (!config.sonioxKey) throw new HttpError(404, 'Live transcription is not configured (SONIOX_API_KEY).');
    if (Date.now() - sttWindow > 60000) { sttWindow = Date.now(); sttKeys = 0; }
    if (++sttKeys > 30) throw new HttpError(429, 'Too many voice sessions, try again in a minute.');
    try {
      const k = await sonioxTemporaryKey(config.sonioxKey);
      res.set('Cache-Control', 'no-store');
      res.json({ provider: 'soniox', url: 'wss://stt-rt.soniox.com/transcribe-websocket', model: config.sonioxRtModel, api_key: k.api_key, expires_at: k.expires_at });
    } catch {
      throw new HttpError(503, 'Live transcription is unavailable right now.');
    }
  }));

  app.post('/api/assistant/transcribe', upload.single('audio'), wrap(async (req, res) => {
    if (!req.file) throw bad('audio file is required');
    const lang = (LANGS.includes(req.body?.lang) ? req.body.lang : 'en') as Lang;
    const mime = req.file.mimetype && req.file.mimetype !== 'application/octet-stream' ? req.file.mimetype : 'audio/mp4';
    try {
      res.json({ text: await assistant.transcribe(req.file.buffer, mime, lang) });
    } catch {
      throw new HttpError(503, 'Speech transcription is unavailable. Check the server transcription key and connection, or type your question.');
    }
  }));

  // ── reports (anyone) ──────────────────────────────────────────────────────

  app.post('/api/reports', upload.single('photo'), wrap(async (req, res) => {
    const kind = str(req.body?.kind);
    if (!kind || !['closed', 'broken', 'info', 'hazard', 'light', 'access'].includes(kind)) throw bad('kind must be closed, broken, info, hazard, light or access');
    const at = coord({ lat: req.body?.lat, lng: req.body?.lng });
    if (!at) throw bad('lat and lng are required');
    const duration = ['today', 'days', 'unknown'].includes(req.body?.duration) ? req.body.duration : 'unknown';
    const user = userOf(req);
    let photoPath: string | null = null;
    if (req.file) {
      if (!/^image\//.test(req.file.mimetype)) throw bad('photo must be an image');
      mkdirSync(uploadsDir, { recursive: true });
      const name = `${randomUUID()}${extname(req.file.originalname || '') || '.jpg'}`;
      writeFileSync(join(uploadsDir, name), req.file.buffer);
      photoPath = `/api/uploads/${name}`;
    }
    const point = { type: 'Point' as const, coordinates: at };
    const nearest = await Place.findOne({ location: { $near: { $geometry: point, $maxDistance: 80 } } }, { _id: 1, name: 1 }).lean();
    // duplicates within 20 m become one decision
    const twin = await Report.findOne({ status: { $in: ['new', 'confirmed'] }, location: { $near: { $geometry: point, $maxDistance: 20 } } }).lean();
    const doc = await Report.create({
      _id: randomUUID(), kind: kind as 'closed' | 'broken' | 'info' | 'hazard' | 'light' | 'access', location: point, place_id: nearest ? String(nearest._id) : null, note: str(req.body?.note, 1000) ?? null,
      photo_path: photoPath, duration: duration as 'today' | 'days' | 'unknown', reporter: user.id, reporter_name: user.name, status: twin?.status === 'confirmed' ? 'confirmed' : 'new',
      cluster_id: twin?.cluster_id ?? randomUUID(), closure: twin?.status === 'confirmed' ? twin.closure : null, created_at: now(),
    });
    res.status(201).json({ id: doc._id, status: doc.status, place: nearest ? { id: nearest._id, name: nearest.name } : null, merged_with_existing: !!twin });
  }));

  app.get('/api/reports/mine', wrap(async (req, res) => {
    const user = userOf(req);
    const mine = await Report.find({ reporter: user.id }).sort({ created_at: -1 }).limit(20).lean();
    res.json(mine.map(r => ({ id: r._id, kind: r.kind, status: r.status, place_id: r.place_id, created_at: r.created_at, decided_at: r.decided_at, reason: r.closure?.reason ?? null })));
  }));

  // ── admin (token) ─────────────────────────────────────────────────────────

  const admin = express.Router();
  admin.use((req, _res, next) => {
    // TODO: replace with GoCampus SSO
    // the admin token, or a signed-in admin / developer
    if (req.header('authorization') === `Bearer ${config.adminToken}`) { next(); return; }
    const u = sessionUser(req);
    if (u && (u.role === 'admin' || u.role === 'dev')) { next(); return; }
    next(new HttpError(u ? 403 : 401, u ? 'Your account is not an admin. Ask the GoMap team to give you the admin role.' : 'Admin token required')); return;
    next();
  });

  admin.get('/overview', wrap(async (_req, res) => {
    const places = await Place.find().lean();
    const people = db.prepare('SELECT * FROM people').all() as PersonRow[];
    const conflicts = people.filter(p => p.conflict).map(p => ({ id: p.id, name: p.name, conflict: json.parse(p.conflict, null) }));
    const sharedRows = db.prepare('SELECT place_id, office_number, GROUP_CONCAT(name, \', \') AS names, COUNT(*) AS n FROM people WHERE office_number IS NOT NULL GROUP BY place_id, office_number HAVING n > 2').all();
    const stalePlaces = places.filter(p => isStale(p.verified_at ?? null, p.review_months ?? 6)).map(p => ({ id: p._id, name: p.name, verified_at: p.verified_at, position_estimated: p.position_estimated }));
    const stalePeople = people.filter(p => isStale(p.verified_at)).map(p => ({ id: p.id, name: p.name, verified_at: p.verified_at }));
    const missing = people.filter(p => !p.place_id || !p.email || !p.office_hours).map(p => ({ id: p.id, name: p.name, missing: [!p.place_id && 'office', !p.email && 'email', !p.office_hours && 'hours'].filter(Boolean) }));
    const unanswered = db.prepare(`SELECT question, lang, COUNT(*) AS times, MAX(created_at) AS last FROM assistant_log WHERE intent IN ('unknown','error') GROUP BY lower(question) ORDER BY times DESC, last DESC LIMIT 20`).all();
    const reportsNew = await Report.aggregate([{ $match: { status: 'new' } }, { $group: { _id: '$cluster_id' } }, { $count: 'n' }]);
    const procs = db.prepare('SELECT id, title, status, verified_at FROM procedures').all() as { status: string }[];
    res.json({
      counts: { places: places.length, people: people.length, procedures: procs.length, services: offices.list().length, issues: offices.issues().length, open_reports: reportsNew[0]?.n ?? 0, conflicts: conflicts.length, unanswered: unanswered.length },
      conflicts, shared_offices: sharedRows, stale: { places: stalePlaces, people: stalePeople.slice(0, 50), people_total: stalePeople.length },
      missing: missing.slice(0, 50), missing_total: missing.length, unanswered, procedures_not_live: procs.filter(p => p.status !== 'live'),
    });
  }));

  admin.put('/places/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const p = await Place.findById(id);
    if (!p) throw new HttpError(404, 'Place not found');
    const b = req.body ?? {};
    const changes: Record<string, unknown> = {};
    if (b.name !== undefined) changes.name = str(b.name) ?? (() => { throw bad('name required'); })();
    if (b.category !== undefined) { if (!CATEGORIES.includes(b.category)) throw bad('unknown category'); changes.category = b.category; }
    if (b.schools !== undefined) { if (!Array.isArray(b.schools) || b.schools.some((s: string) => !SCHOOLS.includes(s as never))) throw bad('unknown school'); changes.schools = b.schools; }
    if (b.aliases !== undefined) { if (!Array.isArray(b.aliases)) throw bad('aliases must be a list'); changes.aliases = b.aliases.map((a: unknown) => str(a, 80)).filter(Boolean); }
    if (b.description !== undefined) changes.description = str(b.description, 1000) ?? null;
    if (b.hours !== undefined) changes.hours = hoursInput(b.hours);
    if (b.coordinates !== undefined) {
      const c = coord({ lng: b.coordinates?.[0], lat: b.coordinates?.[1] });
      if (!c) throw bad('coordinates must be [lng, lat]');
      changes.location = { type: 'Point', coordinates: c }; changes.position_estimated = false;
    }
    if (b.status !== undefined) {
      if (!['open', 'closed'].includes(b.status)) throw bad('status must be open or closed');
      Object.assign(changes, { status: b.status, closed_reason: b.status === 'closed' ? str(b.closed_reason) ?? null : null, closed_from: b.status === 'closed' ? str(b.closed_from) ?? now() : null, closed_until: b.status === 'closed' ? str(b.closed_until) ?? null : null });
    }
    if (b.number !== undefined) changes.number = str(b.number, 8)?.toUpperCase() ?? null;
    if (b.height !== undefined) changes.height = b.height === null ? null : Math.max(3, Math.min(60, num(b.height) ?? 9));
    if (b.footprint !== undefined) {
      if (b.footprint !== null && (b.footprint?.type !== 'Polygon' || !Array.isArray(b.footprint.coordinates?.[0]) || b.footprint.coordinates[0].length < 4)) throw bad('footprint must be a GeoJSON Polygon');
      changes.footprint = b.footprint;
    }
    if (b.verify === true) changes.verified_at = now();
    if (b.review_months !== undefined) changes.review_months = Math.max(1, Math.min(36, num(b.review_months) ?? 6));
    changes.updated_at = now();
    await Place.updateOne({ _id: id }, { $set: changes });
    changeLog('place', id, 'update', changes, 'admin');
    await assistant.refresh();
    if (changes.location || changes.footprint !== undefined) await campus.rebuild();
    res.json(await Place.findById(id).lean());
  }));

  /** A new place, e.g. a building traced on the satellite view. Its entrance is estimated automatically. */
  admin.post('/places', wrap(async (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name);
    if (!name) throw bad('name is required');
    if (!CATEGORIES.includes(b.category)) throw bad(`category must be one of ${CATEGORIES.join(', ')}`);
    let footprint: { type: 'Polygon'; coordinates: Position[][] } | null = null;
    if (b.footprint != null) {
      const ring = b.footprint?.coordinates?.[0];
      if (b.footprint?.type !== 'Polygon' || !Array.isArray(ring) || ring.length < 4 || ring.some((c: unknown) => !Array.isArray(c) || !coord({ lng: (c as number[])[0], lat: (c as number[])[1] }))) throw bad('footprint must be a GeoJSON Polygon with at least 3 corners');
      footprint = { type: 'Polygon', coordinates: [ring.map((c: number[]) => [Number(Number(c[0]).toFixed(7)), Number(Number(c[1]).toFixed(7))])] };
    }
    const at = b.coordinates ? coord({ lng: b.coordinates[0], lat: b.coordinates[1] }) : footprint ? turf.centroid(footprint as never).geometry.coordinates as Position : null;
    if (!at) throw bad('coordinates [lng, lat] or a footprint is required');
    const number = str(b.number, 8)?.toUpperCase() ?? null;
    const id = number && !(await Place.exists({ _id: `building-${number.toLowerCase()}` })) ? `building-${number.toLowerCase()}` : newId('place', name);
    const stamp = now();
    const aliases = Array.isArray(b.aliases) ? b.aliases.map((a: unknown) => str(a, 80)).filter(Boolean) as string[] : [];
    await Place.create({
      _id: id, name, number, category: b.category, schools: [],
      aliases: [...new Set([...aliases, ...(number ? [`building ${number.toLowerCase()}`, `b${number.toLowerCase()}`, number.toLowerCase()] : [])])],
      description: str(b.description, 1000) ?? null, location: { type: 'Point', coordinates: at }, footprint, height: Math.max(3, Math.min(60, num(b.height) ?? 9)),
      hours: null, status: 'open', position_estimated: false, source: 'admin', verified_at: stamp, created_at: stamp, updated_at: stamp,
    });
    changeLog('place', id, 'create', { name, category: b.category, number, footprint: !!footprint }, 'admin');
    await campus.rebuild();
    await assistant.refresh();
    res.status(201).json(await Place.findById(id).lean());
  }));

  /** Removes a place, its entrances, and every link to it (people, offices, events keep their other data). */
  admin.delete('/places/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const p = await Place.findById(id).lean();
    if (!p) throw new HttpError(404, 'Place not found');
    await Place.deleteOne({ _id: id });
    await Entrance.deleteMany({ place_id: id });
    const people = db.prepare('UPDATE people SET place_id = NULL WHERE place_id = ?').run(id).changes;
    for (const s of offices.list().filter(s => json.parse<string[]>(s.place_ids, []).includes(id))) {
      db.prepare('UPDATE services SET place_ids = ? WHERE id = ?').run(JSON.stringify(json.parse<string[]>(s.place_ids, []).filter(x => x !== id)), s.id);
    }
    for (const table of ['events', 'issue_routing', 'procedures', 'assistant_rules']) db.prepare(`UPDATE ${table} SET place_id = NULL WHERE place_id = ?`).run(id);
    changeLog('place', id, 'delete', { name: p.name, category: p.category, people_unlinked: people }, 'admin');
    await campus.rebuild();
    await assistant.refresh();
    // the full record comes back so the admin can undo
    res.json({ ok: true, deleted: p, people_unlinked: people });
  }));

  /** Every building outline we know (map data + satellite traces), and whether a named place sits in it. */
  admin.get('/footprints', wrap(async (_req, res) => {
    const places = await Place.find({}, { name: 1, location: 1, footprint: 1, source: 1 }).lean();
    const features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] = loadGeo().buildings.map((b, i) => {
      const inside = places.find(p => turf.booleanPointInPolygon(p.location!.coordinates as Position, b as never));
      return { type: 'Feature', geometry: b.geometry, properties: { id: `fp-${i}`, source: b.properties.source, height: b.properties.height ?? null, place_id: inside ? String(inside._id) : null, place_name: inside?.name ?? null } };
    });
    for (const p of places.filter(x => x.source === 'admin' && x.footprint)) features.push({ type: 'Feature', geometry: p.footprint, properties: { id: `place-${p._id}`, source: 'admin', height: null, place_id: String(p._id), place_name: p.name } });
    res.json({ type: 'FeatureCollection', features });
  }));

  // ── events ──
  const eventInput = async (b: Record<string, unknown>) => {
    if (b.place_id && !(await Place.exists({ _id: b.place_id }))) throw bad('unknown place_id');
    const out: Record<string, string | null | undefined> = {};
    if (b.title !== undefined) out.title = str(b.title, 140);
    if (b.description !== undefined) out.description = str(b.description, 2000) ?? null;
    if (b.kind !== undefined) out.kind = EVENT_KINDS.includes(b.kind as never) ? String(b.kind) : 'other';
    if (b.audience !== undefined) out.audience = AUDIENCES.includes(b.audience as never) ? String(b.audience) : 'all';
    if (b.place_id !== undefined) out.place_id = (b.place_id as string | null) || null;
    if (b.location_text !== undefined) out.location_text = str(b.location_text, 200) ?? null;
    if (b.starts_at !== undefined) out.starts_at = str(b.starts_at, 40);
    if (b.ends_at !== undefined) out.ends_at = str(b.ends_at, 40);
    if (b.organizer !== undefined) out.organizer = str(b.organizer, 120) ?? null;
    if (b.link !== undefined) out.link = str(b.link, 300) ?? null;
    return out as Record<string, string | null>;
  };
  const saveEvent = async (id: string | null, body: Record<string, unknown>) => {
    const input = await eventInput(body);
    try { return events.save(id, input); } catch (e) { throw bad((e as Error).message); }
  };
  admin.get('/events', wrap(async (_req, res) => { const refs = await placeRefs(); res.json(events.list({ includePast: true }).map(e => events.view(e, refs))); }));
  admin.post('/events', wrap(async (req, res) => {
    const id = await saveEvent(null, req.body ?? {});
    changeLog('event', id, 'create', req.body, 'admin');
    await assistant.refresh();
    res.status(201).json(events.view(events.row(id)!, await placeRefs()));
  }));
  admin.put('/events/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!events.row(id)) throw new HttpError(404, 'Event not found');
    await saveEvent(id, req.body ?? {});
    changeLog('event', id, 'update', req.body, 'admin');
    await assistant.refresh();
    res.json(events.view(events.row(id)!, await placeRefs()));
  }));
  admin.delete('/events/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!events.delete(id)) throw new HttpError(404, 'Event not found');
    changeLog('event', id, 'delete', null, 'admin');
    res.json({ ok: true });
  }));

  // ── assistant rules, tests and playground ──
  const ruleInput = async (b: Record<string, unknown>, e?: RuleRow) => {
    const row = {
      title: b.title !== undefined ? str(b.title, 120) : e?.title,
      answer: b.answer !== undefined ? str(b.answer, 1500) : e?.answer,
      answer_fr: b.answer_fr !== undefined ? str(b.answer_fr, 1500) ?? null : e?.answer_fr ?? null,
      answer_ar: b.answer_ar !== undefined ? str(b.answer_ar, 1500) ?? null : e?.answer_ar ?? null,
      triggers: b.triggers !== undefined ? JSON.stringify(strList(b.triggers, 160)) : e?.triggers ?? '[]',
      place_id: b.place_id !== undefined ? (b.place_id ? String(b.place_id) : null) : e?.place_id ?? null,
      service_id: b.service_id !== undefined ? (b.service_id ? String(b.service_id) : null) : e?.service_id ?? null,
      procedure_id: b.procedure_id !== undefined ? (b.procedure_id ? String(b.procedure_id) : null) : e?.procedure_id ?? null,
      urgent: b.urgent !== undefined ? (b.urgent ? 1 : 0) : e?.urgent ?? 0,
      enabled: b.enabled !== undefined ? (b.enabled === false ? 0 : 1) : e?.enabled ?? 1,
    };
    if (!row.title || !row.answer) throw bad('title and answer are required');
    if (row.place_id && !(await Place.exists({ _id: row.place_id }))) throw bad('unknown place_id');
    if (row.service_id && !offices.row(row.service_id)) throw bad('unknown service_id');
    if (row.procedure_id && !db.prepare('SELECT 1 FROM procedures WHERE id = ?').get(row.procedure_id)) throw bad('unknown procedure_id');
    return row as typeof row & { title: string; answer: string };
  };
  const saveRule = (id: string, r: Awaited<ReturnType<typeof ruleInput>>) => db.prepare(`INSERT INTO assistant_rules (id,title,triggers,answer,answer_fr,answer_ar,place_id,service_id,procedure_id,urgent,enabled,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, triggers=excluded.triggers, answer=excluded.answer, answer_fr=excluded.answer_fr,
    answer_ar=excluded.answer_ar, place_id=excluded.place_id, service_id=excluded.service_id, procedure_id=excluded.procedure_id, urgent=excluded.urgent, enabled=excluded.enabled, updated_at=excluded.updated_at`)
    .run(id, r.title, r.triggers, r.answer, r.answer_fr, r.answer_ar, r.place_id, r.service_id, r.procedure_id, r.urgent, r.enabled, now());
  const ruleRow = (id: string) => db.prepare('SELECT * FROM assistant_rules WHERE id = ?').get(id) as RuleRow | undefined;
  admin.get('/rules', (_req, res) => { res.json((db.prepare('SELECT * FROM assistant_rules ORDER BY enabled DESC, title').all() as RuleRow[]).map(ruleView)); });
  admin.post('/rules', wrap(async (req, res) => {
    const r = await ruleInput(req.body ?? {});
    const id = newId('rule', r.title);
    saveRule(id, r); changeLog('rule', id, 'create', r, 'admin'); await assistant.refresh();
    res.status(201).json(ruleView(ruleRow(id)!));
  }));
  admin.put('/rules/:id', wrap(async (req, res) => {
    const existing = ruleRow(String(req.params.id));
    if (!existing) throw new HttpError(404, 'Rule not found');
    const r = await ruleInput(req.body ?? {}, existing);
    saveRule(existing.id, r); changeLog('rule', existing.id, 'update', r, 'admin'); await assistant.refresh();
    res.json(ruleView(ruleRow(existing.id)!));
  }));
  admin.delete('/rules/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('DELETE FROM assistant_rules WHERE id = ?').run(id).changes) throw new HttpError(404, 'Rule not found');
    changeLog('rule', id, 'delete', null, 'admin'); await assistant.refresh();
    res.json({ ok: true });
  }));

  const testRow = (id: string) => db.prepare('SELECT * FROM assistant_tests WHERE id = ?').get(id) as TestRow | undefined;
  const testInput = (b: Record<string, unknown>, e?: TestRow) => {
    const question = b.question !== undefined ? str(b.question, 300) : e?.question;
    if (!question) throw bad('question is required');
    return {
      question, lang: b.lang !== undefined ? (LANGS.includes(String(b.lang)) ? String(b.lang) : 'en') : e?.lang ?? 'en',
      expect_intent: b.expect_intent !== undefined ? str(b.expect_intent, 20) ?? null : e?.expect_intent ?? null,
      expect_id: b.expect_id !== undefined ? str(b.expect_id, 80) ?? null : e?.expect_id ?? null,
      expect_text: b.expect_text !== undefined ? str(b.expect_text, 120) ?? null : e?.expect_text ?? null,
    };
  };
  const saveTest = (id: string, t: ReturnType<typeof testInput>) => db.prepare(`INSERT INTO assistant_tests (id,question,lang,expect_intent,expect_id,expect_text,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET question=excluded.question, lang=excluded.lang, expect_intent=excluded.expect_intent, expect_id=excluded.expect_id, expect_text=excluded.expect_text, last_result=NULL, updated_at=excluded.updated_at`)
    .run(id, t.question, t.lang, t.expect_intent, t.expect_id, t.expect_text, now());
  admin.get('/assistant-tests', (_req, res) => { res.json((db.prepare('SELECT * FROM assistant_tests ORDER BY id').all() as TestRow[]).map(testView)); });
  admin.post('/assistant-tests', wrap(async (req, res) => { const t = testInput(req.body ?? {}); const id = newId('test', t.question); saveTest(id, t); res.status(201).json(testView(testRow(id)!)); }));
  admin.put('/assistant-tests/:id', wrap(async (req, res) => { const e = testRow(String(req.params.id)); if (!e) throw new HttpError(404, 'Test not found'); saveTest(e.id, testInput(req.body ?? {}, e)); res.json(testView(testRow(e.id)!)); }));
  admin.delete('/assistant-tests/:id', (req, res) => { if (!db.prepare('DELETE FROM assistant_tests WHERE id = ?').run(String(req.params.id)).changes) throw new HttpError(404, 'Test not found'); res.json({ ok: true }); });
  /** Runs every test (or one). local_only skips the AI model, so a run costs nothing. */
  admin.post('/assistant-tests/run', wrap(async (req, res) => {
    const only = str(req.body?.id);
    const rows = only ? [testRow(only)].filter((x): x is TestRow => !!x) : db.prepare('SELECT * FROM assistant_tests ORDER BY id').all() as TestRow[];
    const results = [];
    for (const t of rows) results.push({ ...(await runTest(db, assistant, t, req.body?.local_only === true)), test: t.id });
    res.json({ total: results.length, passed: results.filter(r => r.pass).length, results });
  }));
  admin.post('/assistant/try', wrap(async (req, res) => {
    const text = str(req.body?.question, 500);
    if (!text) throw bad('question is required');
    const lang = (LANGS.includes(req.body?.lang) ? req.body.lang : 'en') as Lang;
    res.json(await assistant.ask({ text, lang, from: null, trace: true, noLog: true }));
  }));
  admin.get('/assistant/status', (_req, res) => {
    res.json({ model: assistant.model, rules: (db.prepare('SELECT COUNT(*) AS n FROM assistant_rules WHERE enabled = 1').get() as { n: number }).n,
      transcription: config.sonioxKey ? 'soniox' : config.geminiKey ? 'gemini' : null });
  });

  admin.put('/entrances/:id', wrap(async (req, res) => {
    const e = await Entrance.findById(req.params.id);
    if (!e) throw new HttpError(404, 'Entrance not found');
    const b = req.body ?? {};
    const set: Record<string, unknown> = {};
    if (b.name !== undefined) set.name = str(b.name) ?? 'Entrance';
    if (b.step_free !== undefined) set.step_free = !!b.step_free;
    if (b.coordinates !== undefined) { const c = coord({ lng: b.coordinates?.[0], lat: b.coordinates?.[1] }); if (!c) throw bad('coordinates must be [lng, lat]'); set.location = { type: 'Point', coordinates: c }; }
    set.estimated = false;
    await Entrance.updateOne({ _id: e._id }, { $set: set });
    changeLog('entrance', String(e._id), 'update', set, 'admin');
    await campus.rebuild();
    res.json(await Entrance.findById(e._id).lean());
  }));

  admin.put('/people/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const r = directory.row(id);
    if (!r) throw new HttpError(404, 'Person not found');
    const b = req.body ?? {};
    const fields: Record<string, unknown> = {};
    for (const k of ['name', 'title', 'email', 'phone', 'profile_url', 'office_number'] as const) if (b[k] !== undefined) fields[k] = str(b[k]) ?? null;
    if (b.place_id !== undefined) {
      if (b.place_id !== null && !(await Place.exists({ _id: b.place_id }))) throw bad('unknown place_id');
      fields.place_id = b.place_id;
    }
    if (b.floor !== undefined) fields.floor = b.floor === null ? null : Math.round(num(b.floor) ?? 0);
    if (b.office_hours !== undefined) { const h = hoursInput(b.office_hours); fields.office_hours = h ? JSON.stringify(h) : null; }
    if (b.hours_raw !== undefined) { fields.hours_raw = str(b.hours_raw, 500) ?? null; if (b.office_hours === undefined) { const h = parseHours(fields.hours_raw as string | null).hours; fields.office_hours = h ? JSON.stringify(h) : null; } }
    if (b.lunch !== undefined) {
      if (b.lunch !== null && (!Array.isArray(b.lunch) || b.lunch.length !== 2 || !b.lunch.every((t: unknown) => typeof t === 'string' && TIME.test(t)))) throw bad('lunch must be ["HH:MM","HH:MM"] or null');
      fields.lunch = b.lunch ? JSON.stringify(b.lunch) : null;
    }
    if (b.note_kind !== undefined && b.note_kind !== null && !NOTE_KINDS.includes(b.note_kind)) throw bad('unknown note_kind');
    if (b.presence !== undefined && !['in', 'busy', 'out', 'clear'].includes(b.presence)) throw bad('presence must be in, busy, out or clear');
    if (b.resolve_conflict === true) fields.conflict = null;
    if (b.verify === true) fields.verified_at = now();
    fields.admin_edited = 1;
    fields.updated_at = now();
    const keys = Object.keys(fields);
    db.prepare(`UPDATE people SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k] as string | number | null), id);
    if (b.note !== undefined) saveNote(id, b.note, b.note_kind ?? null);
    if (b.presence !== undefined) directory.setPresence(id, { status: b.presence }, 'admin');
    changeLog('person', id, 'update', fields, 'admin');
    await assistant.refresh();
    res.json(directory.view(directory.row(id)!, await placeNames()));
  }));

  const saveProcedure = (id: string, b: Record<string, unknown>, existing?: Record<string, string | null>) => {
    const steps = b.steps ?? json.parse(existing?.steps, []);
    const phrases = b.match_phrases ?? json.parse(existing?.match_phrases, []);
    if (!Array.isArray(steps) || steps.some(s => !s || typeof s !== 'object' || typeof (s as { title: unknown }).title !== 'string')) throw bad('steps must be [{title, body}]');
    if (!Array.isArray(phrases) || phrases.some(p => typeof p !== 'string')) throw bad('match_phrases must be a list of strings');
    const status = (b.status ?? existing?.status ?? 'draft') as string;
    if (!['draft', 'review', 'live'].includes(status)) throw bad('status must be draft, review or live');
    const channel = (b.channel ?? existing?.channel ?? 'in_person') as string;
    if (!['in_person', 'online', 'mixed'].includes(channel)) throw bad('channel must be in_person, online or mixed');
    const row = {
      title: str(b.title) ?? existing?.title, summary: str(b.summary, 1000) ?? existing?.summary, owner_office: str(b.owner_office) ?? existing?.owner_office,
      place_id: b.place_id !== undefined ? (b.place_id as string | null) : existing?.place_id ?? null,
      contact_email: b.contact_email !== undefined ? (str(b.contact_email) ?? null) : existing?.contact_email ?? null,
      source: b.source !== undefined ? (str(b.source, 300) ?? null) : existing?.source ?? null,
      verified_at: b.verify === true || (status === 'live' && existing?.status !== 'live') ? now() : existing?.verified_at ?? null,
    };
    if (!row.title || !row.summary || !row.owner_office) throw bad('title, summary and owner_office are required');
    db.prepare(`INSERT INTO procedures (id,title,summary,owner_office,place_id,contact_email,steps,match_phrases,source,status,verified_at,updated_at,channel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, owner_office=excluded.owner_office, place_id=excluded.place_id,
      contact_email=excluded.contact_email, steps=excluded.steps, match_phrases=excluded.match_phrases, source=excluded.source, status=excluded.status,
      verified_at=excluded.verified_at, updated_at=excluded.updated_at, channel=excluded.channel`)
      .run(id, row.title, row.summary, row.owner_office, row.place_id, row.contact_email, JSON.stringify(steps), JSON.stringify(phrases), row.source, status, row.verified_at, now(), channel);
    changeLog('procedure', id, existing ? 'update' : 'create', { ...row, status, channel }, 'admin');
  };
  admin.post('/procedures', wrap(async (req, res) => {
    const title = str(req.body?.title);
    if (!title) throw bad('title required');
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + randomUUID().slice(0, 4);
    if (req.body?.place_id && !(await Place.exists({ _id: req.body.place_id }))) throw bad('unknown place_id');
    saveProcedure(id, req.body);
    await assistant.refresh();
    res.status(201).json(db.prepare('SELECT * FROM procedures WHERE id = ?').get(id));
  }));
  admin.put('/procedures/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT * FROM procedures WHERE id = ?').get(id) as Record<string, string | null> | undefined;
    if (!existing) throw new HttpError(404, 'Procedure not found');
    if (req.body?.place_id && !(await Place.exists({ _id: req.body.place_id }))) throw bad('unknown place_id');
    saveProcedure(id, req.body ?? {}, existing);
    await assistant.refresh();
    res.json(db.prepare('SELECT * FROM procedures WHERE id = ?').get(id));
  }));
  // where online procedures happen (add/drop, cash wallet, housing reservation): one name and link for all of them
  admin.get('/student-portal', (_req, res) => { res.json(assistant.portal()); });
  admin.put('/student-portal', wrap(async (req, res) => {
    const name = str(req.body?.name, 80) ?? 'the student portal';
    const url = str(req.body?.url, 300) ?? null;
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw bad('url must start with https://');
    meta.set(db, 'student_portal', JSON.stringify({ name, url }));
    changeLog('settings', 'student_portal', 'update', { name, url }, 'admin');
    db.prepare('DELETE FROM assistant_cache').run();
    res.json(assistant.portal());
  }));
  admin.post('/procedures/preview', wrap(async (req, res) => {
    // what a student would be told, without saving
    const text = str(req.body?.question, 300) ?? '';
    res.json(await assistant.ask({ text, lang: 'en', from: null }));
  }));

  admin.get('/reports', wrap(async (req, res) => {
    const status = str(req.query.status);
    const valid = ['new', 'confirmed', 'dismissed', 'resolved'] as const;
    const st = valid.find(v => v === status);
    const reports = await (st ? Report.find({ status: st }) : Report.find()).sort({ created_at: -1 }).limit(500).lean();
    const names = await placeNames();
    const clusters = new Map<string, typeof reports>();
    for (const r of reports) clusters.set(r.cluster_id, [...(clusters.get(r.cluster_id) ?? []), r]);
    res.json([...clusters.entries()].map(([cluster_id, list]) => {
      const first = list[list.length - 1];
      return {
        cluster_id, status: list[0].status, kind: first.kind, count: list.length, coordinates: first.location!.coordinates,
        place: first.place_id ? { id: first.place_id, name: names.get(first.place_id) ?? first.place_id } : null,
        closure: list.find(r => r.closure)?.closure ?? null, first_at: first.created_at, last_at: list[0].created_at,
        reports: list.map(r => ({ id: r._id, kind: r.kind, note: r.note, photo_path: r.photo_path, duration: r.duration, reporter: r.reporter_name ?? r.reporter, created_at: r.created_at })),
      };
    }));
  }));

  admin.post('/reports/:cluster/confirm', wrap(async (req, res) => {
    const cluster = String(req.params.cluster);
    const reports = await Report.find({ cluster_id: cluster }).lean();
    if (!reports.length) throw new HttpError(404, 'Report not found');
    const reason = str(req.body?.reason, 200);
    if (!reason) throw bad('reason is shown on the map and is required');
    const from = str(req.body?.from) ?? now();
    const until = str(req.body?.until) ?? null;
    if (Number.isNaN(Date.parse(from)) || (until && Number.isNaN(Date.parse(until)))) throw bad('from/until must be ISO dates');
    const radius = Math.max(5, Math.min(80, num(req.body?.radius_m) ?? 15));
    await Report.updateMany({ cluster_id: cluster }, { $set: { status: 'confirmed', decided_at: now(), closure: { from, until, reason, radius_m: radius } } });
    const placeId = reports.find(r => r.place_id)?.place_id;
    if (placeId && req.body?.close_place !== false && reports.some(r => r.kind === 'closed' || r.kind === 'access')) {
      await Place.updateOne({ _id: placeId }, { $set: { status: 'closed', closed_reason: reason, closed_from: from, closed_until: until, updated_at: now() } });
    }
    changeLog('report', cluster, 'confirm', { from, until, reason, radius, placeId }, 'admin');
    await campus.refreshClosures();
    await assistant.refresh();
    res.json({ ok: true, notified: [...new Set(reports.map(r => r.reporter_name ?? r.reporter))], closed_edges: campus.closed.size });
  }));

  admin.post('/reports/:cluster/dismiss', wrap(async (req, res) => {
    const r = await Report.updateMany({ cluster_id: String(req.params.cluster) }, { $set: { status: 'dismissed', decided_at: now() } });
    if (!r.matchedCount) throw new HttpError(404, 'Report not found');
    changeLog('report', String(req.params.cluster), 'dismiss', null, 'admin');
    res.json({ ok: true });
  }));

  admin.post('/reports/:cluster/resolve', wrap(async (req, res) => {
    const cluster = String(req.params.cluster);
    const reports = await Report.find({ cluster_id: cluster }).lean();
    if (!reports.length) throw new HttpError(404, 'Report not found');
    await Report.updateMany({ cluster_id: cluster }, { $set: { status: 'resolved', decided_at: now() } });
    const placeId = reports.find(r => r.place_id)?.place_id;
    if (placeId) await Place.updateOne({ _id: placeId, status: 'closed' }, { $set: { status: 'open', closed_reason: null, closed_from: null, closed_until: null, updated_at: now() } });
    changeLog('report', cluster, 'resolve', null, 'admin');
    await campus.refreshClosures();
    await assistant.refresh();
    res.json({ ok: true });
  }));

  // ── offices & services ──
  const saveService = (id: string, b: Record<string, unknown>, existing?: ServiceRow) => {
    const row = {
      name: b.name !== undefined ? str(b.name) : existing?.name,
      short_name: b.short_name !== undefined ? str(b.short_name, 80) ?? null : existing?.short_name ?? null,
      category: (b.category ?? existing?.category ?? 'service') as string,
      handles: b.handles !== undefined ? JSON.stringify(strList(b.handles, 200)) : existing?.handles ?? '[]',
      keywords: b.keywords !== undefined ? JSON.stringify(strList(b.keywords, 80)) : existing?.keywords ?? '[]',
      place_ids: b.place_ids !== undefined ? JSON.stringify(strList(b.place_ids, 80)) : existing?.place_ids ?? '[]',
      location_text: b.location_text !== undefined ? str(b.location_text, 300) ?? null : existing?.location_text ?? null,
      room: b.room !== undefined ? str(b.room, 40) ?? null : existing?.room ?? null,
      email: b.email !== undefined ? str(b.email, 120) ?? null : existing?.email ?? null,
      extension: b.extension !== undefined ? str(b.extension, 20) ?? null : existing?.extension ?? null,
      phone: b.phone !== undefined ? str(b.phone, 40) ?? null : existing?.phone ?? null,
      hours: b.hours !== undefined ? (() => { const h = hoursInput(b.hours); return h ? JSON.stringify(h) : null; })() : existing?.hours ?? null,
      hours_raw: b.hours_raw !== undefined ? str(b.hours_raw, 400) ?? null : existing?.hours_raw ?? null,
      notes: b.notes !== undefined ? str(b.notes, 1000) ?? null : existing?.notes ?? null,
      sort: b.sort !== undefined ? Math.round(num(b.sort) ?? 0) : existing?.sort ?? 999,
      verified_at: b.verify === true ? now() : existing?.verified_at ?? null,
    };
    if (!row.name) throw bad('name is required');
    if (!SERVICE_CATEGORIES.includes(row.category as never)) throw bad(`category must be one of ${SERVICE_CATEGORIES.join(', ')}`);
    db.prepare(`INSERT INTO services (id,name,short_name,category,handles,keywords,place_ids,location_text,room,email,extension,phone,hours,hours_raw,notes,sort,admin_edited,verified_at,source,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, category=excluded.category, handles=excluded.handles, keywords=excluded.keywords,
      place_ids=excluded.place_ids, location_text=excluded.location_text, room=excluded.room, email=excluded.email, extension=excluded.extension, phone=excluded.phone,
      hours=excluded.hours, hours_raw=excluded.hours_raw, notes=excluded.notes, sort=excluded.sort, admin_edited=1, verified_at=excluded.verified_at, updated_at=excluded.updated_at`)
      .run(id, row.name, row.short_name, row.category, row.handles, row.keywords, row.place_ids, row.location_text, row.room, row.email, row.extension, row.phone,
        row.hours, row.hours_raw, row.notes, row.sort, row.verified_at, existing?.source ?? 'Admin', now());
    changeLog('service', id, existing ? 'update' : 'create', row, 'admin');
  };
  const checkPlaces = async (ids: unknown) => {
    if (ids === undefined) return;
    for (const id of strList(ids, 80)) if (!(await Place.exists({ _id: id }))) throw bad(`unknown place ${id}`);
  };
  admin.get('/services', wrap(async (_req, res) => {
    const names = await placeNames();
    res.json(offices.list().map(r => offices.view(r, names)));
  }));
  admin.post('/services', wrap(async (req, res) => {
    const name = str(req.body?.name);
    if (!name) throw bad('name is required');
    await checkPlaces(req.body?.place_ids);
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + randomUUID().slice(0, 4);
    saveService(id, req.body);
    await assistant.refresh();
    res.status(201).json(offices.view(offices.row(id)!, await placeNames()));
  }));
  admin.put('/services/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const existing = offices.row(id);
    if (!existing) throw new HttpError(404, 'Service not found');
    await checkPlaces(req.body?.place_ids);
    saveService(id, req.body ?? {}, existing);
    await assistant.refresh();
    res.json(offices.view(offices.row(id)!, await placeNames()));
  }));
  admin.delete('/services/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('DELETE FROM services WHERE id = ?').run(id).changes) throw new HttpError(404, 'Service not found');
    changeLog('service', id, 'delete', null, 'admin');
    await assistant.refresh();
    res.json({ ok: true });
  }));

  const saveIssue = (id: string, b: Record<string, unknown>, existing?: IssueRow) => {
    const row = {
      issue: b.issue !== undefined ? str(b.issue, 300) : existing?.issue,
      go_to: b.go_to !== undefined ? str(b.go_to, 200) : existing?.go_to,
      service_id: b.service_id !== undefined ? (b.service_id === null ? null : str(b.service_id, 80) ?? null) : existing?.service_id ?? null,
      location_text: b.location_text !== undefined ? str(b.location_text, 300) ?? null : existing?.location_text ?? null,
      place_id: b.place_id !== undefined ? (b.place_id === null ? null : str(b.place_id, 80) ?? null) : existing?.place_id ?? null,
      notes: b.notes !== undefined ? str(b.notes, 1000) ?? null : existing?.notes ?? null,
      keywords: b.keywords !== undefined ? JSON.stringify(strList(b.keywords, 80)) : existing?.keywords ?? '[]',
      sort: b.sort !== undefined ? Math.round(num(b.sort) ?? 0) : existing?.sort ?? 999,
    };
    if (!row.issue || !row.go_to) throw bad('issue and go_to are required');
    if (row.service_id && !offices.row(row.service_id)) throw bad('unknown service_id');
    db.prepare(`INSERT INTO issue_routing (id,issue,go_to,service_id,location_text,place_id,notes,keywords,sort,admin_edited,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET issue=excluded.issue, go_to=excluded.go_to, service_id=excluded.service_id, location_text=excluded.location_text,
      place_id=excluded.place_id, notes=excluded.notes, keywords=excluded.keywords, sort=excluded.sort, admin_edited=1, updated_at=excluded.updated_at`)
      .run(id, row.issue, row.go_to, row.service_id, row.location_text, row.place_id, row.notes, row.keywords, row.sort, now());
    changeLog('issue', id, existing ? 'update' : 'create', row, 'admin');
  };
  admin.get('/issues', wrap(async (_req, res) => {
    const names = await placeNames();
    res.json(offices.issues().map(i => offices.issueView(i, names)));
  }));
  admin.post('/issues', wrap(async (req, res) => {
    if (req.body?.place_id) await checkPlaces([req.body.place_id]);
    const id = `issue-${randomUUID().slice(0, 8)}`;
    saveIssue(id, req.body ?? {});
    await assistant.refresh();
    res.status(201).json(offices.issueView(offices.issue(id)!, await placeNames()));
  }));
  admin.put('/issues/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const existing = offices.issue(id);
    if (!existing) throw new HttpError(404, 'Issue not found');
    if (req.body?.place_id) await checkPlaces([req.body.place_id]);
    saveIssue(id, req.body ?? {}, existing);
    await assistant.refresh();
    res.json(offices.issueView(offices.issue(id)!, await placeNames()));
  }));
  admin.delete('/issues/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('DELETE FROM issue_routing WHERE id = ?').run(id).changes) throw new HttpError(404, 'Issue not found');
    changeLog('issue', id, 'delete', null, 'admin');
    await assistant.refresh();
    res.json({ ok: true });
  }));

  admin.put('/campus-hours', wrap(async (req, res) => {
    const b = req.body ?? {};
    const c: CampusHours = { ...offices.campus() };
    for (const k of ['open', 'close'] as const) if (b[k] !== undefined) { if (typeof b[k] !== 'string' || !TIME.test(b[k])) throw bad(`${k} must be HH:MM`); c[k] = b[k]; }
    if (b.lunch !== undefined) { if (!Array.isArray(b.lunch) || b.lunch.length !== 2 || !b.lunch.every((t: unknown) => typeof t === 'string' && TIME.test(t))) throw bad('lunch must be ["HH:MM","HH:MM"]'); c.lunch = b.lunch; }
    if (b.emergencies !== undefined) c.emergencies = str(b.emergencies, 300) ?? null;
    if (b.weekend_working !== undefined) c.weekend_working = !!b.weekend_working;
    if (c.open >= c.close) throw bad('open must be before close');
    meta.set(db, 'campus_hours', JSON.stringify(c));
    changeLog('campus', 'hours', 'update', c, 'admin');
    await assistant.refresh();
    res.json(c);
  }));

  /** Published office hours vs time marked "in the office", per person. */
  admin.get('/office-time', wrap(async (req, res) => {
    const days = Math.max(1, Math.min(60, num(req.query.days) ?? 7));
    const logged = directory.officeTime(days);
    const names = await placeNames();
    const dep = str(req.query.department);
    const rows = directory.list({ department: dep }).filter(r => r.role === 'faculty' || logged.has(r.id)).map(r => {
      const v = directory.view(r, names);
      const l = logged.get(r.id);
      const published = weeklyMinutes(v.hours) * (days / 7);
      return {
        id: r.id, name: r.name, department: r.department, place: v.place, office_number: v.office_number,
        hours: v.hours, hours_text: v.hours_text, published_min: Math.round(published), in_min: l?.in ?? 0, busy_min: l?.busy ?? 0,
        sessions: l?.sessions ?? 0, by_day: l?.days ?? {}, ratio: published ? Math.round(((l?.in ?? 0) / published) * 100) / 100 : null,
        heat: l?.heat ?? null,
      };
    });
    res.json({ days, heat: logged.heat, people: rows.sort((a, b) => b.in_min - a.in_min || a.name.localeCompare(b.name)) });
  }));

  admin.get('/assistant-log', (_req, res) => {
    res.json(db.prepare('SELECT * FROM assistant_log ORDER BY created_at DESC LIMIT 200').all());
  });
  admin.get('/changes', (_req, res) => {
    res.json((db.prepare('SELECT * FROM change_log ORDER BY created_at DESC LIMIT 200').all() as Record<string, string>[]).map(c => ({ ...c, detail: json.parse(c.detail, null) })));
  });
  admin.get('/graph', (_req, res) => { res.type('text/plain').send(campus.report()); });

  app.use('/api/admin', admin);

  // ── dev dashboard (who gets which role) ───────────────────────────────────

  const dev = express.Router();
  dev.use((req, _res, next) => {
    const auth = req.header('authorization');
    if (config.devToken && auth === `Bearer ${config.devToken}`) { (req as Request & { actor?: string }).actor = 'dev-token'; next(); return; }
    const u = sessionUser(req);
    if (u?.role === 'dev') { (req as Request & { actor?: string }).actor = u.email; next(); return; }
    next(new HttpError(u ? 403 : 401, u ? 'Only developers can open the dev dashboard.' : 'Sign in with a developer account.'));
  });
  const actor = (req: Request) => (req as Request & { actor?: string }).actor ?? 'dev';
  const devCount = () => users.list().filter(u => u.role === 'dev').length;
  /** Never leave GoMap without a way into this dashboard. */
  const keepADev = (leaving: { role: string } | undefined) => {
    if (leaving?.role === 'dev' && devCount() <= 1 && !config.devToken && !config.devEmails.length) {
      throw bad('This is the last developer account. Add another developer first (or set DEV_EMAILS / DEV_TOKEN in server/.env).');
    }
  };
  const userView = (u: UserRow) => ({ ...safeUser(u), person: u.person_id ? (db.prepare('SELECT id, name, department FROM people WHERE id = ?').get(u.person_id) ?? null) : null });

  dev.get('/users', (_req, res) => { res.json({ users: users.list().map(userView), roles: ROLES.map(r => ({ id: r, can: ROLE_INFO[r] })), settings: users.settings() }); });
  dev.post('/users', (req, res) => {
    const email = str(req.body?.email, 200);
    if (!email) throw bad('email is required');
    let u;
    try { u = users.assign(email, req.body?.role, actor(req), { person_id: req.body?.person_id, note: str(req.body?.note, 300) ?? null, name: str(req.body?.name, 120) ?? null }); } catch (e) { throw bad((e as Error).message); }
    changeLog('user', u.id, 'assign', { email: u.email, role: u.role, person_id: u.person_id }, actor(req));
    res.status(201).json(userView(u));
  });
  /** Many emails at once: one per line, "email" or "email, role". */
  dev.post('/users/bulk', (req, res) => {
    const text = String(req.body?.text ?? '');
    const fallback = req.body?.role as Role;
    const done: string[] = [], failed: { line: string; error: string }[] = [];
    for (const line of text.split(/\r?\n|;/).map(l => l.trim()).filter(Boolean)) {
      const [email, role] = line.split(/[,\t ]+/);
      try { const u = users.assign(email, ((role || fallback) as Role), actor(req)); done.push(u.email); } catch (e) { failed.push({ line, error: (e as Error).message }); }
    }
    if (done.length) changeLog('user', 'bulk', 'assign', { count: done.length }, actor(req));
    res.json({ assigned: done.length, emails: done, failed });
  });
  /** Nobody removes or demotes their own account: their session would break mid-click. */
  const notSelf = (req: Request, u: UserRow, what: string) => { if (actor(req) === u.email) throw bad(`You cannot ${what} your own account. Ask another developer.`); };
  dev.put('/users/:id', (req, res) => {
    const u = users.byId(String(req.params.id));
    if (!u) throw new HttpError(404, 'User not found');
    if (req.body?.role && req.body.role !== 'dev') { if (u.role === 'dev') notSelf(req, u, 'demote'); keepADev(u); }
    let next;
    try { next = users.assign(u.email, req.body?.role ?? u.role, actor(req), { person_id: req.body?.person_id !== undefined ? req.body.person_id : u.person_id, note: req.body?.note !== undefined ? str(req.body.note, 300) ?? '' : null }); } catch (e) { throw bad((e as Error).message); }
    changeLog('user', u.id, 'update', { email: u.email, from: u.role, to: next.role }, actor(req));
    res.json(userView(next));
  });
  dev.delete('/users/:id', (req, res) => {
    const u = users.byId(String(req.params.id));
    if (!u) throw new HttpError(404, 'User not found');
    notSelf(req, u, 'remove');
    keepADev(u);
    users.remove(u.id);
    changeLog('user', u.id, 'delete', { email: u.email, role: u.role }, actor(req));
    res.json({ ok: true, removed: u.email });
  });
  /** Set or reset someone's password (they can change it later from the app). */
  dev.put('/users/:id/password', (req, res) => {
    const u = users.byId(String(req.params.id));
    if (!u) throw new HttpError(404, 'User not found');
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    try { users.setPassword(u.id, password); } catch (e) { throw signInFail(e); }
    changeLog('user', u.id, 'password', { email: u.email, by: 'dev dashboard' }, actor(req));
    res.json(userView(users.byId(u.id)!));
  });
  /** "What would this person get if they signed in now?" */
  dev.get('/check', (req, res) => {
    const email = str(req.query.email, 200);
    if (!email) throw bad('email is required');
    res.json(users.resolve(email));
  });
  dev.get('/settings', (_req, res) => { res.json(users.settings()); });
  dev.put('/settings', (req, res) => {
    const b = req.body ?? {};
    if (b.default_role !== undefined && !ROLES.includes(b.default_role)) throw bad('unknown role');
    if (b.default_role === 'admin' || b.default_role === 'dev') throw bad('the default role cannot be admin or dev');
    const s = users.saveSettings({ ...(Array.isArray(b.allowed_domains) ? { allowed_domains: strList(b.allowed_domains, 120) } : {}),
      ...(b.default_role ? { default_role: b.default_role } : {}), ...(typeof b.demo_accounts === 'boolean' ? { demo_accounts: b.demo_accounts } : {}) });
    changeLog('auth', 'settings', 'update', s, actor(req));
    res.json(s);
  });
  /** Link a faculty/staff account to their office card. */
  dev.get('/people', (req, res) => {
    const q = `%${(str(req.query.q, 80) ?? '').toLowerCase()}%`;
    res.json(db.prepare('SELECT id, name, email, role, department FROM people WHERE lower(name) LIKE ? OR lower(coalesce(email, \'\')) LIKE ? ORDER BY name LIMIT 20').all(q, q));
  });
  dev.get('/activity', (_req, res) => {
    res.json((db.prepare("SELECT * FROM change_log WHERE entity IN ('user', 'auth') ORDER BY created_at DESC LIMIT 100").all() as Record<string, string>[]).map(c => ({ ...c, detail: json.parse(c.detail, null) })));
  });
  app.use('/api/dev', dev);


  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use((error: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (error.type === 'entity.too.large' || (error as { code?: string }).code === 'LIMIT_FILE_SIZE') { res.status(413).json({ error: 'Request too large' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
