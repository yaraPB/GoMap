import { randomUUID } from 'node:crypto';
import type { Position } from 'geojson';
import { Place } from '../db/mongo.js';
import { json, type Sql } from '../db/sqlite.js';
import { formatHours, openState, type Hours } from '../lib/hours.js';
import type { Campus } from '../services/campus.js';
import { Directory, isStale } from '../services/directory.js';
import { config } from '../config.js';
import { Gemini, GeminiUnavailable, type ToolCall } from './gemini.js';
import { transcribeSoniox } from './soniox.js';
import { IntentRouter, modeFrom, type Lang, type Match } from './router.js';

export type AnswerAction =
  | { type: 'route'; place_id: string; mode: 'walk' | 'step_free' | 'ar' }
  | { type: 'person'; person_id: string }
  | { type: 'help'; topic: 'walkthrough' };

export type Answer = {
  id: string;
  intent: 'place' | 'person' | 'procedure' | 'help' | 'unknown';
  lang: Lang;
  text: string;
  place?: { id: string; name: string; category: string; status: string; closed_reason: string | null; hours: string | null; open: string; coordinates: Position };
  route?: { distance_m: number; duration_s: number; mode: string } | null;
  person?: ReturnType<Directory['view']>;
  procedure?: { id: string; title: string; owner_office: string; steps: { title: string; body: string }[]; status: string };
  contact?: { email: string | null; phone: string | null };
  source?: string;
  verified_at?: string | null;
  unverified?: boolean;
  action?: AnswerAction;
  answered_by: 'local' | 'gemini' | 'cache' | 'none';
  suggestions?: string[];
  translation_review?: boolean;
};

type PlaceLite = { _id: string; name: string; category: string; aliases: string[]; number: string | null; status: string; closed_reason: string | null; hours: Hours | null; location: { coordinates: Position }; verified_at: string | null; source: string; position_estimated: boolean };

/** Short sentences in each language. FR/AR are marked "translation under review" in the app. */
const T = {
  place: {
    en: (n: string, d: string) => `${n} is ${d}. Directions are open.`,
    fr: (n: string, d: string) => `${n} est à ${d}. L'itinéraire est ouvert.`,
    ar: (n: string, d: string) => `${n} على بعد ${d}. الاتجاهات مفتوحة.`,
  },
  placeNoRoute: {
    en: (n: string) => `Here is ${n} on the map.`,
    fr: (n: string) => `Voici ${n} sur la carte.`,
    ar: (n: string) => `هذا ${n} على الخريطة.`,
  },
  closed: {
    en: (n: string, r: string) => `${n} is closed${r ? `: ${r}` : ''}.`,
    fr: (n: string, r: string) => `${n} est fermé${r ? ` : ${r}` : ''}.`,
    ar: (n: string, r: string) => `${n} مغلق${r ? `: ${r}` : ''}.`,
  },
  dist: {
    en: (m: number, min: number) => `${m} m away, about ${min} min on foot`,
    fr: (m: number, min: number) => `${m} m, environ ${min} min à pied`,
    ar: (m: number, min: number) => `${m} م، حوالي ${min} دقائق مشيًا`,
  },
  unknown: {
    en: "I don't know that one yet. I only answer from the campus records, so I'd rather not guess. You can call the AUI switchboard on +212 535-862-000.",
    fr: "Je ne sais pas encore répondre. Je réponds uniquement à partir des données du campus. Standard AUI : +212 535-862-000.",
    ar: 'لا أعرف الجواب بعد. أجيب فقط من بيانات الحرم الجامعي. يمكنك الاتصال بالجامعة على 000-862-535 212+.',
  },
  help: {
    en: "Here's a quick tour: filter the map with the chips at the top, tap a building for its offices, and ask me anything here, by text or by holding the mic.",
    fr: "Petite visite : filtrez la carte avec les puces en haut, touchez un bâtiment pour ses bureaux, et posez-moi vos questions ici, par écrit ou en maintenant le micro.",
    ar: 'جولة سريعة: صفِّ الخريطة بالأزرار في الأعلى، المس مبنى لرؤية مكاتبه، واسألني هنا كتابةً أو بالضغط على الميكروفون.',
  },
};

export class Assistant {
  private router: IntentRouter | null = null;
  private places = new Map<string, PlaceLite>();
  private directory: Directory;

  constructor(private db: Sql, private campus: Campus, private gemini: Gemini) {
    this.directory = new Directory(db);
  }

