import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DICT } from '../src/i18n/dict';
import { makeT } from '../src/i18n';
import { trStep } from '../src/i18n/steps';

/** Every literal passed to t() in the app. */
export function wrappedStrings(): string[] {
  const roots = [join(__dirname, '..', 'src'), join(__dirname, '..', 'app')];
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !p.includes(`${join('i18n', 'dict')}`)) files.push(p); } };
  roots.forEach(walk);
  const keys = new Set<string>();
  const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  // labels kept in tables and passed to t() through a variable: { name: 'Dining' }, title: 'Weekend'
  const tableRe = /\b(?:name|label|title|sub|short|blurb|line|body)\s*:\s*'([A-Z0-9{][^']*)'/g;
  const uiFile = (f: string) => /panels|faculty-status|[\\/]ar\.tsx|StickyNote|theme\.ts/.test(f);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (uiFile(f)) for (const m of src.matchAll(tableRe)) keys.add(m[1]);
    for (const m of src.matchAll(re)) {
      const raw = m[2];
      if (!raw) continue;
      keys.add(m[1] === '"' ? JSON.parse(`"${raw}"`) : raw.replace(/\\'/g, "'"));
    }
  }
  // strings that reach t() only at runtime: server status labels, department names, tuple tables
  for (const k of RUNTIME_KEYS) keys.add(k);
  return [...keys].sort();
}

export const RUNTIME_KEYS = [
  'Office hours now', 'Not in office hours', 'At lunch', 'In the office', 'Not in today', 'In a meeting', 'Teaching', 'Elsewhere on campus',
  'Off campus', 'At a conference', 'On leave', 'Rather not say', 'Busy', 'Away', 'Sick',
  'School of Business Administration', 'School of Science and Engineering', 'School of Social Sciences, Arts and Humanities', 'Language Center',
  '{n} academic places', '{n} residences', '{n} dining places', '{n} sports facilities', '{n} administrative offices', '{n} campus services', '{n} facilities and car parks', '{n} places',
  'Just today', 'A few days', 'Not sure', 'Business', 'Humanities', 'Main entrance', 'Entrance', 'Take the stairs', 'Cross the road', 'Take the ramp', 'Rerouting', '{first}. Then {next}',
];

test('every wrapped UI string has a French and an Arabic translation', () => {
  const missing = { fr: [] as string[], ar: [] as string[] };
  for (const k of wrappedStrings()) for (const l of ['fr', 'ar'] as const) if (!DICT[l][k]) missing[l].push(k);
  assert.deepEqual(missing.fr, [], `French missing for ${missing.fr.length} strings`);
  assert.deepEqual(missing.ar, [], `Arabic missing for ${missing.ar.length} strings`);
});

test('translations keep their {placeholders}', () => {
  for (const l of ['fr', 'ar'] as const) {
    for (const [en, tr] of Object.entries(DICT[l])) {
      const need = (en.match(/\{\w+\}/g) ?? []).sort();
      const have = (tr.match(/\{\w+\}/g) ?? []).sort();
      assert.deepEqual(have, need, `${l}: "${en}" → "${tr}"`);
    }
  }
});

test('route instructions are rebuilt in French and Arabic', () => {
  const fr = makeT('fr'), ar = makeT('ar');
  assert.equal(trStep('Turn left and cross the road', fr), DICT.fr['{action}, then {next}'].replace('{action}', DICT.fr['Turn {side}'].replace('{side}', DICT.fr.left)).replace('{next}', DICT.fr['Cross the road'].toLowerCase()));
  assert.notEqual(trStep('Keep right onto Main', ar), 'Keep right onto Main');
  assert.equal(makeT('fr')('{n} min', { n: 4 }), DICT.fr['{n} min'].replace('{n}', '4'));
});
