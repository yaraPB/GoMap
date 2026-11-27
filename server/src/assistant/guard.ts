/**
 * Keeps GoMap on AUI. Runs before the router and before any model call, so a question that is
 * dangerous, off-topic or meaningless costs nothing and never reaches the model.
 *
 *  - before the router: dangerous requests, self-harm (answered with care, not refused) and attempts
 *    to rewrite the assistant's rules ("ignore your instructions…"). These win over everything.
 *  - after the router missed: clear off-topic questions (general knowledge, homework, code, other
 *    universities…) and gibberish. A campus word anywhere in the sentence means it is not off-topic.
 *
 * The model has a `decline` tool for the subtle cases these patterns let through.
 * The texts below are fixed: the model never writes a refusal itself.
 */
import { normalise, type Lang } from './router.js';

export type Decline = 'dangerous' | 'off_topic' | 'nonsense' | 'injection';
export type GuardHit = { kind: Decline } | { kind: 'self_harm' };

const SELF_HARM = /\b(kill myself|killing myself|suicide|suicidal|end my life|take my (own )?life|hurt myself|harm myself|self harm|self-harm|cut myself|want to die|don t want to live|dont want to live|no reason to live)\b|me suicider|me tuer|mettre fin a (ma|mes) vie|envie de mourir|انتحار|نقتل راسي|نموت راسي|اقتل نفسي|انهي حياتي/;

const DANGEROUS = new RegExp([
  // weapons and explosives
  String.raw`\b(make|build|buy|get|find|sell|hide|bring)\b.{0,30}\b(gun|guns|pistol|rifle|firearm|bomb|bombs|explosive|explosives|grenade|molotov|weapon|weapons|knife to (class|campus))\b`,
  String.raw`\bhow to (make|build) (a )?(bomb|weapon|explosive|poison|meth|drugs?)\b`,
  // hurting other people
  String.raw`\b(kill|murder|stab|poison|beat up|hurt|kidnap|assault|strangle)\b.{0,20}\b(someone|somebody|him|her|them|a person|people|my (roommate|professor|teacher|classmate|friend|ex)|a student|students|the professor|a professor)\b`,
  String.raw`\bshoot (him|her|them|someone|somebody|up the|people|students)\b`,
  // drugs
  String.raw`\b(buy|sell|score|grow|smoke|deal)\b.{0,25}\b(weed|cannabis|hash|hashish|marijuana|cocaine|heroin|mdma|ecstasy|lsd|meth|drugs)\b`,
  String.raw`\b(get|find)\b.{0,25}\b(weed|cannabis|hashish|marijuana|cocaine|heroin|mdma|ecstasy|lsd|meth)\b`,
  // breaking in, stalking, hacking, cheating
  String.raw`\b(break into|sneak into|pick the lock|bypass (the )?(security|lock|camera|cameras|gate)|disable (the )?(camera|cameras|alarm)|get past security)\b`,
  String.raw`\b(hack|hacking|crack|ddos|phish|phishing|keylogger|steal)\b.{0,30}\b(account|accounts|password|passwords|portal|wifi|wi fi|server|grades?|system|email|exam|card)\b`,
  String.raw`\b(alter|fake|forge|falsify)\b.{0,15}\b(my |the |a )?(grades?|transcript|diploma|medical certificate|signature|attendance)\b`,
  String.raw`\b(cheat|cheating)\b.{0,20}\b(exam|exams|test|quiz|midterm|final)\b|\b(exam|test|midterm|final) (answers|questions) (before|leak|leaked)\b`,
  String.raw`\b(where does|which room does|what room does|which dorm does)\b.{0,30}\b(live|sleep|stay)\b|\bstalk\w*\b`,
  // French
  String.raw`\b(fabriquer|acheter|vendre|trouver)\b.{0,25}\b(bombe|arme|armes|pistolet|drogue|cannabis|hachich|cocaine)\b`,
  String.raw`\b(pirater|hacker)\b|\btricher\b.{0,20}\b(examen|partiel)\b|\b(tuer|frapper|agresser)\b.{0,15}\b(quelqu un|mon|ma|un etudiant|le prof)\b`,
  // Arabic / Darija
  String.raw`قنبلة|متفجرات|سلاح|مخدرات|حشيش|كوكايين|نقتل|اقتل|نضرب|اختراق|نسرق|اسرق|نغش|الغش في الامتحان`,
].join('|'));