  /** Rebuild the local index. Called at boot and after admin edits. */
  async refresh() {
    this.db.prepare('DELETE FROM assistant_cache').run();
    const places = await Place.find({}, { _id: 1, name: 1, category: 1, aliases: 1, number: 1, status: 1, closed_reason: 1, hours: 1, location: 1, verified_at: 1, source: 1, position_estimated: 1 }).lean() as unknown as PlaceLite[];
    this.places = new Map(places.map(p => [p._id, p]));
    const people = this.db.prepare('SELECT id, name FROM people').all() as { id: string; name: string }[];
    const procs = this.db.prepare('SELECT id, title, match_phrases FROM procedures').all() as { id: string; title: string; match_phrases: string }[];
    this.router = new IntentRouter(
      places.map(p => ({ id: p._id, keys: [p.name, ...p.aliases] })),
      people.map(p => ({ id: p.id, keys: [p.name, p.name.split(' ').slice(-1)[0]] })),
      procs.map(p => ({ id: p.id, keys: [p.title, ...json.parse<string[]>(p.match_phrases, [])] })),
    );
  }

  private placeNames() { return new Map([...this.places.values()].map(p => [p._id, p.name])); }

  /** 'when does X close' asks for hours, not for directions. */
  private static HOURS = /\b(open|opens|close|closes|closing|hours|what time|when)\b|horaires|ouvert|ferme|متى|مفتوح/i;

  private placeAnswer(id: string, lang: Lang, from: Position | null, mode: Match['mode'], question = ''): Answer | null {
    const p = this.places.get(id);
    if (!p) return null;
    const open = openState(p.hours, config.timezone);
    const base: Answer = {
      id: randomUUID(), intent: 'place', lang, text: '', answered_by: 'local',
      place: { id: p._id, name: p.name, category: p.category, status: p.status, closed_reason: p.closed_reason, hours: formatHours(p.hours), open: open.state, coordinates: p.location.coordinates },
      source: p.source === 'mapbox' ? 'Campus map (Mapbox / OpenStreetMap)' : 'Estimated position',
      verified_at: p.verified_at, unverified: p.position_estimated || !p.verified_at,
    };
    if (p.status === 'closed') { base.text = T.closed[lang](p.name, p.closed_reason ?? ''); return base; }
    if (Assistant.HOURS.test(question)) {
      const h = formatHours(p.hours);
      const now = open.state === 'open' ? ` It is open now, until ${open.until}.` : open.state === 'closed' ? ' It is closed right now.' : '';
      base.text = h ? `${p.name}: ${h}.${now}` : `${p.name} has no published opening hours yet, so I will not guess. Ask at the desk or call the AUI switchboard.`;
      base.unverified = true;
      return base; // no auto-directions: they asked when, not where
    }
    let route: Answer['route'] = null;
    if (from) {
      const r = this.campus.route(from, { placeId: id }, mode === 'step_free' ? 'step_free' : 'walk');
      if (!('error' in r)) route = { distance_m: r.distance_m, duration_s: r.duration_s, mode: r.mode };
    }
    base.route = route;
    base.text = route ? T.place[lang](p.name, T.dist[lang](route.distance_m, Math.max(1, Math.round(route.duration_s / 60)))) : T.placeNoRoute[lang](p.name);
    base.action = { type: 'route', place_id: id, mode: mode ?? 'walk' };
    return base;
  }

  private personAnswer(id: string, lang: Lang): Answer | null {
    const row = this.directory.row(id);
    if (!row) return null;
    const v = this.directory.view(row, this.placeNames());
    const where = v.place ? `${v.place.name}${v.office_number ? `, office ${v.office_number}` : ''}` : null;
    const status = v.availability.label + (v.availability.detail ? ` (${v.availability.detail})` : '');
    const text = lang === 'fr'
      ? `${v.name} : ${where ?? 'bureau non publié'}. ${status}.`
      : lang === 'ar' ? `${v.name}: ${where ?? 'المكتب غير منشور'}. ${status}.`
      : `${v.name}${where ? ` is in ${where}` : "'s office isn't published"}. ${status}.`;
    return {
      id: randomUUID(), intent: 'person', lang, text, answered_by: 'local', person: v,
      contact: { email: v.email, phone: v.phone }, source: v.source, verified_at: v.verified_at, unverified: v.stale,
      action: v.place ? { type: 'person', person_id: v.id } : undefined,
    };
  }

  private procedureAnswer(id: string, lang: Lang, from: Position | null): Answer | null {
    const r = this.db.prepare('SELECT * FROM procedures WHERE id = ?').get(id) as Record<string, string | null> | undefined;
    if (!r) return null;
    const place = r.place_id ? this.places.get(r.place_id) : undefined;
    const placeAns = place ? this.placeAnswer(place._id, lang, from, null) : null;
    return {
      id: randomUUID(), intent: 'procedure', lang, text: r.summary!, answered_by: 'local',
      procedure: { id: r.id!, title: r.title!, owner_office: r.owner_office!, steps: json.parse(r.steps, []), status: r.status! },
      place: placeAns?.place, route: placeAns?.route,
      contact: { email: r.contact_email, phone: null }, source: r.source ?? 'Academic procedures register',
      verified_at: r.verified_at, unverified: r.status !== 'live' || isStale(r.verified_at),
      action: place && place.status !== 'closed' ? { type: 'route', place_id: place._id, mode: 'walk' } : undefined,
    };
  }

