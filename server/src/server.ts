import express, { type Request, type Response } from 'express';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db.js';
import { answerQuestion, AssistantUnavailable, type ChatTurn } from './assistant.js';

const placeFields = `id, name, category, description, latitude, longitude,
  verification_status AS verificationStatus, hours, entrance,
  verified_by AS verifiedBy, verified_at AS verifiedAt`;

export function createApp(db: DatabaseSync, options: { fetchImpl?: typeof fetch; apiKey?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: '12kb' }));

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/places', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const places = db.prepare(`SELECT ${placeFields} FROM places WHERE
      (? = '' OR category = ?) AND
      (? = '' OR instr(lower(name || ' ' || search_terms || ' ' || description), lower(?)) > 0)
      ORDER BY name`).all(category, category, query, query);
    res.json(places);
  });
  app.get('/api/places/:id', (req, res) => {
    const place = db.prepare(`SELECT ${placeFields} FROM places WHERE id = ?`).get(req.params.id);
    if (!place) { res.status(404).json({ error: 'Place not found' }); return; }
    res.json(place);
  });
  app.get('/api/services', (_req, res) => {
    res.json(db.prepare(`SELECT id, title, description, destination_id AS destinationId, note FROM services ORDER BY title`).all());
  });
  app.post('/api/reports', (req, res) => {
    const { placeId, issueType, details } = req.body || {};
    const allowed = ['Wrong pin', 'Office moved', 'Outdated hours', 'Blocked walkway', 'Other'];
    if (typeof placeId !== 'string' || !allowed.includes(issueType) || typeof details !== 'string' || !details.trim() || details.length > 2000) {
      res.status(400).json({ error: 'Valid place, issue type and details are required' }); return;
    }
    if (!db.prepare('SELECT 1 FROM places WHERE id = ?').get(placeId)) { res.status(404).json({ error: 'Place not found' }); return; }
    const result = db.prepare('INSERT INTO reports (place_id, issue_type, details) VALUES (?, ?, ?)').run(placeId, issueType, details.trim());
    res.status(201).json({ id: Number(result.lastInsertRowid), status: 'open' });
  });
  app.post('/api/assistant', async (req, res, next) => {
    const { message, history } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 500 ||
      (history !== undefined && (!Array.isArray(history) || history.length > 6 || history.some((turn: ChatTurn) => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string' || turn.text.length > 500)))) {
      res.status(400).json({ error: 'Ask a question of up to 500 characters.' }); return;
    }
    try {
      const answer = await answerQuestion(db, message.trim(), history || [], options.fetchImpl, options.apiKey);
      res.json(answer);
    } catch (error) { next(error); }
  });
  app.use((error: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof AssistantUnavailable) { res.status(503).json({ error: error.message }); return; }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (error.type === 'entity.too.large') { res.status(413).json({ error: 'Request too large' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const entry = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (entry === import.meta.url) {
  if (existsSync('.env')) loadEnvFile('.env');
  const db = openDatabase(process.env.GOMAP_DB || join(process.cwd(), 'data', 'gomap.sqlite'));
  const port = Number(process.env.PORT || 4000);
  createApp(db).listen(port, '0.0.0.0', () => console.log(`GoMap API on http://localhost:${port}`));
}
