import type { Lang } from '../api/types';

/** UI copy for the assistant and the map home. FR/AR are "translation under review" until a native reviewer signs off. */
const S = {
  askPlaceholder: { en: 'Ask GoMap · where is, how do I…', fr: 'Demandez à GoMap · où est, comment…', ar: 'اسأل GoMap · أين، كيف…' },
  assistantTitle: { en: 'Ask GoMap', fr: 'Demander à GoMap', ar: 'اسأل GoMap' },
  assistantHint: { en: 'Places, people and procedures at AUI. I name my source every time.', fr: 'Lieux, personnes et démarches à AUI. Je cite toujours ma source.', ar: 'الأماكن والأشخاص والإجراءات في الجامعة. أذكر مصدري دائمًا.' },
  typeHere: { en: 'Type a question', fr: 'Écrivez une question', ar: 'اكتب سؤالك' },
  listening: { en: 'Listening', fr: 'À l’écoute', ar: 'أستمع' },
  thinking: { en: 'Thinking', fr: 'Réflexion', ar: 'أفكر' },
  holdToTalk: { en: 'Hold to talk · release to send', fr: 'Maintenez pour parler · relâchez pour envoyer', ar: 'اضغط للتحدث · اترك للإرسال' },
  tapToStop: { en: 'Tap again to send', fr: 'Touchez encore pour envoyer', ar: 'المس مرة أخرى للإرسال' },
  understoodAs: { en: 'Understood as', fr: 'Compris comme', ar: 'فهمت' },
  releaseToConfirm: { en: 'Release to confirm. Directions open on their own · you will not have to tap again.', fr: 'Relâchez pour confirmer. L’itinéraire s’ouvre tout seul.', ar: 'اترك للتأكيد. ستفتح الاتجاهات تلقائيًا.' },
  review: { en: '', fr: 'Traduction en cours de révision', ar: 'الترجمة قيد المراجعة' },
  try: { en: 'Try', fr: 'Essayez', ar: 'جرّب' },
  source: { en: 'Source', fr: 'Source', ar: 'المصدر' },
  verified: { en: 'verified', fr: 'vérifié', ar: 'تم التحقق' },
  unverified: { en: 'Not yet verified — check with the office', fr: 'Pas encore vérifié — confirmez auprès du bureau', ar: 'لم يتم التحقق بعد — تأكد من المكتب' },
  guideMe: { en: 'Guide me there', fr: 'Guidez-moi', ar: 'خذني إلى هناك' },
  walk: { en: 'Walk', fr: 'À pied', ar: 'مشي' },
  arRoute: { en: 'AR route', fr: 'Itinéraire AR', ar: 'مسار AR' },
  stepFree: { en: 'Step-free', fr: 'Sans marches', ar: 'بدون درج' },
  start: { en: 'Start', fr: 'Démarrer', ar: 'ابدأ' },
  voiceOffline: { en: 'Voice needs the server to transcribe in Expo Go. Type instead, or install the dev build for on-device voice.', fr: 'La voix nécessite le serveur dans Expo Go. Écrivez, ou installez la version dev.', ar: 'يحتاج الصوت إلى الخادم في Expo Go. اكتب بدلاً من ذلك.' },
} as const;

export type StringKey = keyof typeof S;
export const t = (lang: Lang, key: StringKey) => S[key][lang] || S[key].en;
export const SUGGESTIONS: Record<Lang, string[]> = {
  en: ['Take me to Building 11', 'How do I declare a minor?', 'Is Harit Satt in his office?', 'Where can I eat?', 'How do I use this map?'],
  fr: ['Emmène-moi au bâtiment 11', 'Comment déclarer une mineure ?', 'Où est la bibliothèque ?'],
  ar: ['خذني إلى المبنى 11', 'وين المكتبة؟', 'أين المسجد؟'],
};
export const speechLocale = (l: Lang) => (l === 'fr' ? 'fr-FR' : l === 'ar' ? 'ar-MA' : 'en-US');