  private fromMatch(m: Match, lang: Lang, from: Position | null, question = ''): Answer | null {
    if (m.intent === 'place') return this.placeAnswer(m.id, lang, from, m.mode, question);
    if (m.intent === 'person') return this.personAnswer(m.id, lang);
    if (m.intent === 'procedure') return this.procedureAnswer(m.id, lang, from);
    return { id: randomUUID(), intent: 'help', lang, text: T.help[lang], answered_by: 'local', action: { type: 'help', topic: 'walkthrough' } };
  }

  private log(question: string, lang: Lang, intent: string, by: string) {
    this.db.prepare('INSERT INTO assistant_log (id, question, lang, intent, answered_by, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), question.slice(0, 500), lang, intent, by, new Date().toISOString());
  }

  /** Tools Gemini may call, run against our own data. */
  private async runTool(call: ToolCall) {
    const q = String(call.args.query ?? call.args.name ?? '');
    const intent = call.name === 'find_place' ? 'place' : call.name === 'get_person_office' ? 'person' : 'procedure';
    const m = this.router!.match(q, intent);
    if (call.name === 'find_place') {
      const p = m?.intent === 'place' ? this.places.get(m.id) : undefined;
      return p ? { found: true, id: p._id, name: p.name, category: p.category, status: p.status, closed_reason: p.closed_reason, hours: formatHours(p.hours) ?? 'not published', verified: !!p.verified_at } : { found: false };
    }
    if (call.name === 'get_person_office') {
      if (m?.intent !== 'person') return { found: false };
      const v = this.directory.view(this.directory.row(m.id)!, this.placeNames());
      return { found: true, id: v.id, name: v.name, building: v.place?.name ?? null, office: v.office_number, floor: v.floor, availability: v.availability, hours: v.hours_text ?? 'not published', email: v.email ?? 'not published', verified: !v.stale };
    }
    if (m?.intent !== 'procedure') return { found: false };
    const r = this.db.prepare('SELECT * FROM procedures WHERE id = ?').get(m.id) as Record<string, string | null>;
    return { found: true, id: r.id, title: r.title, summary: r.summary, owner_office: r.owner_office, steps: json.parse(r.steps, []), contact_email: r.contact_email ?? 'not published', status: r.status };
  }

  /** localOnly: live preview while someone is still speaking. No Gemini, no log. */
  async ask(input: { text: string; lang: Lang; from: Position | null; history?: { role: 'user' | 'assistant'; text: string }[]; localOnly?: boolean }): Promise<Answer> {
    if (!this.router) await this.refresh();
    const { text, lang, from } = input;
    const review = lang !== 'en';

    // 1–3: local router
    const m = this.router!.match(text);
    if (m) {
      const a = this.fromMatch(m, lang, from, text);
      if (a) { if (!input.localOnly) this.log(text, lang, a.intent, 'local'); return { ...a, translation_review: review }; }
    }
    if (input.localOnly) return { id: randomUUID(), intent: 'unknown', lang, text: '', answered_by: 'none' };

    // 4: Gemini with function calling
    if (!this.gemini.configured) {
      this.log(text, lang, 'unknown', 'none');
      return { id: randomUUID(), intent: 'unknown', lang, text: T.unknown[lang], answered_by: 'none', translation_review: review, suggestions: ['Where is the library?', 'How do I declare a minor?', 'Is Harit Satt in?'] };
    }
    try {
      const { calls } = await this.gemini.ask(text, lang, input.history ?? [], c => this.runTool(c));
      const hit = [...calls].reverse().find(c => (c.result as { found?: boolean })?.found);
      let answer: Answer;
      if (hit) {
        const id = String((hit.result as { id: string }).id);
        const intent = hit.call.name === 'find_place' ? 'place' : hit.call.name === 'get_person_office' ? 'person' : 'procedure';
        const structured = this.fromMatch({ intent, id, score: 0, mode: modeFrom(text) }, lang, from, text)!;
        // The model resolves intent; factual content comes from the current campus record.
        answer = { ...structured, answered_by: 'gemini' };
      } else {
        answer = { id: randomUUID(), intent: 'unknown', lang, text: T.unknown[lang], answered_by: 'gemini', suggestions: ['Where is the library?', 'How do I declare a minor?'] };
      }
      this.log(text, lang, answer.intent, 'gemini');
      return { ...answer, translation_review: review };
    } catch (error) {
      this.log(text, lang, 'error', 'none');
      const message = error instanceof GeminiUnavailable ? error.message : 'The assistant could not answer right now.';
      return { id: randomUUID(), intent: 'unknown', lang, text: `${message} ${T.unknown[lang]}`, answered_by: 'none', translation_review: review };
    }
  }

  async transcribe(audio: Buffer, mime: string, lang: Lang) {
    return config.sonioxKey ? transcribeSoniox(audio, mime, lang, config.sonioxKey, config.sonioxModel) : this.gemini.transcribe(audio, mime, lang);
  }
}
