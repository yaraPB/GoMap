import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedPlaces, seedServices } from './seed.js';

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL, search_terms TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'sample',
      hours TEXT, entrance TEXT, verified_by TEXT, verified_at TEXT
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      destination_id TEXT NOT NULL REFERENCES places(id), note TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT NOT NULL REFERENCES places(id),
      issue_type TEXT NOT NULL, details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'open'
    );
  `);
  const insertPlace = db.prepare(`INSERT OR IGNORE INTO places
    (id,name,category,description,search_terms,latitude,longitude)
    VALUES (?,?,?,?,?,?,?)`);
  const insertService = db.prepare(`INSERT OR IGNORE INTO services
    (id,title,description,destination_id,note) VALUES (?,?,?,?,?)`);
  db.exec('BEGIN');
  try {
    for (const place of seedPlaces) insertPlace.run(...place);
    for (const service of seedServices) insertService.run(...service);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}
