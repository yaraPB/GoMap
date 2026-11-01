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
    CREATE TABLE IF NOT EXISTS entrances (
      id TEXT PRIMARY KEY,
      place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'retired')),
      access_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (access_status IN ('unknown', 'approved', 'restricted')),
      verified_by TEXT,
      verified_at TEXT,
      access_checked_by TEXT,
      access_checked_at TEXT,
      CHECK ((latitude IS NULL) = (longitude IS NULL)),
      CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
      CHECK (verification_status != 'verified' OR
        (latitude IS NOT NULL AND verified_by IS NOT NULL AND trim(verified_by) != ''
          AND verified_at IS NOT NULL AND trim(verified_at) != '')),
      CHECK (access_status != 'approved' OR
        (access_checked_by IS NOT NULL AND trim(access_checked_by) != ''
          AND access_checked_at IS NOT NULL AND trim(access_checked_at) != ''))
    );
    CREATE INDEX IF NOT EXISTS entrances_place_id_idx ON entrances(place_id);
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
