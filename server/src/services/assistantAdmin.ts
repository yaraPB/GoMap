/**
 * The admin's side of the assistant: hand-written rules and a test suite of real questions.
 * Rules are the admin's own answers ("what do I do if…"); tests check that every question still
 * lands on the right place/office/procedure after any edit. Run them from Admin → Assistant.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from '../db/sqlite.js';
import { json, meta } from '../db/sqlite.js';
import type { Answer, Assistant } from '../assistant/assistant.js';

export type RuleRow = { id: string; title: string; triggers: string; answer: string; answer_fr: string | null; answer_ar: string | null; place_id: string | null;
  service_id: string | null; procedure_id: string | null; urgent: number; enabled: number; hits: number; updated_at: string };
export type TestRow = { id: string; question: string; lang: string; expect_intent: string | null; expect_id: string | null; expect_text: string | null; last_result: string | null; updated_at: string };

export const ruleView = (r: RuleRow) => ({ ...r, triggers: json.parse<string[]>(r.triggers, []), urgent: !!r.urgent, enabled: !!r.enabled });
export const testView = (t: TestRow) => ({ ...t, last_result: json.parse(t.last_result, null) });

/** Questions students really ask, each with the answer it must land on. */
const STARTER_TESTS: [string, string, string | null, string | null, string | null][] = [
  // question, lang, intent, id, text
  ['Where is the library?', 'en', 'place', 'building-15', null],
  ['Take me to building 14', 'en', 'place', 'building-14', null],
  ['Take me to building 8B', 'en', 'place', 'building-8b', null],
  ['Where is the cafeteria?', 'en', 'place', 'cafeteria-newrest', null],
  ['Where can I pray?', 'en', 'place', 'masjid-al-akhawayn', null],
  ['Where can I park my car?', 'en', 'place', null, null],
  ['When does the library close?', 'en', 'place', 'building-15', null],
  ['Where do I pay my tuition fees?', 'en', 'service', null, null],
  ['I lost my student card', 'en', 'service', null, null],
  ['I feel sick', 'en', 'service', null, null],
  ['How do I declare a minor?', 'en', 'procedure', 'declare-minor', null],
  ['Where is Harit Satt\'s office?', 'en', 'person', 'harit-satt', null],
  ['Emergency, there is a fire', 'en', null, null, '2222'],
  ['What is happening on campus this week?', 'en', 'events', null, null],
  ['How do I use this app?', 'en', 'help', null, null],
  ['Où est la bibliothèque ?', 'fr', 'place', 'building-15', null],
  ['وين المكتبة', 'ar', 'place', 'building-15', null],
  ['Who won the World Cup in 2010?', 'en', 'unknown', null, null],
];

export function seedAssistantAdmin(db: Sql, now = new Date().toISOString()) {
  if (!meta.get(db, 'assistant_tests_seeded')) {
    const ins = db.prepare('INSERT OR IGNORE INTO assistant_tests (id, question, lang, expect_intent, expect_id, expect_text, updated_at) VALUES (?,?,?,?,?,?,?)');
    STARTER_TESTS.forEach(([q, lang, intent, id, text], i) => ins.run(`starter-${String(i + 1).padStart(2, '0')}`, q, lang, intent, id, text, now));
    meta.set(db, 'assistant_tests_seeded', now);
  }
  if (!meta.get(db, 'assistant_rules_seeded')) {
    // One example built only from facts already in the data (Security's 24/7 line), so the admin
    // sees what a rule looks like. Everything else is theirs to write.
    db.prepare(`INSERT OR IGNORE INTO assistant_rules (id, title, triggers, answer, answer_fr, answer_ar, service_id, urgent, enabled, updated_at) VALUES (?,?,?,?,?,?,?,1,1,?)`).run(
      'emergency', 'Emergency on campus',
      JSON.stringify(['emergency', 'there is a fire', 'someone is hurt', 'accident', 'i am in danger', 'urgence', 'au secours', 'طوارئ', 'حريق']),
      'Call Security now: ext. 2222, or 0535-86-2222 from a mobile. They answer 24/7 and come to you.',
      'Appelez la Sécurité maintenant : poste 2222, ou 0535-86-2222 depuis un portable. Ils répondent 24h/24 et se déplacent.',
      'اتصل بالأمن الآن: الرقم الداخلي 2222، أو 0535-86-2222 من الهاتف. يردّون على مدار الساعة ويأتون إليك.',
      'security', now);
    meta.set(db, 'assistant_rules_seeded', now);
  }
}

/** What the answer landed on, as the test compares it. */
function landedOn(a: Answer): { intent: string; id: string | null } {
  if (a.rule) return { intent: 'rule', id: a.rule.id };
  const id = a.intent === 'place' ? a.place?.id : a.intent === 'person' ? a.person?.id : a.intent === 'procedure' ? a.procedure?.id : a.intent === 'service' ? a.service?.id ?? a.issue?.id : null;
  return { intent: a.intent, id: id ?? null };
}

export function judge(t: Pick<TestRow, 'expect_intent' | 'expect_id' | 'expect_text'>, a: Answer) {
  const got = landedOn(a);
  const why: string[] = [];
  // a rule is allowed to stand in for any intent: the admin chose that answer on purpose
  if (t.expect_intent && t.expect_intent !== got.intent && !(got.intent === 'rule' && t.expect_intent !== 'unknown')) why.push(`expected ${t.expect_intent}, got ${got.intent}`);
  if (t.expect_id && t.expect_id !== got.id && !(a.place?.id === t.expect_id)) why.push(`expected ${t.expect_id}, got ${got.id ?? 'nothing'}`);
  const blob = `${a.text} ${a.alert?.text ?? ''}`.toLowerCase();
  if (t.expect_text && !blob.includes(t.expect_text.toLowerCase())) why.push(`answer lacks "${t.expect_text}"`);
  return { pass: !why.length, why, ...got };
}

export async function runTest(db: Sql, assistant: Assistant, t: TestRow, localOnly = false) {
  const a = await assistant.ask({ text: t.question, lang: (['en', 'fr', 'ar'].includes(t.lang) ? t.lang : 'en') as 'en', from: null, trace: true, noLog: true, localOnly });
  const verdict = judge(t, a);
  const result = { ...verdict, text: a.text, answered_by: a.answered_by, trace: a.trace ?? null, at: new Date().toISOString() };
  db.prepare('UPDATE assistant_tests SET last_result = ? WHERE id = ?').run(JSON.stringify(result), t.id);
  return result;
}

export const newId = (prefix: string, text: string) => `${prefix}-${text.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'item'}-${randomUUID().slice(0, 4)}`;
