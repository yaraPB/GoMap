import { randomUUID } from 'node:crypto';
import type { Position } from 'geojson';
import { Place } from '../db/mongo.js';
import { json, meta, type Sql } from '../db/sqlite.js';
import { formatHours, openState, type Hours } from '../lib/hours.js';
import type { Campus } from '../services/campus.js';
import { Directory, isStale } from '../services/directory.js';
import { Offices, type IssueRow } from '../services/offices.js';
import { config } from '../config.js';
import type { SchoolJson } from '../seed/seed.js';
import type { Gemini } from './gemini.js';
import { CATEGORIES, LlmUnavailable, type Category, type Llm, type ToolCall } from './llm.js';
import { Events, type PlaceRef } from '../services/events.js';
import { transcribeSoniox } from './soniox.js';
import { DECLINE_SUGGESTIONS, DECLINE_TEXT, SELF_HARM_TEXT, guardFirst, guardMiss, type Decline } from './guard.js';
import { IntentRouter, modeFrom, normalise, type Lang, type Match } from './router.js';

type Mode = 'walk' | 'step_free' | 'ar' | 'drive';
export type AnswerAction =
  | { type: 'route'; place_id: string; mode: Mode; from_place_id?: string }
  | { type: 'person'; person_id: string }
  | { type: 'help'; topic: 'walkthrough' }
  | { type: 'events' }
  | { type: 'filter'; category: Category };

export type Portal = { name: string; url: string | null };

export type Answer = {
  id: string;
  intent: 'place' | 'person' | 'procedure' | 'service' | 'info' | 'events' | 'help' | 'department' | 'browse' | 'unknown';
  lang: Lang;
  text: string;
  place?: { id: string; name: string; category: string; status: string; closed_reason: string | null; hours: string | null; open: string; coordinates: Position };
  route?: { distance_m: number; duration_s: number; mode: string } | null;
  /** "from the library to building 11": where the route starts, when it is not where the student is */
  route_from?: { id: string; name: string; coordinates: Position };
  person?: ReturnType<Directory['view']>;
  procedure?: { id: string; title: string; owner_office: string; steps: { title: string; body: string }[]; status: string; channel: 'in_person' | 'online' | 'mixed' };
  /** online procedures: where students do them */
  portal?: Portal;
  service?: ReturnType<Offices['view']>;
  issue?: { id: string; issue: string; go_to: string; notes: string | null };
  department?: { id: string; name: string; building: string | null; place_id: string | null; website: string | null; description: string | null; programs: string[]; services: string[];
    dean: { name: string; office: string | null; email: string | null } | null; contacts: { name: string; role: string | null; office: string | null; email: string | null; phone: string | null }[] };
  /** "where can I eat?": the map filter, and the places it shows */
  browse?: { category: Category; count: number; places: { id: string; name: string; category: string; coordinates: Position; distance_m: number | null }[] };
  /** Shown above the answer: emergencies, closures. */
  alert?: { tone: 'urgent' | 'closed' | 'info'; text: string };
  contact?: { email: string | null; phone: string | null };
  source?: string;
  verified_at?: string | null;
  unverified?: boolean;
  action?: AnswerAction;
  answered_by: 'local' | 'gemini' | 'claude' | 'cache' | 'none';
  /** set when the question was refused: off-topic, dangerous, an attempt to change the rules, or meaningless */
  declined?: Decline;
  /** set when an admin-written rule produced the answer */
  rule?: { id: string; title: string };
  events?: ReturnType<Events['view']>[];
  /** admin playground only: how the answer was found */
  trace?: { candidates: { intent: string; id: string; score: number }[]; tools: { name: string; args: Record<string, string>; found: boolean }[]; ms: number; model: string | null; guard?: string | null };
  suggestions?: string[];
  translation_review?: boolean;
};

type PlaceLite = { _id: string; name: string; category: string; aliases: string[]; number: string | null; status: string; closed_reason: string | null; hours: Hours | null; location: { coordinates: Position }; verified_at: string | null; source: string; position_estimated: boolean };
/** What an answer resolves to: the same shape whether the router, the model or the cache found it. */
type Target = { kind: Match['intent'] | 'events' | 'route' | 'browse' | 'department'; id: string; mode: Mode | null };
type Cached = { t: 'target'; target: Target } | { t: 'decline'; reason: Decline } | { t: 'info'; text: string };

