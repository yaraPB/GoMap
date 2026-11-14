import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Position } from 'geojson';
import { Assistant } from './assistant/assistant.js';
import type { Lang } from './assistant/router.js';
import { config, SERVER_DIR } from './config.js';
import { CATEGORIES, Entrance, Place, Report, SCHOOLS } from './db/mongo.js';
import { json, type Sql } from './db/sqlite.js';
import { formatHours, openState, parseHours, type Hours } from './lib/hours.js';
import type { RouteMode } from './routing/route.js';
import type { Campus } from './services/campus.js';
import { DEPARTMENTS, Directory, isStale, type PersonRow } from './services/directory.js';

export type AppContext = { db: Sql; campus: Campus; assistant: Assistant; uploadsDir?: string };

/** Mock accounts until GoCampus SSO. TODO: replace with GoCampus SSO */
export const MOCK_USERS = [
  { id: 'demo-student', name: 'Demo Student', role: 'student' },
  { id: 'harit-satt', name: 'Harit Satt', role: 'faculty' },
  { id: 'demo-admin', name: 'Campus Admin', role: 'admin' },
  { id: 'guest', name: 'Visitor', role: 'guest' },
] as const;

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

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(ctx: AppContext) {
  const { db, campus, assistant } = ctx;
  const directory = new Directory(db);
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

  const userOf = (req: Request) => MOCK_USERS.find(u => u.id === req.header('x-gomap-user')) ?? MOCK_USERS[0];
  const changeLog = (entity: string, id: string, action: string, detail: unknown, actor: string) =>
    db.prepare('INSERT INTO change_log (id, entity, entity_id, action, detail, actor, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), entity, id, action, detail == null ? null : JSON.stringify(detail), actor, now());
  const placeNames = async () => new Map((await Place.find({}, { name: 1 }).lean()).map(p => [String(p._id), p.name]));

  // ── public ────────────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/mock-users', (_req, res) => { res.json(MOCK_USERS); });

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
    if (!(user.role === 'admin' || (user.role === 'faculty' && user.id === id))) throw new HttpError(403, 'Only this faculty member can set their status.');
    if (!directory.row(id)) throw new HttpError(404, 'Person not found');
    const status = req.body?.status;
    if (!['in', 'busy', 'out', 'clear'].includes(status)) throw bad('status must be in, busy, out or clear');
    const reason = req.body?.reason ?? null;
    if (reason !== null && !['meeting', 'teaching', 'campus', 'away', 'none'].includes(reason)) throw bad('unknown reason');
    const until = req.body?.until ?? null;
    if (until !== null && (typeof until !== 'string' || Number.isNaN(Date.parse(until)))) throw bad('until must be an ISO timestamp or null');
    directory.setPresence(id, { status, reason, until }, user.name);
    res.json(directory.view(directory.row(id)!, await placeNames()));
  }));

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

  app.post('/api/assistant/transcribe', upload.single('audio'), wrap(async (req, res) => {
    if (!req.file) throw bad('audio file is required');
    const lang = (LANGS.includes(req.body?.lang) ? req.body.lang : 'en') as Lang;
    const mime = req.file.mimetype && req.file.mimetype !== 'application/octet-stream' ? req.file.mimetype : 'audio/mp4';
    res.json({ text: await assistant.transcribe(req.file.buffer, mime, lang) });
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
    if (req.header('authorization') !== `Bearer ${config.adminToken}`) { next(new HttpError(401, 'Admin token required')); return; }
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
      counts: { places: places.length, people: people.length, procedures: procs.length, open_reports: reportsNew[0]?.n ?? 0, conflicts: conflicts.length, unanswered: unanswered.length },
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
    if (b.verify === true) changes.verified_at = now();
    if (b.review_months !== undefined) changes.review_months = Math.max(1, Math.min(36, num(b.review_months) ?? 6));
    changes.updated_at = now();
    await Place.updateOne({ _id: id }, { $set: changes });
    changeLog('place', id, 'update', changes, 'admin');
    await assistant.refresh();
    if (changes.location) await campus.rebuild();
    res.json(await Place.findById(id).lean());
  }));

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
    if (b.resolve_conflict === true) fields.conflict = null;
    if (b.verify === true) fields.verified_at = now();
    fields.updated_at = now();
    const keys = Object.keys(fields);
    db.prepare(`UPDATE people SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k] as string | number | null), id);
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
    const row = {
      title: str(b.title) ?? existing?.title, summary: str(b.summary, 1000) ?? existing?.summary, owner_office: str(b.owner_office) ?? existing?.owner_office,
      place_id: b.place_id !== undefined ? (b.place_id as string | null) : existing?.place_id ?? null,
      contact_email: b.contact_email !== undefined ? (str(b.contact_email) ?? null) : existing?.contact_email ?? null,
      source: b.source !== undefined ? (str(b.source, 300) ?? null) : existing?.source ?? null,
      verified_at: b.verify === true || (status === 'live' && existing?.status !== 'live') ? now() : existing?.verified_at ?? null,
    };
    if (!row.title || !row.summary || !row.owner_office) throw bad('title, summary and owner_office are required');
    db.prepare(`INSERT INTO procedures (id,title,summary,owner_office,place_id,contact_email,steps,match_phrases,source,status,verified_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, owner_office=excluded.owner_office, place_id=excluded.place_id,
      contact_email=excluded.contact_email, steps=excluded.steps, match_phrases=excluded.match_phrases, source=excluded.source, status=excluded.status,
      verified_at=excluded.verified_at, updated_at=excluded.updated_at`)
      .run(id, row.title, row.summary, row.owner_office, row.place_id, row.contact_email, JSON.stringify(steps), JSON.stringify(phrases), row.source, status, row.verified_at, now());
    changeLog('procedure', id, existing ? 'update' : 'create', { ...row, status }, 'admin');
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

  admin.get('/assistant-log', (_req, res) => {
    res.json(db.prepare('SELECT * FROM assistant_log ORDER BY created_at DESC LIMIT 200').all());
  });
  admin.get('/changes', (_req, res) => {
    res.json((db.prepare('SELECT * FROM change_log ORDER BY created_at DESC LIMIT 200').all() as Record<string, string>[]).map(c => ({ ...c, detail: json.parse(c.detail, null) })));
  });
  admin.get('/graph', (_req, res) => { res.type('text/plain').send(campus.report()); });

  app.use('/api/admin', admin);

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
