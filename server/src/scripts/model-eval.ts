/**
 * npm run assistant:eval -- [--model-only] [--pace=6000] [model …]
 *
 * Asks indirect questions (the kind the local router cannot answer, so the AI model has to pick the
 * record) through the real assistant pipeline, once per model, and scores where each answer lands.
 * Uses an in-memory database and your server/.env keys. Costs a fraction of a cent per model.
 *
 * Correct = the answer's office / place / procedure is one of the acceptable records, or the model
 * correctly says it does not know. Run it whenever you change model or rules.
 */
import { loadEnv } from '../config.js';
import { boot } from '../boot.js';
import type { Answer } from '../assistant/assistant.js';

type Case = { q: string; lang: 'en' | 'fr' | 'ar'; ok: string[] };
/** `ok`: acceptable record ids (office, place, procedure, person), or 'unknown'. */
const CASES: Case[] = [
  { q: "I can't get into my university email anymore", lang: 'en', ok: ['its', 'it-account'] },
  { q: "I've been feeling really anxious and can't sleep before exams", lang: 'en', ok: ['counseling', 'health-center'] },
  { q: 'I would love to spend next semester studying in Spain', lang: 'en', ok: ['oip'] },
  { q: 'can someone look at my CV before I apply for jobs', lang: 'en', ok: ['pathways'] },
  { q: 'somebody took my laptop from the lounge', lang: 'en', ok: ['security'] },
  { q: 'how much money do I still owe the university', lang: 'en', ok: ['business-office'] },
  { q: 'is there a doctor I can see today', lang: 'en', ok: ['health-center'] },
  { q: 'my essay needs proofreading, who can help', lang: 'en', ok: ['writing-center', 'cle'] },
  { q: 'I want to start a new student club', lang: 'en', ok: ['sao', 'dsa'] },
  { q: 'my roommate and I keep fighting, can I move rooms', lang: 'en', ok: ['housing', 'dsa'] },
  { q: "j'ai perdu mes clés quelque part sur le campus", lang: 'fr', ok: ['security'] },
  { q: 'je voudrais changer de spécialité', lang: 'fr', ok: ['registrar', 'academic-advising', 'declare-minor'] },
  { q: 'بغيت نخلص الرسوم ديال السمستر', lang: 'ar', ok: ['business-office'] },
  { q: 'فين نقدر نشوف طبيب', lang: 'ar', ok: ['health-center', 'building-26-health-center'] },
  { q: "what's the weather like in Paris today", lang: 'en', ok: ['unknown'] },
  { q: 'write me a poem about the ocean', lang: 'en', ok: ['unknown'] },
];

const landed = (a: Answer) => {
  const ids = [a.rule?.id, a.service?.id, a.issue?.id, a.procedure?.id, a.person?.id, a.place?.id].filter(Boolean) as string[];
  return a.intent === 'unknown' ? ['unknown'] : ids;
};

loadEnv();
const args = process.argv.slice(2);
/** --model-only: skip the local router, so every question measures the model's own tool choice */
const modelOnly = args.includes('--model-only');
/** --pace=ms between questions: free-tier keys allow only a few requests a minute */
const pace = Number(args.find(a => a.startsWith('--pace='))?.slice(7) ?? 6000);
const models = args.filter(a => !a.startsWith('--')).length ? args.filter(a => !a.startsWith('--')) : [process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'];
const provider = (process.env.ASSISTANT_PROVIDER === 'claude' ? 'claude' : 'gemini') as 'claude' | 'gemini';
const rows: string[] = [];
for (const model of models) {
  if (provider === 'claude') process.env.CLAUDE_MODEL = model; else process.env.GEMINI_MODEL = model;
  const ctx = await boot({ mongoUri: '', sqliteFile: ':memory:', quiet: true, provider });
  let correct = 0, viaModel = 0, ms = 0, errors = 0;
  const misses: string[] = [];
  for (const c of CASES) {
    const t = Date.now();
    const a = await ctx.assistant.ask({ text: c.q, lang: c.lang, from: null, noLog: true, skipLocal: modelOnly });
    const took = Date.now() - t;
    await new Promise(r => setTimeout(r, pace));
    if (a.answered_by === 'none' && /unavailable|failed|busy|rate limit|not configured/i.test(a.text)) errors++;
    if (a.answered_by === provider) { viaModel++; ms += took; }
    const got = landed(a);
    if (got.some(id => c.ok.includes(id))) correct++; else misses.push(`    ✗ "${c.q}" → ${got.join(', ') || a.intent} (${a.answered_by})`);
  }
  await ctx.close();
  rows.push(`${model.padEnd(28)} ${String(correct).padStart(2)}/${CASES.length} correct · ${viaModel} via model · ${viaModel ? Math.round(ms / viaModel) : 0} ms avg${errors ? ` · ${errors} errors` : ''}`);
  console.log(rows.at(-1));
  for (const m of misses) console.log(m);
}
console.log('\n' + rows.join('\n'));
