/**
 * Who someone is in GoMap after they sign in with Outlook, and what they may do.
 *
 * Role on sign-in, first match wins:
 *   1. an assignment made in the dev dashboard (email → role)
 *   2. DEV_EMAILS in server/.env → dev (so the first developer can get in and assign everyone else)
 *   3. the faculty directory knows the email → faculty / staff, linked to their person record
 *   4. the email's domain is allowed (default aui.ma) → the default role (student)
 *   5. otherwise: refused, with a message saying who to ask
 * The role is read from here on every request, so changes apply immediately.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/sqlite.js';
import { meta } from '../db/sqlite.js';

export const ROLES = ['student', 'faculty', 'staff', 'admin', 'dev'] as const;
export type Role = typeof ROLES[number];
export const ROLE_INFO: Record<Role, string> = {
  student: 'Map, assistant, events, reports',
  faculty: 'Everything students have, plus their own office status and door note',
  staff: 'Like faculty, for office staff',
  admin: 'The admin dashboard: places, offices, events, rules, reports',
  dev: 'Everything, plus this dev dashboard (who gets which role)',
};

export type UserRow = { id: string; email: string; name: string | null; role: Role; person_id: string | null; source: string; assigned_by: string | null;
  note: string | null; microsoft_oid: string | null; logins: number; created_at: string; updated_at: string; last_login_at: string | null };
export type AuthSettings = { allowed_domains: string[]; default_role: Role; demo_accounts: boolean };

export function migrateUsers(db: Sql) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,      -- lower case
      name          TEXT,
      role          TEXT NOT NULL,             -- student | faculty | staff | admin | dev
      person_id     TEXT,                      -- people.id for faculty/staff (their office card)
      source        TEXT NOT NULL,             -- dev (assigned) | directory | domain | bootstrap
      assigned_by   TEXT,
      note          TEXT,
      microsoft_oid TEXT,
      logins        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      last_login_at TEXT
    );
  `);
}

const now = () => new Date().toISOString();
const clean = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export class Users {
  constructor(private db: Sql, private devEmails: () => string[] = () => []) {}

  settings(): AuthSettings {
    const raw = meta.get(this.db, 'auth_settings');
    const s = raw ? JSON.parse(raw) as Partial<AuthSettings> : {};
    return { allowed_domains: s.allowed_domains ?? ['aui.ma'], default_role: (ROLES as readonly string[]).includes(s.default_role ?? '') ? s.default_role! : 'student', demo_accounts: s.demo_accounts ?? true };
  }
  saveSettings(p: Partial<AuthSettings>) {
    const next = { ...this.settings(), ...p };
    next.allowed_domains = [...new Set(next.allowed_domains.map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
    meta.set(this.db, 'auth_settings', JSON.stringify(next));
    return next;
  }

  byId(id: string) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; }
  byEmail(email: string) { return this.db.prepare('SELECT * FROM users WHERE email = ?').get(clean(email)) as UserRow | undefined; }
  list() { return this.db.prepare('SELECT * FROM users ORDER BY CASE role WHEN \'dev\' THEN 0 WHEN \'admin\' THEN 1 WHEN \'faculty\' THEN 2 WHEN \'staff\' THEN 3 ELSE 4 END, email').all() as UserRow[]; }

  private directoryPerson(email: string) {
    return this.db.prepare('SELECT id, name, role FROM people WHERE lower(email) = ?').get(clean(email)) as { id: string; name: string; role: string } | undefined;
  }

  /** Assign (or change) a role from the dev dashboard. */
  assign(email: string, role: Role, by: string, extra: { person_id?: string | null; note?: string | null; name?: string | null } = {}) {
    const e = clean(email);
    if (!validEmail(e)) throw new Error(`"${email}" is not an email address`);
    if (!ROLES.includes(role)) throw new Error(`role must be one of ${ROLES.join(', ')}`);
    const person = extra.person_id !== undefined ? extra.person_id : this.directoryPerson(e)?.id ?? null;
    if (person && !this.db.prepare('SELECT 1 FROM people WHERE id = ?').get(person)) throw new Error(`unknown person ${person}`);
    const existing = this.byEmail(e);
    const t = now();
    if (existing) {
      this.db.prepare('UPDATE users SET role = ?, person_id = ?, note = COALESCE(?, note), name = COALESCE(?, name), source = \'dev\', assigned_by = ?, updated_at = ? WHERE id = ?')
        .run(role, person, extra.note ?? null, extra.name ?? null, by, t, existing.id);
      return this.byId(existing.id)!;
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id,email,name,role,person_id,source,assigned_by,note,created_at,updated_at) VALUES (?,?,?,?,?,\'dev\',?,?,?,?)')
      .run(id, e, extra.name ?? this.directoryPerson(e)?.name ?? null, role, person, by, extra.note ?? null, t, t);
    return this.byId(id)!;
  }

  remove(id: string) { return this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0; }

  /** What role this person would get if they signed in now, and why. */
  resolve(email: string): { role: Role; source: string; person_id: string | null; name: string | null } | { refused: string } {
    const e = clean(email);
    const row = this.byEmail(e);
    if (row) return { role: row.role, source: row.source, person_id: row.person_id, name: row.name };
    if (this.devEmails().map(clean).includes(e)) return { role: 'dev', source: 'bootstrap', person_id: this.directoryPerson(e)?.id ?? null, name: null };
    const p = this.directoryPerson(e);
    if (p && (p.role === 'faculty' || p.role === 'staff')) return { role: p.role as Role, source: 'directory', person_id: p.id, name: p.name };
    const s = this.settings();
    const domain = e.split('@')[1];
    if (s.allowed_domains.includes(domain)) return { role: s.default_role, source: 'domain', person_id: null, name: null };
    return { refused: `${e} is not allowed to sign in to GoMap yet. Ask the GoMap team (dev dashboard) to add your email.` };
  }

  /** Called after Microsoft confirmed the identity. Creates the user on first sign-in. */
  signIn(identity: { email: string; name: string; oid: string }) {
    const r = this.resolve(identity.email);
    if ('refused' in r) throw new Error(r.refused);
    const e = clean(identity.email);
    const t = now();
    const existing = this.byEmail(e);
    if (existing) {
      this.db.prepare('UPDATE users SET name = COALESCE(name, ?), microsoft_oid = ?, logins = logins + 1, last_login_at = ?, person_id = COALESCE(person_id, ?) WHERE id = ?')
        .run(identity.name, identity.oid, t, r.person_id, existing.id);
      return this.byId(existing.id)!;
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO users (id,email,name,role,person_id,source,microsoft_oid,logins,created_at,updated_at,last_login_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)')
      .run(id, e, r.name ?? identity.name, r.role, r.person_id, r.source, identity.oid, t, t, t);
    return this.byId(id)!;
  }
}

/** What the apps get back about the signed-in person. */
export const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name ?? u.email.split('@')[0], role: u.role, person_id: u.person_id });