const INJECTION = /\b(ignore|disregard|forget|override|bypass)\b.{0,25}\b(previous|prior|above|your|these|all (the |your )?)\b.{0,20}\b(instructions?|rules|prompt|guidelines|restrictions)\b|\b(system prompt|your instructions|your prompt|developer mode|jailbreak|dan mode)\b|\b(you are now|from now on you are|pretend (to be|you are)|act as (a|an|my)|roleplay as|role play as)\b|ignore (tes|les) instructions|تجاهل التعليمات/;

/** Anything about the university: if one of these is in the sentence, it is not off-topic. */
const CAMPUS = /\b(aui|akhawayn|campus|ifrane|building|bldg|office|offices|room|dorm|dorms|residence|housing|library|cafeteria|restaurant|registrar|advisor|adviser|professor|prof|dr|dean|school|sba|sse|ssah|shss|course|courses|class|classes|exam|exams|semester|registration|register|minor|major|concentration|transcript|tuition|fees|scholarship|club|clubs|event|events|parking|park|gym|mosque|security|health center|counsel|student|students|faculty|staff|wifi|portal|canvas|internship|graduat\w*|catalog|degree|credit|credits|enroll\w*|cash wallet|meal|dining|department|program|programs|teacher|lecture|batiment|bureau|bibliotheque|etudiant|cours|inscription|frais|mineure|majeure|الجامعة|الحرم|مبنى|مكتب|المكتبة|التسجيل|الطلبة|طالب|أستاذ|استاذ|السكن|الأمن)\b/;

const OFF_TOPIC = new RegExp([
  String.raw`\b(capital of|population of|president of|prime minister|king of|who (won|invented|discovered|wrote|painted|is the (president|king|richest|best))|world cup|champions league|premier league|la liga|nba|super bowl|olympics|oscars?)\b`,
  String.raw`\b(write|compose|generate|draft|make)\b.{0,15}\b(a |an |me (a |an )?)?(poem|song|story|essay|code|program|script|function|joke|rap|tweet|caption)\b`,
  String.raw`\b(solve|calculate|compute|integrate|derivative|equation|homework|assignment answers|do my (homework|assignment|essay|project))\b`,
  String.raw`\b\d+(\.\d+)?\s*[+*/x×÷^]\s*\d+(\.\d+)?\b`,
  String.raw`\b(recipe|how to cook|bitcoin|crypto|stock price|stocks|forex|horoscope|zodiac|lottery|bet|betting|casino)\b`,
  String.raw`\b(tell me a joke|say something funny|are you (human|real|alive|conscious)|do you love|will you marry|what is your favou?rite|sing me|play a game|let s play)\b`,
  String.raw`\b(chatgpt|openai|gemini|claude|siri|alexa|which (ai|model|llm)( model)? are you|who (made|created|built) you)\b`,
  String.raw`\b(movie|movies|netflix|series to watch|tv show|anime|video game|fortnite|minecraft|tiktok|instagram followers)\b`,
  String.raw`\b(translate|traduis|traduire)\b`,
  String.raw`\b(harvard|mit|stanford|oxford|cambridge|um6p|uir|ensa|encg|inpt|ehtp|iscae|mundiapolis|al quaraouiyine|another university|other universit(y|ies)|universite mohammed v|universite hassan)\b`,
  String.raw`\b(politics|election|elections|religion debate|war in|israel|palestine|ukraine|russia)\b`,
  String.raw`\b(blague|recette|poeme|chanson|devoirs|meteo)\b|نكتة|وصفة|قصيدة|كأس العالم|رئيس`,
].join('|'));

/** Keyboard mashing, a single letter, repeated characters, no words at all. */
export function looksLikeNonsense(text: string) {
  const t = normalise(text);
  const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (letters.length < 2) return true;
  if (/(.)\1{4,}/u.test(letters)) return true;
  if (/\b(asdf|qwer|zxcv|hjkl|sdfg|dfgh|fghj|ghjk|jkl;|uiop|wxcv|azer)\w*/.test(t)) return true;
  const latin = t.split(' ').filter(w => /^[a-z]+$/.test(w));
  if (latin.length && latin.length === t.split(' ').length) {
    // words with no vowel at all (but 'b11', 'dr', 'its' are fine: short or campus words)
    const junk = latin.filter(w => w.length >= 5 && !/[aeiouy]/.test(w));
    if (junk.length && junk.length >= latin.length / 2) return true;
  }
  return false;
}

/** Before the router: these win over every campus match. */
export function guardFirst(text: string): GuardHit | null {
  const t = normalise(text);
  if (SELF_HARM.test(t)) return { kind: 'self_harm' };
  if (DANGEROUS.test(t)) return { kind: 'dangerous' };
  if (INJECTION.test(t)) return { kind: 'injection' };
  return null;
}