/** Short sentences in each language. FR/AR are marked "translation under review" in the app. */
const T = {
  place: {
    en: (n: string, d: string) => `${n} is ${d}. Directions are open.`,
    fr: (n: string, d: string) => `${n} est à ${d}. L'itinéraire est ouvert.`,
    ar: (n: string, d: string) => `${n} على بعد ${d}. الاتجاهات مفتوحة.`,
  },
  between: {
    en: (a: string, b: string, d: string) => `From ${a} to ${b}: ${d}. Directions are open.`,
    fr: (a: string, b: string, d: string) => `De ${a} à ${b} : ${d}. L'itinéraire est ouvert.`,
    ar: (a: string, b: string, d: string) => `من ${a} إلى ${b}: ${d}. الاتجاهات مفتوحة.`,
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
  drive: {
    en: (m: number, min: number) => `about ${min} min by car and on foot (${m} m)`,
    fr: (m: number, min: number) => `environ ${min} min en voiture puis à pied (${m} m)`,
    ar: (m: number, min: number) => `حوالي ${min} دقائق بالسيارة ثم مشيًا (${m} م)`,
  },
  unknown: {
    en: "I don't know that one, and I'd rather not guess. Try aui.ma or the AUI switchboard (+212 535-862-000); for student matters, Student Affairs (DSA, Building 2, dsa@aui.ma) can point you to the right office.",
    fr: "Je ne sais pas, et je préfère ne pas deviner. Consultez aui.ma ou le standard de l'AUI (+212 535-862-000) ; pour la vie étudiante, les Affaires étudiantes (DSA, bâtiment 2, dsa@aui.ma) vous orienteront.",
    ar: 'لا أعرف الجواب، ولا أريد أن أخمّن. راجع aui.ma أو اتصل بالجامعة على 000-862-535 212+؛ ولشؤون الطلبة، شؤون الطلبة (DSA، المبنى 2، dsa@aui.ma) ترشدك إلى المكتب المناسب.',
  },
  help: {
    en: "Here's a quick tour: filter the map with the chips at the top, tap a building for its offices, and ask me anything here, by text or by holding the mic.",
    fr: "Petite visite : filtrez la carte avec les puces en haut, touchez un bâtiment pour ses bureaux, et posez-moi vos questions ici, par écrit ou en maintenant le micro.",
    ar: 'جولة سريعة: صفِّ الخريطة بالأزرار في الأعلى، المس مبنى لرؤية مكاتبه، واسألني هنا كتابةً أو بالضغط على الميكروفون.',
  },
  hello: {
    en: "Hi! I'm GoMap, the AUI campus assistant. Ask me where something is, how to do a procedure, whether a professor is in, or what's on today.",
    fr: "Bonjour ! Je suis GoMap, l'assistant du campus de l'AUI. Demandez-moi où se trouve un lieu, comment faire une démarche, si un professeur est là, ou ce qui se passe aujourd'hui.",
    ar: 'مرحبًا! أنا GoMap، مساعد حرم جامعة الأخوين. اسألني عن مكان، أو كيف تقوم بإجراء، أو إن كان أستاذ في مكتبه، أو ما يجري اليوم.',
  },
  thanks: {
    en: "You're welcome! Anything else on campus I can help with?",
    fr: 'Avec plaisir ! Autre chose sur le campus ?',
    ar: 'على الرحب والسعة! هل من شيء آخر في الحرم؟',
  },
};

const CHIP: Record<Category, Record<Lang, [string, string]>> = {
  // [what they are, the chip's name]
  dining: { en: ['dining places', 'Dining'], fr: ['lieux de restauration', 'Restauration'], ar: ['أماكن للأكل', 'المطاعم'] },
  athletics: { en: ['sports facilities', 'Athletics'], fr: ['installations sportives', 'Sport'], ar: ['مرافق رياضية', 'الرياضة'] },
  residential: { en: ['residences', 'Residential'], fr: ['résidences', 'Résidences'], ar: ['إقامات', 'السكن'] },
  academic: { en: ['academic buildings', 'Academic'], fr: ['bâtiments académiques', 'Académique'], ar: ['مبانٍ أكاديمية', 'أكاديمي'] },
  admin: { en: ['administrative buildings', 'Administrative'], fr: ['bâtiments administratifs', 'Administration'], ar: ['مبانٍ إدارية', 'إداري'] },
  services: { en: ['campus services', 'Services'], fr: ['services du campus', 'Services'], ar: ['خدمات', 'الخدمات'] },
  facilities: { en: ['facilities and car parks', 'Facilities'], fr: ['équipements et parkings', 'Équipements'], ar: ['مرافق ومواقف', 'المرافق'] },
};
/** The office that goes with each kind of place, quoted under the list. */
const CATEGORY_OFFICE: Partial<Record<Category, string>> = { dining: 'dining', athletics: 'athletics', residential: 'housing' };

/** "where can I eat?", "sports facilities", "the dorms": a kind of place, not one place. */
const BROWSE: { category: Category; cue: RegExp; not?: RegExp }[] = [
  { category: 'dining', cue: /\b(food|eat|eating|hungry|restaurants|places to eat|dining places|cafes|coffee|snacks?|a bite|lunch|dinner|breakfast)\b|\bmanger\b|\bnourriture\b|\brestaurants\b|ناكل|نأكل|الأكل|ماكلة|مطاعم/,
    not: /\b(meal plan|meal card|balance|pay|refund|weekend|open|opens|close|closes|closing|hours|what time|cafeteria|newrest)\b|horaires/ },
  { category: 'athletics', cue: /\b(sports? facilit\w*|sport facilit\w*|sports? (fields?|courts?|places|areas?|grounds?)|athletic facilit\w*|(do|play|practi[sc]e) (some )?sports?|work ?out|exercise|sports on campus|play (football|soccer|basketball|volleyball|handball)|ndir (l)?sport|nl3eb|nlaab|nlab)\b|faire du sport|installations sportives|terrains? de sport|الرياضة|رياضة/,
    not: /\b(join|team|tryouts?|coach|gym)\b/ },
  { category: 'residential', cue: /\b(dorms|residences|residence halls|residential (buildings|area|halls)|where (do|can) students live|student residences)\b|les residences|الداخليات|الإقامات|الاقامات/,
    not: /\b(my|housing|info|information|rules|reserv\w*|book|apply|key|change|problem|maintenance|roommate|check)\b/ },
  { category: 'academic', cue: /\b(academic buildings|classroom buildings|classrooms|lecture halls|teaching buildings)\b|batiments academiques/ },
  { category: 'admin', cue: /\b(administrative (offices|buildings)|admin (buildings|offices))\b|batiments administratifs/ },
  { category: 'facilities', cue: /\b(car parks|parking lots|parkings|all (the )?parking|every parking)\b|les parkings/ },
];
/** Only a browse when the question is asking WHERE (not "is dining open on Sunday"). */
const WHEREISH = /\b(where|which|any|show|list|map|facilities|facility|places|options|on campus|around|near|nearby|find|are there|is there|fin|fayn|feen|kayn)\b|\bou\b|\bquels?\b|فين|وين|أين|اين|كاين/;

/** "from the library to building 11" in EN / FR / AR. */
const FROM_TO: { re: RegExp; swap?: boolean }[] = [
  { re: /\bfrom (.+?) (?:to|until|till) (.+)$/ },
  { re: /\bto (.+?) from (.+)$/, swap: true },
  { re: /\b(?:depuis|du|de) (.+?) (?:jusqu a|vers|aux|au|a) (.+)$/ },
  { re: /(?:^| )من (.+?) (?:الى|حتى) (.+)$/ },
  // Darija in Latin letters: "bghit nmchi mn la bibliothèque l batiment 5"
  { re: /\b(?:mn|men) (.+?) (?:l|li|ila|htal|hta l) (.+)$/ },
];
const HERE = /^(here|my location|where i am|my position|ici|ma position|هنا|من هنا)$/;
/** "change from SBA to SSE" is a procedure, "open from 9 to 5" is hours: neither is a route. */
const NOT_A_ROUTE = /\b(change|switch|transfer|move my|major|minor|concentration|credits?|money|pay|email|open|close|hours|am|pm)\b|changer|transferer|horaires/;
const ROUTE_CUE = /\b(go|get|walk|route|directions?|way|navigate|take me|guide|drive|how far|distance)\b|aller|chemin|itineraire|خذني|طريق|نمشي/;

const GREETING = /^(hi|hello|hey|hiya|salam|salut|bonjour|bonsoir|coucou|good (morning|afternoon|evening)|yo|marhaba|hello gomap|hi gomap|hey gomap|السلام عليكم|سلام|مرحبا|اهلا|أهلا|صباح الخير|مساء الخير)( gomap| there)?$/;
const THANKS = /^(thanks?|thank you( so much| very much)?|thx|ty|merci( beaucoup)?|shukran|choukran|شكرا|شكرا جزيلا|بارك الله فيك)( gomap)?$/;

/** "tell me about SSE", "what programs does SBA offer", "who is the dean of SSAH". */
const DEPARTMENT_CUE = /\b(programs?|programmes?|majors?|degrees?|about|dean|department|departments|website|contact|concentrations?|offer|offers|study|courses offered|what is|tell me|info|information)\b|programmes?|doyen|filieres?|برامج|عميد|كلية/;
const SCHOOL_KEYS: Record<string, string[]> = {
  SBA: ['sba', 'school of business administration', 'school of business', 'business school', 'business administration', 'ecole de commerce'],
  SSE: ['sse', 'school of science and engineering', 'science and engineering', 'engineering school', 'school of engineering', 'ecole d ingenieurs'],
  SSAH: ['ssah', 'shss', 'school of social sciences arts and humanities', 'school of humanities', 'humanities and social sciences', 'social sciences', 'humanities', 'sciences humaines'],
  LC: ['language center', 'language centre', 'centre de langues', 'centre des langues', 'مركز اللغات'],
};
const SCHOOL_PLACE: Record<string, string> = { SBA: 'building-11', SSE: 'building-5', SSAH: 'building-8', LC: 'building-8' };

const CACHE_HOURS = 6;

export class Assistant {
  private router: IntentRouter | null = null;
  private places = new Map<string, PlaceLite>();
  private directory: Directory;
  private offices: Offices;

  private events: Events;
  constructor(private db: Sql, private campus: Campus, private llm: Llm, private gemini: Gemini) {
    this.directory = new Directory(db);
    this.offices = new Offices(db);
    this.events = new Events(db);
  }

  /** Which model answers open questions (shown in the admin). */
  get model() { return this.llm.configured ? { provider: this.llm.provider, model: this.llm.model } : null; }

  /** Where students do online procedures. The admin sets the name and link (Admin → Procedures). */
  portal(): Portal { return json.parse<Portal>(meta.get(this.db, 'student_portal'), { name: 'the student portal', url: null }); }

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
      this.offices.list().map(s => {
        // a service that IS its building (the Library) is found as the place; only its own keywords point to the service
        const home = places.find(p => p._id === json.parse<string[]>(s.place_ids, [])[0]);
        const homeNames = home ? [home.name, ...home.aliases].map(n => n.toLowerCase()) : [];
        const names = [s.name, s.short_name ?? ''].filter(n => n && !homeNames.some(h => h === n.toLowerCase() || n.toLowerCase().includes(h) && h.length > 5));
        return { id: s.id, keys: [...names, ...json.parse<string[]>(s.keywords, []), ...json.parse<string[]>(s.handles, [])].filter(Boolean) };
      }),
      // 'food' alone means the cafeteria, not the dining office
      this.offices.issues().map(r => ({ id: r.id, keys: [r.issue, ...json.parse<string[]>(r.keywords, [])].filter(k => k.toLowerCase() !== 'food') })),
      (this.db.prepare('SELECT id, title, triggers FROM assistant_rules WHERE enabled = 1').all() as { id: string; title: string; triggers: string }[])
        .map(r => ({ id: r.id, keys: [r.title, ...json.parse<string[]>(r.triggers, [])].filter(Boolean) })),
    );
  }

  private placeNames() { return new Map([...this.places.values()].map(p => [p._id, p.name])); }

  /** 'when does X close' asks for hours, not for directions. */
  private static HOURS = /\b(open|opens|opening|close|closes|closing|hours|what time)\b|\bwhen (does|do|is|will)\b.*\b(open|close|start|finish)|horaires|ouvert|ferme|متى|مفتوح/i;

  private placeAnswer(id: string, lang: Lang, from: Position | null, mode: Mode | null, question = ''): Answer | null {
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
      const r = this.campus.route(from, { placeId: id }, mode === 'step_free' ? 'step_free' : mode === 'drive' ? 'drive' : 'walk');
      if (!('error' in r)) route = { distance_m: r.distance_m, duration_s: r.duration_s, mode: r.mode };
    }
    base.route = route;
    const min = route ? Math.max(1, Math.round(route.duration_s / 60)) : 0;
    base.text = route ? T.place[lang](p.name, (route.mode === 'drive' ? T.drive : T.dist)[lang](route.distance_m, min)) : T.placeNoRoute[lang](p.name);
    base.action = { type: 'route', place_id: id, mode: mode ?? 'walk' };
    return base;
  }

  /** "from A to B": the route starts at A, wherever the student is now. */
  private routeAnswer(fromId: string, toId: string, lang: Lang, mode: Mode | null): Answer | null {
    const a = this.places.get(fromId);
    if (!a || !this.places.get(toId)) return null;
    const ans = this.placeAnswer(toId, lang, a.location.coordinates, mode);
    if (!ans || !ans.place || ans.place.status === 'closed') return ans;
    ans.route_from = { id: a._id, name: a.name, coordinates: a.location.coordinates };
    if (ans.route) {
      const min = Math.max(1, Math.round(ans.route.duration_s / 60));
      ans.text = T.between[lang](a.name, ans.place.name, (ans.route.mode === 'drive' ? T.drive : T.dist)[lang](ans.route.distance_m, min).replace(' away', ''));
    }
    ans.action = { type: 'route', place_id: toId, mode: mode ?? 'walk', from_place_id: fromId };
    return ans;
  }

  private static EMERGENCY = /\b(emergency|urgent|fire|accident|attacked|danger)\b|urgence|طوارئ|حريق/i;
  private static DAYS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

  private serviceAnswer(id: string, lang: Lang, from: Position | null, question = '', issue?: IssueRow): Answer | null {
    const r = this.offices.row(id);
    if (!r) return null;
    const v = this.offices.view(r, this.placeNames());
    const mainId = (issue?.place_id && this.places.has(issue.place_id) ? issue.place_id : undefined) ?? v.places.find(p => this.places.has(p.id))?.id;
    const placeAns = mainId ? this.placeAnswer(mainId, lang, from, null) : null;
    // 'Building 6, Room 108 (main counselor); also …' → the main desk; the card shows the rest
    const where = (issue?.location_text ?? v.location_text)?.split(/;|\(/)[0].trim() || (lang === 'fr' ? 'lieu non publié' : lang === 'ar' ? 'المكان غير منشور' : 'location not published');
    const allDay = v.open.state === 'open' && v.open.until === '23:59';
    const openTxt = allDay ? (lang === 'fr' ? 'Ouvert 24h/24' : lang === 'ar' ? 'مفتوح 24/7' : 'Open 24/7') : v.open.state === 'open' ? (lang === 'fr' ? `Ouvert jusqu'à ${v.open.until}` : lang === 'ar' ? `مفتوح حتى ${v.open.until}` : `Open now until ${v.open.until}`)
      : v.open.state === 'closed' ? (lang === 'fr' ? 'Fermé maintenant' : lang === 'ar' ? 'مغلق الآن' : `Closed now${v.open.next ? `, opens ${Assistant.DAYS[v.open.next.day]} ${v.open.next.time}` : ''}`)
      : null;
    const asksHours = Assistant.HOURS.test(question) && !issue;
    let text: string;
    if (asksHours) text = `${v.short_name}: ${v.hours_text ?? v.notes ?? 'hours not published'}.${openTxt ? ` ${openTxt}.` : ''}`;
    else if (issue) {
      text = lang === 'fr' ? `Pour cela, allez à : ${issue.go_to} (${where}).` : lang === 'ar' ? `لهذا، توجه إلى: ${issue.go_to} (${where}).`
        : `Go to ${issue.go_to}, ${where}.`;
      if (issue.notes) text += ` ${issue.notes}`;
      if (openTxt) text += ` ${openTxt}.`;
    } else {
      text = lang === 'fr' ? `${v.short_name} : ${where}.` : lang === 'ar' ? `${v.short_name}: ${where}.` : `${v.short_name} is in ${where}.`;
      if (openTxt && !allDay) text += ` ${openTxt}.`;
      else if (allDay) text += lang === 'fr' ? ' Ouvert 24h/24, toujours joignable.' : lang === 'ar' ? ' مفتوح دائمًا.' : ' Always reachable, day and night.';
      else if (v.notes) text += ` ${v.notes}`;
    }
    // advising has no one desk: it is your own advisor's office
    if (v.id === 'academic-advising' && !issue) text = lang === 'fr' ? "Voyez votre conseiller académique dans son bureau, pendant ses heures de permanence. Donnez-moi son nom et je vous montre son bureau, ses horaires et s'il est là."
      : lang === 'ar' ? 'قابل مرشدك الأكاديمي في مكتبه خلال ساعات مكتبه. أعطني اسمه وسأريك مكتبه وساعاته وهل هو موجود.'
      : "See your academic advisor in their own office, during their posted office hours. Tell me your advisor's name and I'll show you their office, their hours and whether they're in right now.";
    // Housing: the reception is in Building 38, and the other office is worth knowing
    if (v.id === 'housing' && !asksHours && !/39/.test(text)) text += lang === 'fr' ? ' Le bureau du logement du bâtiment 39 peut aussi aider.' : lang === 'ar' ? ' مكتب السكن في المبنى 39 يمكنه المساعدة أيضًا.' : ' The Housing office in Building 39 can also help.';
    if (v.email && !asksHours && !text.includes(v.email)) text += lang === 'fr' ? ` Contact : ${v.email}.` : lang === 'ar' ? ` البريد: ${v.email}.` : ` Email: ${v.email}.`;
    if (v.id === 'health-center' && v.open.state !== 'open') text += ' A doctor and nurse are on call 24/7 for emergencies.';
    const emergency = id === 'security' && Assistant.EMERGENCY.test(question) || Assistant.EMERGENCY.test(question);
    const campus = this.offices.campus();
    const closed = placeAns?.place?.status === 'closed';
    return {
      id: randomUUID(), intent: 'service', lang, text, answered_by: 'local', service: v,
      issue: issue ? { id: issue.id, issue: issue.issue, go_to: issue.go_to, notes: issue.notes } : undefined,
      place: placeAns?.place, route: asksHours ? null : placeAns?.route,
      contact: { email: v.email, phone: v.phone }, source: v.source ?? 'AUI offices and services list',
      verified_at: v.verified_at, unverified: v.stale || !v.places.length,
      alert: emergency ? { tone: 'urgent', text: campus.emergencies ?? 'Emergency: Security, 24/7, ext. 2222 / 0535-86-2222.' }
        : closed ? { tone: 'closed', text: placeAns!.text } : undefined,
      action: mainId && !asksHours && !closed ? { type: 'route', place_id: mainId, mode: 'walk' } : undefined,
    };
  }

  private issueAnswer(id: string, lang: Lang, from: Position | null, question: string): Answer | null {
    const r = this.offices.issue(id);
    if (!r) return null;
    if (r.service_id) return this.serviceAnswer(r.service_id, lang, from, question, r);
    const placeAns = r.place_id ? this.placeAnswer(r.place_id, lang, from, null) : null;
    return {
      id: randomUUID(), intent: 'service', lang, text: `Go to ${r.go_to}${r.location_text ? `, ${r.location_text}` : ''}.${r.notes ? ` ${r.notes}` : ''}`,
      answered_by: 'local', issue: { id: r.id, issue: r.issue, go_to: r.go_to, notes: r.notes }, place: placeAns?.place, route: placeAns?.route,
      source: 'AUI student issue routing', unverified: false, action: placeAns?.action,
    };
  }

  private infoAnswer(lang: Lang, text: string): Answer {
    const c = this.offices.campus();
    return { id: randomUUID(), intent: 'info', lang, text, answered_by: 'gemini', source: `AUI working hours: ${c.open}–${c.close}, lunch ${c.lunch[0]}–${c.lunch[1]}` };
  }

  /** Where they are, whether they are in right now, their posted hours, and how to reach them. */
  private personAnswer(id: string, lang: Lang): Answer | null {
    const row = this.directory.row(id);
    if (!row) return null;
    const v = this.directory.view(row, this.placeNames());
    const where = v.place ? `${v.place.name}${v.office_number ? `, office ${v.office_number}` : ''}` : null;
    const status = v.availability.label + (v.availability.detail ? ` (${v.availability.detail})` : '');
    const away = v.availability.state === 'out' || ['sick', 'semester_off', 'away_week', 'conference', 'online'].includes(v.note_kind ?? '');
    const hours = v.hours_text ?? (v.by_appointment ? 'by appointment' : null);
    let text: string;
    if (lang === 'fr') {
      text = `${v.name} : ${where ?? 'bureau non publié'}. En ce moment : ${status}.`;
      text += hours ? ` Heures de bureau : ${hours}.` : ' Heures de bureau non publiées.';
      if (v.note) text += ` Mot sur la porte : « ${v.note} ».`;
      if (v.email) text += away || !hours ? ` Écrivez-lui à ${v.email}.` : ` E-mail : ${v.email}.`;
    } else if (lang === 'ar') {
      text = `${v.name}: ${where ?? 'المكتب غير منشور'}. الآن: ${status}.`;
      text += hours ? ` ساعات المكتب: ${hours}.` : ' ساعات المكتب غير منشورة.';
      if (v.note) text += ` ملاحظة على الباب: "${v.note}".`;
      if (v.email) text += ` البريد: ${v.email}.`;
    } else {
      text = `${v.name}${where ? ` is in ${where}` : "'s office isn't published"}. Right now: ${status}.`;
      text += hours ? ` Office hours: ${hours}${v.stale ? ' (as posted on aui.ma; they may be from a past semester)' : ''}.` : ' Office hours are not published.';
      if (v.note) text += ` Note on the door: "${v.note}".`;
      if (v.email) text += away ? ` They're away, so email them at ${v.email}.` : !hours ? ` Email them at ${v.email} to book a time.` : ` Email: ${v.email}.`;
    }
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
    const channel = (['online', 'mixed'].includes(r.channel ?? '') ? r.channel : 'in_person') as 'in_person' | 'online' | 'mixed';
    const portal = this.portal();
    // the admin can name the portal ("My AUI"): every step then says so
    const named = (s: string) => (portal.name && portal.name !== 'the student portal' ? s.replace(/the student portal/g, portal.name) : s);
    const steps = json.parse<{ title: string; body: string }[]>(r.steps, []).map(s => ({ title: named(s.title), body: named(s.body) }));
    const office = r.owner_office ?? '';
    const short = office.replace(/\s*\(.*\)$/, '');
    let text = named(r.summary!);
    if (r.contact_email) text += lang === 'fr' ? ` Pour plus d'informations, contactez ${short} : ${r.contact_email}.` : lang === 'ar' ? ` لمزيد من المعلومات، تواصل مع ${short}: ${r.contact_email}.` : ` If you need more information, contact the ${short.replace(/^the /i, '')} at ${r.contact_email}.`;
    else if (/advisor/i.test(office)) text += lang === 'fr' ? ' Pour plus d’informations, demandez à votre conseiller académique.' : lang === 'ar' ? ' لمزيد من المعلومات، اسأل مرشدك الأكاديمي.' : ' If you need more information, ask your academic advisor.';
    return {
      id: randomUUID(), intent: 'procedure', lang, text, answered_by: 'local',
      procedure: { id: r.id!, title: r.title!, owner_office: office, steps, status: r.status!, channel },
      portal: channel === 'in_person' ? undefined : portal,
      place: placeAns?.place, route: placeAns?.route,
      contact: { email: r.contact_email, phone: null }, source: r.source ?? 'Academic procedures register',
      verified_at: r.verified_at, unverified: r.status !== 'live' || isStale(r.verified_at),
      // online: nowhere to walk to unless something goes wrong, so no auto-directions
      action: place && place.status !== 'closed' ? { type: 'route', place_id: place._id, mode: 'walk' } : undefined,
    };
  }

  /** An answer the admin wrote by hand, with the office / place / steps it points to. */
  private ruleAnswer(id: string, lang: Lang, from: Position | null): Answer | null {
    const r = this.db.prepare('SELECT * FROM assistant_rules WHERE id = ? AND enabled = 1').get(id) as Record<string, string | number | null> | undefined;
    if (!r) return null;
    this.db.prepare('UPDATE assistant_rules SET hits = hits + 1 WHERE id = ?').run(id);
    const text = String((lang === 'fr' ? r.answer_fr : lang === 'ar' ? r.answer_ar : null) || r.answer);
    const linked = r.procedure_id ? this.procedureAnswer(String(r.procedure_id), lang, from)
      : r.service_id ? this.serviceAnswer(String(r.service_id), lang, from)
      : r.place_id ? this.placeAnswer(String(r.place_id), lang, from, null) : null;
    return {
      ...(linked ?? {}), id: randomUUID(), intent: linked?.intent ?? 'info', lang, text, answered_by: 'local',
      rule: { id: String(r.id), title: String(r.title) }, source: 'Written by the campus administration', unverified: false,
      alert: r.urgent ? { tone: 'urgent', text } : linked?.alert,
    };
  }

  private schools(): SchoolJson[] { return json.parse<SchoolJson[]>(meta.get(this.db, 'schools'), []); }

  /** Which school the sentence names, if any (whole words only: 'sse' is not inside 'assessment'). */
  private schoolIn(text: string): string | null {
    const t = ` ${normalise(text)} `;
    let best: { id: string; len: number } | null = null;
    for (const [id, keys] of Object.entries(SCHOOL_KEYS)) for (const k of keys) if (t.includes(` ${normalise(k)} `) && (!best || k.length > best.len)) best = { id, len: k.length };
    return best?.id ?? null;
  }

  private departmentAnswer(id: string, lang: Lang, from: Position | null): Answer | null {
    const s = this.schools().find(x => x.id === id);
    if (!s) return null;
    const deanRow = (s.staff_contacts ?? []).find(c => /\bdean\b/i.test(c.role ?? '') && !/assistant|associate/i.test(c.role ?? ''));
    const deanPerson = deanRow ? null : this.db.prepare("SELECT name, office_number, place_id, email FROM people WHERE department = ? AND title LIKE 'Dean%' LIMIT 1").get(id) as { name: string; office_number: string | null; place_id: string | null; email: string | null } | undefined;
    const dean = deanRow ? { name: deanRow.name, office: deanRow.office ?? null, email: deanRow.email ?? null }
      : deanPerson ? { name: deanPerson.name, office: [deanPerson.place_id ? this.places.get(deanPerson.place_id)?.name : null, deanPerson.office_number ? `Office ${deanPerson.office_number}` : null].filter(Boolean).join(', ') || null, email: deanPerson.email } : null;
    const placeId = SCHOOL_PLACE[id] && this.places.has(SCHOOL_PLACE[id]) ? SCHOOL_PLACE[id] : null;
    const placeAns = placeId ? this.placeAnswer(placeId, lang, from, null) : null;
    const building = s.location?.main_building ?? null;
    const name = (s.name ?? id).replace(/\s*\(.*\)$/, '');
    const programs = (s.programs ?? []).map(p => p.replace(/\s*\(.*\)$/, ''));
    let text = lang === 'fr' ? `${name}${building ? ` : ${building}` : ''}.` : lang === 'ar' ? `${name}${building ? `: ${building}` : ''}.` : `The ${name}${building ? ` is in ${building}` : ''}.`;
    if (dean) text += lang === 'fr' ? ` Doyen(ne) : ${dean.name}${dean.email ? ` (${dean.email})` : ''}.` : lang === 'ar' ? ` العميد: ${dean.name}${dean.email ? ` (${dean.email})` : ''}.` : ` Dean: ${dean.name}${dean.email ? ` (${dean.email})` : ''}.`;
    if (programs.length) text += lang === 'fr' ? ` ${programs.length} programmes, dont ${programs.slice(0, 2).join(' et ')}.` : lang === 'ar' ? ` ${programs.length} برامج.` : ` It offers ${programs.length} programs, including ${programs.slice(0, 2).join(' and ')}.`;
    if (s.website) text += lang === 'fr' ? ` Plus d'infos : ${s.website}.` : lang === 'ar' ? ` المزيد: ${s.website}.` : ` More on ${s.website}.`;
    return {
      id: randomUUID(), intent: 'department', lang, text, answered_by: 'local',
      department: { id, name, building, place_id: placeId, website: s.website ?? null, description: s.description ?? null, programs, services: (s.services ?? []).map(x => x.replace(/\s*\(.*\)$/, '').replace(/\s+-\s+https?:\S+$/, '')),
        dean, contacts: (s.staff_contacts ?? []).map(c => ({ name: c.name, role: c.role ?? null, office: c.office ?? null, email: c.email ?? null, phone: c.phone ?? null })) },
      place: placeAns?.place, route: placeAns?.route,
      contact: { email: dean?.email ?? null, phone: null }, source: `School page (${s.website ?? 'aui.ma'})`, unverified: false,
      action: placeId ? { type: 'route', place_id: placeId, mode: 'walk' } : undefined,
    };
  }

  /** "Where can I eat?": every place of that kind, the map filter switched on, and the office for it. */
  private browseAnswer(category: Category, lang: Lang, from: Position | null): Answer {
    const dist = (c: Position) => (from ? Math.round(Math.hypot((c[0] - from[0]) * 92_900, (c[1] - from[1]) * 111_200)) : null);
    const list = [...this.places.values()].filter(p => p.category === category && p.status !== 'closed')
      .map(p => ({ id: p._id, name: p.name, category: p.category, coordinates: p.location.coordinates, distance_m: dist(p.location.coordinates) }))
      .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const [what, chip] = CHIP[category][lang];
    let text = lang === 'fr' ? `Il y a ${list.length} ${what} sur le campus. J'ai activé le filtre « ${chip} » sur la carte : touchez une épingle pour les détails, ou demandez-moi de vous y emmener.`
      : lang === 'ar' ? `يوجد ${list.length} ${what} في الحرم. فعّلت فلتر "${chip}" على الخريطة: المس أي دبوس للتفاصيل، أو اطلب مني أن آخذك إليه.`
      : `There are ${list.length} ${what} on campus. I've switched the map to the ${chip} filter (the chip at the top), so they're all highlighted: tap a pin for details, or ask me to take you to one.`;
    const officeId = CATEGORY_OFFICE[category];
    const r = officeId ? this.offices.row(officeId) : undefined;
    if (r && lang === 'en') {
      const v = this.offices.view(r, this.placeNames());
      const where = v.location_text?.split(/;|\(/)[0].trim();
      if (category === 'dining' && v.hours_raw) text += ` ${v.hours_raw.replace(/\.$/, '')}.`;
      if (category === 'athletics') text += ` Teams, the gym and sports questions: ${v.short_name}${where ? `, ${where}` : ''}${v.email ? ` (${v.email})` : ''}.`;
      if (category === 'residential') text += ` Housing questions go to the Housing reception${where ? ` in ${where}` : ''}${v.email ? ` (${v.email})` : ''}.`;
    }
    return { id: randomUUID(), intent: 'browse', lang, text, answered_by: 'local', browse: { category, count: list.length, places: list.slice(0, 8) },
      source: 'Campus map categories', action: { type: 'filter', category } };
  }

  private static EVENTS = /\b(events?|happening|what s on|whats on|activities|ceremony|club fair|concert|festival)\b|evenements?|activites|فعاليات|نشاطات/i;

  private placeRefs(): Map<string, PlaceRef> {
    return new Map([...this.places.values()].map(p => [p._id, { id: p._id, name: p.name, coordinates: p.location.coordinates, category: p.category }]));
  }

  private eventsAnswer(lang: Lang, question = ''): Answer {
    const all = this.events.list({ days: 14 }).map(e => this.events.view(e, this.placeRefs()));
    const today = /today|tonight|aujourd|ce soir|اليوم|الليلة/i.test(question);
    const list = (today ? all.filter(e => e.state === 'now' || e.state === 'today') : all).slice(0, 6);
    const fmt = (iso: string) => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar-MA' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: config.timezone }).format(new Date(iso));
    const first = list[0];
    const where = (sep: string) => (first?.place ? sep + first.place.name : first?.location_text ? sep + first.location_text : '');
    const text = !first
      ? (lang === 'fr' ? 'Aucun événement publié pour le moment.' : lang === 'ar' ? 'لا توجد فعاليات منشورة حاليًا.' : 'No events are published right now.')
      : lang === 'fr' ? `${first.state === 'now' ? 'En ce moment' : 'Prochain'} : ${first.title}, ${fmt(first.starts_at)}${where(', ')}.${list.length > 1 ? ` Et ${list.length - 1} autre(s) bientôt.` : ''}`
      : lang === 'ar' ? `${first.state === 'now' ? 'الآن' : 'التالي'}: ${first.title}، ${fmt(first.starts_at)}${where('، ')}.${list.length > 1 ? ` و${list.length - 1} أخرى قريبًا.` : ''}`
      : `${first.state === 'now' ? 'On now' : 'Next up'}: ${first.title}, ${fmt(first.starts_at)}${where(' at ')}.${list.length > 1 ? ` ${list.length - 1} more coming up.` : ''}`;
    return { id: randomUUID(), intent: 'events', lang, text, answered_by: 'local', events: list, source: 'Campus events (Admin → Events)', action: { type: 'events' } };
  }

  private declineAnswer(reason: Decline, lang: Lang, by: Answer['answered_by'] = 'local'): Answer {
    return { id: randomUUID(), intent: 'unknown', lang, text: DECLINE_TEXT[reason][lang], answered_by: by, declined: reason, suggestions: DECLINE_SUGGESTIONS[lang] };
  }

  /** Someone who may hurt themselves gets care and the numbers, never a refusal. */
  private selfHarmAnswer(lang: Lang, from: Position | null): Answer {
    const counseling = this.serviceAnswer('counseling', lang, from);
    const t = SELF_HARM_TEXT[lang];
    return { ...(counseling ?? { id: randomUUID(), intent: 'service', lang, answered_by: 'local' }), text: t.text, alert: { tone: 'urgent', text: t.alert }, action: counseling?.action } as Answer;
  }

  /** "I don't know", with the resource most likely to help: the school's site if one is named. */
  private unknownAnswer(lang: Lang, question: string, by: Answer['answered_by']): Answer {
    const school = this.schoolIn(question);
    const site = school ? this.schools().find(s => s.id === school)?.website : null;
    const text = site ? `${T.unknown[lang]} ${lang === 'fr' ? `Voir aussi ${site}.` : lang === 'ar' ? `راجع أيضًا ${site}.` : `See also ${site}.`}` : T.unknown[lang];
    return { id: randomUUID(), intent: 'unknown', lang, text, answered_by: by, suggestions: ['Where is the library?', 'How do I declare a minor?', 'I lost my student card'] };
  }

  /** A place (or an office's building) named in a few words, for "from A to B". */
  private spot(words: string): string | 'here' | null {
    const w = words.replace(/^(the|la|le|les|l)\s+/, '').trim();
    if (HERE.test(w)) return 'here';
    if (!w) return null;
    for (const c of this.router!.matchAll(w)) {
      if (c.score >= 0.12) break;
      if (c.intent === 'place' && this.places.has(c.id)) return c.id;
      if (c.intent === 'service') {
        const home = json.parse<string[]>(this.offices.row(c.id)?.place_ids ?? null, []).find(id => this.places.has(id));
        if (home) return home;
      }
    }
    return null;
  }

  private fromTo(text: string): { from: string | 'here'; to: string } | null {
    const t = normalise(text);
    if (NOT_A_ROUTE.test(t) || Assistant.HOURS.test(text)) return null;
    for (const { re, swap } of FROM_TO) {
      const m = t.match(re);
      if (!m) continue;
      const [a, b] = swap ? [m[2], m[1]] : [m[1], m[2]];
      // "from 9 to 11" alone is ambiguous; "go from 9 to 11" is a route
      if (/^\d+[a-z]?$/.test(a.trim()) && /^\d+[a-z]?$/.test(b.trim()) && !ROUTE_CUE.test(t)) continue;
      const from = this.spot(a), to = this.spot(b);
      if (from && to && to !== 'here' && from !== to) return { from, to };
    }
    return null;
  }

  private browseFor(text: string): Category | null {
    const t = normalise(text);
    if (Assistant.HOURS.test(text)) return null;
    const hit = BROWSE.find(b => b.cue.test(t) && !b.not?.test(t));
    if (!hit || !(WHEREISH.test(t) || t.split(' ').length <= 3)) return null;
    // "where can I eat near building 5": a named place after the generic words is the real target
    const rest = t.replace(new RegExp(hit.cue.source, 'g'), ' ').replace(new RegExp(WHEREISH.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
    if (rest && this.router!.matchAll(rest).some(c => c.score < 0.05 && ['place', 'service', 'person', 'procedure'].includes(c.intent))) return null;
    return hit.category;
  }

  private departmentFor(text: string, top: Match | null): string | null {
    if (top?.intent === 'rule') return null;
    const school = this.schoolIn(text);
    if (!school) return null;
    const t = normalise(text);
    return DEPARTMENT_CUE.test(t) && !/\b(take me|guide me|directions?|navigate|how do i get)\b/.test(t) ? school : null;
  }

  /** Build the answer card for what was resolved, from the current records. */
  private resolve(target: Target, lang: Lang, from: Position | null, question = ''): Answer | null {
    const { kind, id, mode } = target;
    if (kind === 'rule') return this.ruleAnswer(id, lang, from);
    if (kind === 'place') return this.placeAnswer(id, lang, from, mode, question);
    if (kind === 'person') return this.personAnswer(id, lang);
    if (kind === 'procedure') return this.procedureAnswer(id, lang, from);
    if (kind === 'service') return this.serviceAnswer(id, lang, from, question);
    if (kind === 'issue') return this.issueAnswer(id, lang, from, question);
    if (kind === 'events') return this.eventsAnswer(lang, question);
    if (kind === 'department') return this.departmentAnswer(id, lang, from);
    if (kind === 'browse') return (CATEGORIES as readonly string[]).includes(id) ? this.browseAnswer(id as Category, lang, from) : null;
    if (kind === 'route') {
      const [a, b] = id.split('>');
      return a === 'here' ? this.placeAnswer(b, lang, from, mode) : this.routeAnswer(a, b, lang, mode);
    }
    return { id: randomUUID(), intent: 'help', lang, text: T.help[lang], answered_by: 'local', action: { type: 'help', topic: 'walkthrough' } };
  }

  private log(question: string, lang: Lang, intent: string, by: string) {
    this.db.prepare('INSERT INTO assistant_log (id, question, lang, intent, answered_by, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), question.slice(0, 500), lang, intent, by, new Date().toISOString());
  }

  /** Tools the model may call, run against our own data. */
  private async runTool(call: ToolCall) {
    const q = String(call.args.query ?? call.args.name ?? '');
    if (call.name === 'decline') {
      const reason = ['off_topic', 'dangerous', 'injection', 'nonsense'].includes(call.args.reason) ? call.args.reason as Decline : 'off_topic';
      return { found: true, declined: reason };
    }
    if (call.name === 'route_between') {
      const from = this.spot(normalise(String(call.args.from ?? ''))), to = this.spot(normalise(String(call.args.to ?? '')));
      if (!to || to === 'here') return { found: false, missing: 'destination' };
      if (!from) return { found: false, missing: 'starting place' };
      return { found: true, id: `route:${from}>${to}`, from: from === 'here' ? 'where the student is' : this.places.get(from)?.name, to: this.places.get(to)?.name };
    }
    if (call.name === 'browse_category') {
      const c = String(call.args.category ?? '');
      if (!(CATEGORIES as readonly string[]).includes(c)) return { found: false };
      return { found: true, id: `browse:${c}`, count: [...this.places.values()].filter(p => p.category === c).length };
    }
    if (call.name === 'find_department') {
      const id = this.schoolIn(q) ?? this.schools().find(s => normalise(`${s.id} ${s.name ?? ''}`).includes(normalise(q)))?.id;
      const s = id ? this.schools().find(x => x.id === id) : undefined;
      return s ? { found: true, id: `department:${s.id}`, name: s.name, building: s.location?.main_building ?? null, website: s.website ?? null, programs: (s.programs ?? []).slice(0, 8) } : { found: false };
    }
    if (call.name === 'campus_rule') {
      const m = this.router!.match(q, 'rule');
      const r = m ? this.db.prepare('SELECT id, title, answer FROM assistant_rules WHERE id = ? AND enabled = 1').get(m.id) as { id: string; title: string; answer: string } | undefined : undefined;
      return r ? { found: true, id: `rule:${r.id}`, title: r.title, answer: r.answer } : { found: false };
    }
    if (call.name === 'whats_on') {
      const list = this.events.list({ days: 14 }).map(e => this.events.view(e, this.placeRefs()));
      return list.length ? { found: true, id: 'events:all', events: list.slice(0, 8).map(e => ({ title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, place: e.place?.name ?? e.location_text, state: e.state })) } : { found: false };
    }
    if (call.name === 'campus_info') {
      const c = this.offices.campus();
      return { found: true, info: true, office_hours: `Monday–Friday ${c.open}–${c.close}, closed for lunch ${c.lunch[0]}–${c.lunch[1]}`, weekend: c.weekend_working ? 'open' : 'closed (except dining)',
        exceptions: c.exceptions, emergencies: c.emergencies, offices: this.offices.list().map(s => `${s.short_name ?? s.name}: ${s.location_text ?? 'location not published'}`) };
    }
    if (call.name === 'find_service') {
      const hit = this.router!.match(q, 'issue') ?? this.router!.match(q, 'service');
      if (!hit) return { found: false };
      const issue = hit.intent === 'issue' ? this.offices.issue(hit.id) : undefined;
      const r = this.offices.row(issue?.service_id ?? hit.id);
      if (!r && !issue) return { found: false };
      const v = r ? this.offices.view(r, this.placeNames()) : null;
      return { found: true, id: hit.intent === 'issue' ? `issue:${hit.id}` : `service:${hit.id}`, office: issue?.go_to ?? v?.name, location: issue?.location_text ?? v?.location_text ?? 'not published',
        notes: issue?.notes ?? v?.notes ?? null, hours: v?.hours_text ?? 'not published', email: v?.email ?? 'not published', extension: v?.extension ?? 'not published', handles: v?.handles ?? [] };
    }
    const intent = call.name === 'find_place' ? 'place' : call.name === 'get_person_office' ? 'person' : 'procedure';
    if (call.name === 'find_place' && !this.router!.match(q, 'place')) {
      const sm = this.router!.match(q, 'service');
      const r = sm ? this.offices.row(sm.id) : undefined;
      if (r) return { found: true, id: `service:${r.id}`, name: r.name, location: r.location_text ?? 'not published', hours: formatHours(json.parse(r.hours, null)) ?? 'not published' };
    }
    const m = this.router!.match(q, intent);
    if (call.name === 'find_place') {
      const p = m?.intent === 'place' ? this.places.get(m.id) : undefined;
      return p ? { found: true, id: p._id, name: p.name, category: p.category, status: p.status, closed_reason: p.closed_reason, hours: formatHours(p.hours) ?? 'not published', verified: !!p.verified_at } : { found: false };
    }
    if (call.name === 'get_person_office') {
      if (m?.intent !== 'person') return { found: false };
      const v = this.directory.view(this.directory.row(m.id)!, this.placeNames());
      return { found: true, id: v.id, name: v.name, building: v.place?.name ?? null, office: v.office_number, floor: v.floor, availability: v.availability, hours: v.hours_text ?? 'not published', email: v.email ?? 'not published', note: v.note, verified: !v.stale };
    }
    if (m?.intent !== 'procedure') return { found: false };
    const r = this.db.prepare('SELECT * FROM procedures WHERE id = ?').get(m.id) as Record<string, string | null>;
    return { found: true, id: r.id, title: r.title, summary: r.summary, owner_office: r.owner_office, channel: r.channel, steps: json.parse(r.steps, []), contact_email: r.contact_email ?? 'not published', status: r.status };
  }

  /** localOnly: live preview while someone is still speaking. No model, no log. */
  async ask(input: { text: string; lang: Lang; from: Position | null; history?: { role: 'user' | 'assistant'; text: string }[]; localOnly?: boolean; trace?: boolean; noLog?: boolean; skipLocal?: boolean }): Promise<Answer> {
    const started = Date.now();
    const a = await this.answer(input);
    if (!input.trace) { delete a.trace; return a; }
    return { ...a, trace: { candidates: a.trace?.candidates ?? [], tools: a.trace?.tools ?? [], ms: Date.now() - started, model: a.trace?.model ?? null, guard: a.trace?.guard ?? null } };
  }

  private cacheKey(text: string, lang: Lang) { return `${lang}:${normalise(text)}`; }
  private cacheGet(key: string): Cached | null {
    const row = this.db.prepare('SELECT answer, expires_at FROM assistant_cache WHERE key = ?').get(key) as { answer: string; expires_at: string } | undefined;
    if (!row || row.expires_at < new Date().toISOString()) return null;
    return json.parse<Cached | null>(row.answer, null);
  }
  private cacheSet(key: string, value: Cached) {
    const expires = new Date(Date.now() + CACHE_HOURS * 3600_000).toISOString();
    this.db.prepare('INSERT INTO assistant_cache (key, answer, expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET answer = excluded.answer, expires_at = excluded.expires_at').run(key, JSON.stringify(value), expires);
  }

  private async answer(input: { text: string; lang: Lang; from: Position | null; history?: { role: 'user' | 'assistant'; text: string }[]; localOnly?: boolean; noLog?: boolean; skipLocal?: boolean }): Promise<Answer> {
    if (!this.router) await this.refresh();
    const { text, lang, from } = input;
    const review = lang !== 'en';
    const log = (q: string, l: Lang, intent: string, by: string) => { if (!input.noLog && !input.localOnly) this.log(q, l, intent, by); };
    const done = (a: Answer, extra: Partial<NonNullable<Answer['trace']>> = {}): Answer => ({ ...a, translation_review: review, trace: { candidates: [], tools: [], ms: 0, model: null, ...extra } });
    const blank = (): Answer => ({ id: randomUUID(), intent: 'unknown', lang, text: '', answered_by: 'none' });

    // 0: never helped, whatever else the sentence says: harm, self-harm, attempts to rewrite the rules
    const first = guardFirst(text);
    if (first) {
      if (first.kind === 'self_harm') { log(text, lang, 'self_harm', 'local'); return done(this.selfHarmAnswer(lang, from), { guard: 'self_harm' }); }
      log(text, lang, 'declined', 'local');
      return done(this.declineAnswer(first.kind, lang), { guard: first.kind });
    }
    const n = normalise(text);
    if (!input.skipLocal && GREETING.test(n)) return done({ id: randomUUID(), intent: 'info', lang, text: T.hello[lang], answered_by: 'local', suggestions: DECLINE_SUGGESTIONS[lang] });
    if (!input.skipLocal && THANKS.test(n)) return done({ id: randomUUID(), intent: 'info', lang, text: T.thanks[lang], answered_by: 'local' });

    // 1–3: local router
    const all = this.router!.matchAll(text);
    const candidates = all.slice(0, 5).map(c => ({ intent: c.intent, id: c.id, score: Math.round(c.score * 1000) / 1000 }));
    // skipLocal (model evaluation only): every question goes to the AI model
    let m = input.skipLocal ? null : all[0] ?? null;
    const local = (a: Answer | null, intent?: string) => { if (!a) return null; log(text, lang, intent ?? a.intent, 'local'); return done(a, { candidates }); };

    if (!input.skipLocal && m?.intent !== 'rule') {
      // "from the library to building 11"
      const ft = this.fromTo(text);
      if (ft) { const a = local(this.resolve({ kind: 'route', id: `${ft.from}>${ft.to}`, mode: modeFrom(text) }, lang, from, text), 'route'); if (a) return a; }
      // "what's on tonight?": events, unless an admin rule or an exact name says otherwise
      if (Assistant.EVENTS.test(n)) return local(this.eventsAnswer(lang, text))!;
      // "where can I eat?", "sports facilities": the map filter
      const cat = this.browseFor(text);
      if (cat) return local(this.browseAnswer(cat, lang, from))!;
      // "what programs does SSE offer?"
      const dep = this.departmentFor(text, m);
      if (dep) { const a = local(this.departmentAnswer(dep, lang, from)); if (a) return a; }
    }
    // "take me to the library": the office that IS its building answers as the place. Not "a question about my dorm":
    // that is for the office (Housing), even though it sits in a residence.
    if (m?.intent === 'service' && !/\b(my|i have|i need|question|problem|issue|info|information|lost|broken|key|change|reserv\w*)\b/.test(n)) {
      const home = json.parse<string[]>(this.offices.row(m.id)?.place_ids ?? null, [])[0];
      const place = all.find(c => c.intent === 'place' && c.id === home && c.score - m!.score < 0.01);
      if (place) m = place;
    }
    if (m) {
      const a = this.resolve({ kind: m.intent, id: m.id, mode: m.mode }, lang, from, text);
      if (a) return local(a)!;
    }
    // obvious off-topic questions and gibberish: no model call (free, so the admin's local test run sees it too)
    const miss = input.skipLocal ? null : guardMiss(text);
    if (miss && miss.kind !== 'self_harm') { log(text, lang, 'declined', 'local'); return done(this.declineAnswer(miss.kind, lang), { candidates, guard: miss.kind }); }
    if (input.localOnly) return blank();

    // the same question asked again (no conversation around it): reuse what the model resolved
    const key = this.cacheKey(text, lang);
    const useCache = !input.history?.length && !input.skipLocal;
    const cached = useCache ? this.cacheGet(key) : null;
    if (cached) {
      const a = cached.t === 'decline' ? this.declineAnswer(cached.reason, lang, 'cache') : cached.t === 'info' ? { ...this.infoAnswer(lang, cached.text), answered_by: 'cache' as const }
        : this.resolve(cached.target, lang, from, text);
      if (a) { log(text, lang, a.declined ? 'declined' : a.intent, 'cache'); return done({ ...a, answered_by: 'cache' }, { candidates }); }
    }

    // 4: the AI model (Claude or Gemini) with tool calling
    if (!this.llm.configured) {
      log(text, lang, 'unknown', 'none');
      return done({ ...this.unknownAnswer(lang, text, 'none'), suggestions: ['Where is the library?', 'How do I declare a minor?', 'Where do I pay my fees?'] }, { candidates });
    }
    try {
      const { text: prose, calls } = await this.llm.ask(text, lang, input.history ?? [], c => this.runTool(c));
      const by = this.llm.provider;
      const tools = calls.map(c => ({ name: c.call.name, args: c.call.args, found: (c.result as { found?: boolean })?.found === true }));
      const found = (c: { result: unknown }) => (c.result as { found?: boolean })?.found === true;
      const isInfo = (c: { result: unknown }) => (c.result as { info?: boolean })?.info === true;
      const declinedBy = (c: { result: unknown }) => (c.result as { declined?: Decline })?.declined;
      const lastDecline = calls.map((c, i) => ({ c, i })).reverse().find(x => declinedBy(x.c));
      const hitIdx = calls.map((c, i) => ({ c, i })).reverse().find(x => found(x.c) && !isInfo(x.c) && !declinedBy(x.c));
      const info = calls.find(isInfo);
      let answer: Answer;
      let toCache: Cached | null = null;
      if (lastDecline && (!hitIdx || lastDecline.i > hitIdx.i)) {
        const reason = declinedBy(lastDecline.c)!;
        answer = this.declineAnswer(reason, lang, by);
        toCache = { t: 'decline', reason };
      } else if (hitIdx) {
        const hit = hitIdx.c;
        const raw = String((hit.result as { id: string }).id);
        const sep = raw.indexOf(':');
        const kind = sep > 0 ? raw.slice(0, sep) : '';
        const id = sep > 0 ? raw.slice(sep + 1) : raw;
        const target: Target = {
          kind: (['service', 'issue', 'rule', 'events', 'route', 'browse', 'department'].includes(kind) ? kind : hit.call.name === 'find_place' ? 'place' : hit.call.name === 'get_person_office' ? 'person' : 'procedure') as Target['kind'],
          id, mode: modeFrom(text),
        };
        const structured = this.resolve(target, lang, from, text);
        // The model resolves intent; factual content comes from the current campus record.
        answer = structured ? { ...structured, answered_by: by } : this.unknownAnswer(lang, text, by);
        if (structured) toCache = { t: 'target', target };
      } else if (info && prose) {
        // general campus facts: the model's sentence is grounded in campus_info only
        answer = { ...this.infoAnswer(lang, prose), answered_by: by };
        toCache = { t: 'info', text: prose };
      } else {
        answer = this.unknownAnswer(lang, text, by);
      }
      if (toCache && useCache) this.cacheSet(key, toCache);
      log(text, lang, answer.declined ? 'declined' : answer.intent, by);
      return done(answer, { candidates, tools, model: this.llm.model, guard: answer.declined ?? null });
    } catch (error) {
      log(text, lang, 'error', 'none');
      const message = error instanceof LlmUnavailable ? error.message : 'The assistant could not answer right now.';
      return done({ id: randomUUID(), intent: 'unknown', lang, text: `${message} ${T.unknown[lang]}`, answered_by: 'none' }, { candidates });
    }
  }

  /** Soniox first (best for Darija/French/Arabic); if it fails (no credit, outage), Gemini, so voice keeps working. */
  async transcribe(audio: Buffer, mime: string, lang: Lang) {
    if (!config.sonioxKey) return this.gemini.transcribe(audio, mime, lang);
    try {
      return await transcribeSoniox(audio, mime, lang, config.sonioxKey, config.sonioxModel);
    } catch (error) {
      if (!this.gemini?.configured) throw error;
      console.warn(`Soniox transcription failed (${error instanceof Error ? error.message : 'unknown'}); using Gemini instead.`);
      return this.gemini.transcribe(audio, mime, lang);
    }
  }
}
