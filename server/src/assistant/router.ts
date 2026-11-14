/**
 * Local intent router. Most questions name a place, a person or a known procedure; those are
 * answered here instantly, for free, with no model call. Only misses go to Gemini.
 */
import Fuse from 'fuse.js';

export type Lang = 'en' | 'fr' | 'ar';
export type Intent = 'place' | 'person' | 'procedure' | 'help';
export type Match = { intent: Intent; id: string; score: number; mode: 'walk' | 'step_free' | 'ar' | null };

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', sept: '7', huit: '8', neuf: '9', dix: '10', onze: '11', douze: '12', treize: '13', quatorze: '14', quinze: '15', seize: '16', 'dix-sept': '17', vingt: '20',
  'واحد': '1', 'اثنين': '2', 'ثلاثة': '3', 'أربعة': '4', 'خمسة': '5', 'ستة': '6', 'سبعة': '7', 'ثمانية': '8', 'تسعة': '9', 'عشرة': '10',
};
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalise(text: string) {
  let t = text.toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا');
  t = t.replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)));
  t = t.replace(/[?!.,;:"“”'’()]/g, ' ');
  t = t.split(/\s+/).map(w => NUMBER_WORDS[w] ?? w).join(' ');
  t = t.replace(/\b(\d+)\s+b\b/g, '$1b').replace(/\bbatiment\b|\bbat\b|\bbldg\b|\bmabna\b|مبنى|بناية/g, 'building');
  return t.replace(/\s+/g, ' ').trim();
}

const FILLER = new Set(['take', 'me', 'to', 'the', 'a', 'an', 'where', 'is', 'are', 'how', 'do', 'i', 'get', 'go', 'find', 'show', 'way',
  'please', 'pls', 'can', 'you', 'guide', 'directions', 'direction', 'navigate', 'route', 'for', 'of', 'in', 'at', 'on', 'my', 'nearest',
  'emmene', 'moi', 'ou', 'est', 'le', 'la', 'les', 'du', 'de', 'des', 'au', 'aller', 'comment', 'je', 'vers',
  'وين', 'أين', 'خذني', 'إلى', 'الى', 'كيف', 'اذهب', 'فين', 'بغيت', 'نمشي', 'لل']);

const CUES = {
  procedure: /\b(how (do|can) i|how to|declare|form|sign|signature|apply|register|request|procedure|comment (faire|declarer)|demande|internship|stage|minor)\b/,
  person: /\b(professor|prof|dr|doctor|office hours|is .+ in|his office|her office|their office|bureau|professeur)\b|أستاذ|دكتور/,
  place: /\b(where|take me|directions?|navigate|go to|get to|guide me|walk|way to|ou est|emmene|aller)\b|وين|أين|خذني|فين/,
  help: /\b(how (do|does) (i )?use (this|the|gomap)|what can you do|help me use|tutorial|walkthrough|how does this (app|map) work|aide)\b/,
};

export function modeFrom(text: string): Match['mode'] {
  const t = normalise(text);
  if (/step[- ]?free|wheelchair|no stairs|without stairs|accessible|sans marches|fauteuil|كرسي/.test(t)) return 'step_free';
  if (/\bar\b|camera|augmented|realite augmentee/.test(t)) return 'ar';
  return null;
}

type Doc = { id: string; keys: string[] };
const stripFiller = (k: string) => k.split(' ').filter(w => !FILLER.has(w)).join(' ');

export class IntentRouter {
  private places: Fuse<Doc>;
  private people: Fuse<Doc>;
  private procedures: Fuse<Doc>;
  private procedureDocs: Doc[];
  constructor(places: Doc[], people: Doc[], procedures: Doc[]) {
    const opts = { keys: ['keys'], includeScore: true, includeMatches: true, ignoreLocation: true, threshold: 0.34, minMatchCharLength: 2 };
    // keys get the same treatment as questions: normalised, filler words dropped ('park my car' → 'park car')
    const prep = (docs: Doc[]) => docs.map(d => ({ ...d, keys: [...new Set(d.keys.map(normalise).flatMap(k => [k, stripFiller(k)]).filter(Boolean))] }));
    this.places = new Fuse(prep(places), { ...opts, threshold: 0.3 });
    this.people = new Fuse(prep(people), opts);
    this.procedureDocs = prep(procedures);
    this.procedures = new Fuse(this.procedureDocs, { ...opts, threshold: 0.38 });
  }

  private best(fuse: Fuse<Doc>, windows: string[], exactBonus: (doc: Doc, w: string) => boolean) {
    let best: { id: string; score: number } | null = null;
    for (const w of windows) {
      for (const r of fuse.search(w, { limit: 3 })) {
        let score = r.score ?? 1;
        if (exactBonus(r.item, w)) score = Math.min(score, 0.001);
        else {
          // "eat" sits inside "amphitheatre": a window covering little of the matched name is weak
          const key = r.matches?.[0]?.value ?? '';
          const ratio = key ? w.length / key.length : 1;
          if (ratio < 0.5) score += (0.5 - ratio) * 1.2;
          // one word matching part of a two-word name ('campus' ≈ 'campus police') is weak evidence
          const keyWords = key.split(' ').length, winWords = w.split(' ').length;
          if (keyWords > winWords) score += 0.12 * (keyWords - winWords);
          if (w.length < 3) score += 0.25;
        }
        if (!best || score < best.score) best = { id: r.item.id, score };
      }
    }
    return best;
  }

  match(text: string, wanted?: Exclude<Intent, 'help'>): Match | null {
    const t = normalise(text);
    const mode = modeFrom(text);
    if (!wanted && CUES.help.test(t)) return { intent: 'help', id: 'walkthrough', score: 0, mode };
    const words = t.split(' ').filter(w => !FILLER.has(w));
    if (!words.length) return null;
    const windows = new Set<string>();
    // fuzzy matching works on short windows only (Fuse scores patterns over 32 chars in chunks)
    for (let n = Math.min(4, words.length); n >= 1; n--) for (let i = 0; i + n <= words.length; i++) windows.add(words.slice(i, i + n).join(' '));
    const list = [...windows].filter(w => w.length <= 32);
    if (!list.length) return null;
    const exact = (doc: Doc, w: string) => doc.keys.includes(w);
    const place = this.best(this.places, list, exact);
    const person = this.best(this.people, list.filter(w => w.length > 2), exact);
    // procedures: a known phrase anywhere in the sentence ("how do I declare a minor") is exact
    const procExact = this.procedureDocs.find(d => d.keys.some(k => k.length > 5 && t.includes(k)));
    const proc = procExact ? { id: procExact.id, score: 0.001 } : this.best(this.procedures, list, () => false);

    const cands: Match[] = [];
    if (place) cands.push({ intent: 'place', id: place.id, score: place.score - (CUES.place.test(t) ? 0.08 : 0), mode });
    if (person) cands.push({ intent: 'person', id: person.id, score: person.score - (CUES.person.test(t) ? 0.1 : 0), mode });
    if (proc) cands.push({ intent: 'procedure', id: proc.id, score: proc.score - (CUES.procedure.test(t) ? 0.15 : 0), mode });
    if (wanted) {
      const matching = cands.find(candidate => candidate.intent === wanted);
      return matching && matching.score < 0.15 ? matching : null;
    }
    cands.sort((a, b) => a.score - b.score);
    const top = cands[0];
    // exact hits score ~0; fuzzy ones must be strong, or we would rather ask Gemini than guess
    return top && top.score < 0.15 ? top : null;
  }
}