/** After the router found nothing: obvious off-topic questions and gibberish, without asking the model. */
export function guardMiss(text: string): GuardHit | null {
  const t = normalise(text);
  if (looksLikeNonsense(text)) return { kind: 'nonsense' };
  if (OFF_TOPIC.test(t) && !CAMPUS.test(t)) return { kind: 'off_topic' };
  return null;
}

export const DECLINE_TEXT: Record<Decline, Record<Lang, string>> = {
  off_topic: {
    en: "I can only help with Al Akhawayn University: places on campus, offices, professors, procedures and events. Ask me something about AUI.",
    fr: "Je ne peux aider que pour Al Akhawayn : lieux du campus, bureaux, professeurs, démarches et événements. Posez-moi une question sur l'AUI.",
    ar: 'يمكنني المساعدة فقط في ما يخص جامعة الأخوين: أماكن الحرم، المكاتب، الأساتذة، الإجراءات والفعاليات. اسألني عن الجامعة.',
  },
  dangerous: {
    en: "I can't help with that. If someone is in danger, call AUI Security now: ext. 2222, or 0535-86-2222 from a mobile, 24/7.",
    fr: "Je ne peux pas aider pour cela. Si quelqu'un est en danger, appelez la Sécurité de l'AUI : poste 2222, ou 0535-86-2222 depuis un portable, 24h/24.",
    ar: 'لا يمكنني المساعدة في هذا. إذا كان أحد في خطر، اتصل بأمن الجامعة: الرقم الداخلي 2222 أو 0535-86-2222، على مدار الساعة.',
  },
  injection: {
    en: "I'm GoMap, the AUI campus assistant, and that doesn't change. Ask me about a place, an office, a professor, a procedure or an event at AUI.",
    fr: "Je suis GoMap, l'assistant du campus de l'AUI, et cela ne change pas. Demandez-moi un lieu, un bureau, un professeur, une démarche ou un événement.",
    ar: 'أنا GoMap، مساعد حرم جامعة الأخوين، وهذا لا يتغير. اسألني عن مكان أو مكتب أو أستاذ أو إجراء أو فعالية.',
  },
  nonsense: {
    en: "Sorry, I didn't understand that. Try a question like \"Where is the library?\" or \"How do I declare a minor?\"",
    fr: "Désolé, je n'ai pas compris. Essayez par exemple « Où est la bibliothèque ? » ou « Comment déclarer une mineure ? »",
    ar: 'عذرًا، لم أفهم. جرّب مثلًا: "وين المكتبة؟" أو "كيف أصرّح بتخصص فرعي؟"',
  },
};

export const DECLINE_SUGGESTIONS: Record<Lang, string[]> = {
  en: ['Where is the library?', 'How do I declare a minor?', 'Is Harit Satt in his office?'],
  fr: ['Où est la bibliothèque ?', 'Comment déclarer une mineure ?', 'Où payer mes frais ?'],
  ar: ['وين المكتبة؟', 'أين المسجد؟', 'خذني إلى المبنى 11'],
};

export const SELF_HARM_TEXT: Record<Lang, { text: string; alert: string }> = {
  en: {
    text: "I'm really sorry you're feeling this way, and you don't have to go through it alone. AUI Counseling is free and confidential: Building 6, Room 108, counselor@aui.ma. Please talk to someone today.",
    alert: 'If you might act on these thoughts, call Security now: ext. 2222 / 0535-86-2222 (24/7). The Health Center (Building 26) has a doctor on call day and night.',
  },
  fr: {
    text: "Je suis vraiment désolé que vous vous sentiez ainsi, et vous n'êtes pas seul. Le service de Counseling de l'AUI est gratuit et confidentiel : bâtiment 6, salle 108, counselor@aui.ma. Parlez à quelqu'un aujourd'hui.",
    alert: 'Si vous risquez de passer à l’acte, appelez la Sécurité : poste 2222 / 0535-86-2222 (24h/24). Le Centre de santé (bâtiment 26) a un médecin de garde jour et nuit.',
  },
  ar: {
    text: 'أنا آسف حقًا لأنك تشعر بهذا، ولست وحدك. خدمة الإرشاد النفسي في الجامعة مجانية وسرية: المبنى 6، القاعة 108، counselor@aui.ma. تحدث مع أحد اليوم.',
    alert: 'إذا كنت قد تؤذي نفسك، اتصل بالأمن الآن: 2222 / 0535-86-2222 (على مدار الساعة). المركز الصحي (المبنى 26) فيه طبيب مناوب ليلًا ونهارًا.',
  },
};
