/**
 * Turn-by-turn sentences come from the server in English ("Turn left and cross the road").
 * They follow a small grammar, so they are rebuilt here in the chosen language.
 */
import type { TFn } from './index';

const SIDE = (s: string, t: TFn) => (s === 'left' ? t('left') : t('right'));

export function trStep(text: string, t: TFn): string {
  let m: RegExpMatchArray | null;
  if (text === 'Head along the path') return t('Head along the path');
  if ((m = text.match(/^Head along the road(?: \((.+)\))?$/))) return m[1] ? t('Head along the road ({name})', { name: m[1] }) : t('Head along the road');
  if ((m = text.match(/^Continue onto (.+)$/))) return t('Continue onto {name}', { name: m[1] });
  if ((m = text.match(/^Park at (.+)$/))) return t('Park at {name}', { name: m[1] });
  if (text === 'You have arrived') return t('You have arrived');
  if (text === 'The entrance is ahead') return t('The entrance is ahead');
  if ((m = text.match(/^The entrance is on your (left|right)$/))) return m[1] === 'left' ? t('The entrance is on your left') : t('The entrance is on your right');
  const tail: Record<string, string> = { 'take the stairs': 'Take the stairs', 'cross the road': 'Cross the road', 'take the ramp': 'Take the ramp' };
  if (tail[text.toLowerCase()]) return t(tail[text.toLowerCase()]);
  if ((m = text.match(/^(Turn|Keep) (sharp )?(left|right)(?: and (take the stairs|cross the road|take the ramp))?(?: onto (.+))?$/))) {
    const [, verb, sharp, side, then, onto] = m;
    let s = verb === 'Keep' ? t('Keep {side}', { side: SIDE(side, t) }) : sharp ? t('Turn sharp {side}', { side: SIDE(side, t) }) : t('Turn {side}', { side: SIDE(side, t) });
    if (then) s = t('{action}, then {next}', { action: s, next: t(tail[then]).toLowerCase() });
    if (onto) s = t('{action} onto {name}', { action: s, name: onto });
    return s;
  }
  return t(text);
}

/** What is said aloud as you approach a step. */
export function speakableStep(text: string, toNext: number, t: TFn) {
  const s = trStep(text, t);
  return toNext > 15 ? t('In {n} metres, {step}', { n: Math.round(toNext / 5) * 5, step: s.charAt(0).toLowerCase() + s.slice(1) }) : s;
}
