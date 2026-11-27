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
  renameLegacy(db);
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

    -- Offices and student services (data/aui_departments_faculty.json → offices_and_services)
    CREATE TABLE IF NOT EXISTS services (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      short_name    TEXT,
      category      TEXT NOT NULL DEFAULT 'service',  -- academic | money | wellbeing | campus_life | it | admin
      handles       TEXT NOT NULL DEFAULT '[]',       -- JSON [string]: what students come for
      keywords      TEXT NOT NULL DEFAULT '[]',       -- JSON [string]: extra words the assistant matches
      place_ids     TEXT NOT NULL DEFAULT '[]',       -- JSON [Mongo places._id], first = main desk
      location_text TEXT,
      room          TEXT,
      email         TEXT,
      extension     TEXT,
      phone         TEXT,
      hours         TEXT,                             -- JSON hours, NULL = not published
      hours_raw     TEXT,
      notes         TEXT,
      sort          INTEGER NOT NULL DEFAULT 0,
      admin_edited  INTEGER NOT NULL DEFAULT 0,       -- 1 = re-import from the JSON leaves it alone
      verified_at   TEXT,
      source        TEXT,
      updated_at    TEXT NOT NULL
    );

    -- "I have problem X, where do I go?" (student_issue_routing)
    CREATE TABLE IF NOT EXISTS issue_routing (
      id            TEXT PRIMARY KEY,
      issue         TEXT NOT NULL,
      go_to         TEXT NOT NULL,
      service_id    TEXT REFERENCES services(id) ON DELETE SET NULL,
      location_text TEXT,
      place_id      TEXT,
      notes         TEXT,
      keywords      TEXT NOT NULL DEFAULT '[]',
      sort          INTEGER NOT NULL DEFAULT 0,
      admin_edited  INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL
    );

    -- Every presence change, so the admin sees time actually spent in the office.
    CREATE TABLE IF NOT EXISTS presence_log (
      id          TEXT PRIMARY KEY,
      person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      status      TEXT NOT NULL,       -- in | busy | out
      started_at  TEXT NOT NULL,
      ended_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS presence_log_person ON presence_log(person_id, started_at);

    -- Demo accounts for the role views (no passwords; GoCampus SSO later). Admin is separate.
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      role        TEXT NOT NULL,       -- student | faculty | staff | guest (visitor)
      person_id   TEXT,                -- people.id for faculty/staff
      description TEXT,
      sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
  addColumn(db, 'people', 'admin_edited', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'people', 'lunch', 'TEXT'); // JSON ["13:00","14:00"], NULL = campus default
  addColumn(db, 'office_notes', 'kind', 'TEXT'); // sick | online | appointment | email | back_soon | away_week | semester_off | … | custom
  addColumn(db, 'office_notes', 'expires_at', 'TEXT'); // "not here this week" ends by itself; NULL = until removed
  addColumn(db, 'procedures', 'channel', "TEXT NOT NULL DEFAULT 'in_person'"); // in_person | online (student portal) | mixed
  db.exec(`
    -- Campus events: talks, matches, fairs. Shown on the map, in the visitor card and by the assistant.
    CREATE TABLE IF NOT EXISTS events (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT,
      kind          TEXT NOT NULL DEFAULT 'talk',   -- talk | sport | club | culture | official | career | other
      place_id      TEXT,                           -- Mongo places._id: makes "take me there" work
      location_text TEXT,                           -- "Room 102", "the lawn behind Building 8"
      starts_at     TEXT NOT NULL,
      ends_at       TEXT NOT NULL,
      audience      TEXT NOT NULL DEFAULT 'all',    -- all | students | faculty | visitors
      organizer     TEXT,
      link          TEXT,
      sample        INTEGER NOT NULL DEFAULT 0,     -- 1 = demo event, labelled "Sample" in the app
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_time ON events(ends_at, starts_at);
    -- Answers the admin writes by hand. They win over everything else the assistant knows.
    CREATE TABLE IF NOT EXISTS assistant_rules (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      triggers     TEXT NOT NULL DEFAULT '[]',      -- JSON [string]: questions/phrases that should fire it
      answer       TEXT NOT NULL,                   -- English
      answer_fr    TEXT,
      answer_ar    TEXT,
      place_id     TEXT,                            -- optional: offer directions there
      service_id   TEXT,                            -- optional: show this office's card
      procedure_id TEXT,                            -- optional: show these steps
      urgent       INTEGER NOT NULL DEFAULT 0,      -- 1 = shown as an alert (emergencies)
      enabled      INTEGER NOT NULL DEFAULT 1,
      hits         INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL
    );
    -- Questions the assistant must keep answering right: run after every change in the admin.
    CREATE TABLE IF NOT EXISTS assistant_tests (
      id            TEXT PRIMARY KEY,
      question      TEXT NOT NULL,
      lang          TEXT NOT NULL DEFAULT 'en',
      expect_intent TEXT,                           -- place | person | procedure | service | info | rule | unknown
      expect_id     TEXT,                           -- the place / service / procedure / rule / person id
      expect_text   TEXT,                           -- words the answer must contain
      last_result   TEXT,                           -- JSON {pass, intent, id, text, answered_by, at, why}
      updated_at    TEXT NOT NULL
    );
  `);
  return db;
}

/**
 * The first prototype kept its own `services` table (title/destination_id) in the same file.
 * Keep its rows as `legacy_services` and make room for the offices table. legacy_alter_table
 * stops SQLite from re-pointing other tables' foreign keys at the renamed table.
 */
function renameLegacy(db: Sql) {
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name);
  const services = cols('services');
  if (services.length && !services.includes('short_name')) {
    db.exec('PRAGMA legacy_alter_table = ON; DROP TABLE IF EXISTS legacy_services; ALTER TABLE services RENAME TO legacy_services; PRAGMA legacy_alter_table = OFF;');
  }
  // issue_routing created while the old table still held the name points its key at it: rebuild
  // (its rows come from the JSON and are re-imported on the next seed)
  const fk = db.prepare('PRAGMA foreign_key_list(issue_routing)').all() as { table: string }[];
  if (fk.some(f => f.table !== 'services')) {
    db.exec("DROP TABLE issue_routing; DELETE FROM meta WHERE key = 'directory_hash';");
  }
}

/** Tiny migration helper for files created by an older schema. */
function addColumn(db: Sql, table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

export const meta = {
  get(db: Sql, key: string): string | null { return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null; },
  set(db: Sql, key: string, value: string) { db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); },
};

export const json = {
  parse<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  },
};
