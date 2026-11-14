import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../src/db/sqlite.js';
import { seedSqlite } from '../src/seed/seed.js';

test('a database from the first prototype (old services table) upgrades and seeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gomap-'));
  const file = join(dir, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE places (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE services (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, destination_id TEXT NOT NULL REFERENCES places(id), note TEXT NOT NULL);
    INSERT INTO places VALUES ('lib', 'Library'); INSERT INTO services VALUES ('s1', 'Old', 'kept', 'lib', '');`);
  old.close();
  const db = openSqlite(file);
  seedSqlite(db, new Date().toISOString());
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n >= 25);
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM issue_routing').get() as { n: number }).n >= 30);
  assert.equal((db.prepare('SELECT title FROM legacy_services').get() as { title: string }).title, 'Old', 'old rows are kept');
  assert.equal((db.prepare('PRAGMA foreign_key_list(issue_routing)').all() as { table: string }[])[0].table, 'services');
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
