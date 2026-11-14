/**
 * SQLite holds everything that is not map data: people and their office hours, today's
 * presence, procedures, the crowding table, and the assistant's cache and log.
 *
 * Postgres-safe on purpose: declared types everywhere, ISO-8601 UTC strings for time,
 * JSON in TEXT columns, no AUTOINCREMENT. place_id values point at Mongo `places._id`
 * and are checked in code (different stores, so no foreign key).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Sql = DatabaseSync;

export function openSqlite(file: string): Sql {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS people (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      title         TEXT,
      department    TEXT,              -- 'SBA', 'SSE', 'SSAH', 'LC'
      email         TEXT,
      phone         TEXT,
      profile_url   TEXT,
      role          TEXT NOT NULL DEFAULT 'faculty',
      place_id      TEXT,              -- Mongo places._id
      office_number TEXT,
      floor         INTEGER,
      office_hours  TEXT,              -- JSON hours, NULL = not published
      hours_raw     TEXT,              -- as posted on aui.ma
      conflict      TEXT,              -- JSON {field, values:[{value, source}]} when sources disagree
      verified_at   TEXT,
      source        TEXT NOT NULL DEFAULT 'aui.ma',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS people_place ON people(place_id);

    CREATE TABLE IF NOT EXISTS presence (
      person_id  TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
      status     TEXT NOT NULL,        -- in | busy | out
      reason     TEXT,                 -- meeting | teaching | campus | away | none
      until      TEXT,                 -- ISO timestamp, NULL = rest of today
      set_by     TEXT NOT NULL,
      set_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS office_notes (
      person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS procedures (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      summary        TEXT NOT NULL,
      owner_office   TEXT NOT NULL,
      place_id       TEXT,             -- makes "guide me there" work
      contact_email  TEXT,
      steps          TEXT NOT NULL,    -- JSON [{title, body}]
      match_phrases  TEXT NOT NULL,    -- JSON [string]
      source         TEXT,
      status         TEXT NOT NULL DEFAULT 'draft',  -- draft | review | live
      verified_at    TEXT,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crowding (
      edge_id  TEXT NOT NULL,          -- walkway id (Mongo)
      weekday  INTEGER NOT NULL,       -- 0-6, Monday = 0
      hour     INTEGER NOT NULL,       -- 8-20
      load     REAL NOT NULL,          -- 0.0-1.0
      PRIMARY KEY (edge_id, weekday, hour)
    );

    CREATE TABLE IF NOT EXISTS assistant_cache (
      key         TEXT PRIMARY KEY,    -- normalised question + lang
      answer      TEXT NOT NULL,       -- JSON
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_log (
      id          TEXT PRIMARY KEY,
      question    TEXT NOT NULL,
      lang        TEXT NOT NULL,
      intent      TEXT NOT NULL,       -- place | person | procedure | help | unknown | error
      answered_by TEXT NOT NULL,       -- local | gemini | cache | none
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_log (
      id          TEXT PRIMARY KEY,
      entity      TEXT NOT NULL,       -- place | person | procedure | report
      entity_id   TEXT NOT NULL,
      action      TEXT NOT NULL,
      detail      TEXT,
      actor       TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
  return db;
}

export const json = {
  parse<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  },
};
