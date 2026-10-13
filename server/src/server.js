import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { openDatabase } from './db.js';

const defaultFile = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'gomap.sqlite');

export function createApp(db) {
  const placeFields = `id, name, category, description, latitude, longitude,
    verification_status AS verificationStatus, hours, entrance,
    verified_by AS verifiedBy, verified_at AS verifiedAt`;
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type' });
    res.end(JSON.stringify(body));
  };
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, null);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/places') {
        const query = (url.searchParams.get('q') || '').trim();
        const category = (url.searchParams.get('category') || '').trim();
        const places = db.prepare(`SELECT ${placeFields} FROM places WHERE
          (? = '' OR category = ?) AND
          (? = '' OR instr(lower(name || ' ' || search_terms || ' ' || description), lower(?)) > 0)
          ORDER BY name`).all(category, category, query, query);
        return send(res, 200, places);
      }
      if (req.method === 'GET' && /^\/api\/places\/[a-z0-9-]+$/.test(url.pathname)) {
        const id = url.pathname.split('/').at(-1);
        const place = db.prepare(`SELECT ${placeFields} FROM places WHERE id = ?`).get(id);
        return send(res, place ? 200 : 404, place || { error: 'Place not found' });
      }
      if (req.method === 'GET' && url.pathname === '/api/services') {
        const services = db.prepare(`SELECT s.id, s.title, s.description,
          s.destination_id AS destinationId, s.note FROM services s ORDER BY s.title`).all();
        return send(res, 200, services);
      }
      if (req.method === 'POST' && url.pathname === '/api/reports') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 10000) return send(res, 413, { error: 'Report too large' });
        }
        let body;
        try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
        const { placeId, issueType, details } = body || {};
        const allowed = ['Wrong pin', 'Office moved', 'Outdated hours', 'Blocked walkway', 'Other'];
        if (typeof placeId !== 'string' || !allowed.includes(issueType) ||
            typeof details !== 'string' || !details.trim() || details.length > 2000)
          return send(res, 400, { error: 'Valid place, issue type and details are required' });
        if (!db.prepare('SELECT 1 FROM places WHERE id = ?').get(placeId))
          return send(res, 404, { error: 'Place not found' });
        const result = db.prepare(`INSERT INTO reports (place_id, issue_type, details)
          VALUES (?, ?, ?)`).run(placeId, issueType, details.trim());
        return send(res, 201, { id: Number(result.lastInsertRowid), status: 'open' });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error(error);
      return send(res, 500, { error: 'Internal server error' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase(process.env.GOMAP_DB || defaultFile);
  const port = Number(process.env.PORT || 4000);
  createApp(db).listen(port, '0.0.0.0', () => console.log(`GoMap API on http://localhost:${port}`));
}
