/**
 * The assistant's voice. One place for text-to-speech so every answer sounds the same and the
 * waveform can follow it.
 *
 * Why answers were silent before: after recording, iOS keeps the audio session in
 * "play and record" mode, which routes speech to the earpiece (barely audible) and obeys the
 * silent switch. We switch back to playback before every answer.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
import type { Lang } from '../api/types';

const LOCALE: Record<Lang, string> = { en: 'en-US', fr: 'fr-FR', ar: 'ar-SA' };

let speaking = false;
let level = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** true while the assistant is talking. */
export const useSpeaking = () => useSyncExternalStore(subscribe, () => speaking, () => false);
/** A 0–1 envelope while talking (TTS gives no audio level, so words drive it). */
export const speechLevel = () => level;

const voices: Partial<Record<Lang, string | null>> = {};
async function bestVoice(lang: Lang): Promise<string | undefined> {
  if (voices[lang] !== undefined) return voices[lang] ?? undefined;
  try {
    const all = await Speech.getAvailableVoicesAsync();
    const prefix = LOCALE[lang].slice(0, 2);
    const mine = all.filter(v => v.language?.toLowerCase().startsWith(prefix));
    // enhanced/premium voices sound far less robotic; prefer the exact locale
    const pick = mine.find(v => v.quality === Speech.VoiceQuality.Enhanced && v.language === LOCALE[lang])
      ?? mine.find(v => v.quality === Speech.VoiceQuality.Enhanced)
      ?? mine.find(v => v.language === LOCALE[lang]) ?? mine[0];
    voices[lang] = pick?.identifier ?? null;
  } catch { voices[lang] = null; }
  return voices[lang] ?? undefined;
}

/** Strip what sounds bad read aloud: emails become "by email", extensions are spelled out. */
export function forSpeech(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'by email')
    .replace(/\bext\.\s*(\d+)/gi, (_, n: string) => `extension ${n.split('').join(' ')}`)
    .replace(/(\d{2}):(\d{2})/g, (_, h: string, m: string) => (m === '00' ? `${Number(h)}` : `${Number(h)} ${m}`))
    .replace(/[·•]/g, ',')
    .replace(/–/g, ' to ');
}

let pulse: ReturnType<typeof setInterval> | null = null;
const stopPulse = () => { if (pulse) clearInterval(pulse); pulse = null; level = 0; };

export async function speak(text: string, lang: Lang, opts: { onDone?: () => void } = {}) {
  if (!text.trim()) { opts.onDone?.(); return; }
  Speech.stop();
  if (Platform.OS !== 'web') await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  const voice = await bestVoice(lang);
  const done = () => { speaking = false; stopPulse(); emit(); opts.onDone?.(); };
  speaking = true;
  emit();
  // a syllable-ish envelope: boundaries (iOS/web) kick it, a soft pulse keeps it alive on Android
  stopPulse();
  let t = 0;
  pulse = setInterval(() => { t += 1; level = Math.max(level * 0.82, 0.25 + 0.35 * Math.abs(Math.sin(t * 0.9)) * Math.abs(Math.sin(t * 0.37))); }, 60);
  Speech.speak(forSpeech(text), {
    language: LOCALE[lang], voice, rate: Platform.OS === 'ios' ? 0.52 : 1.0, pitch: 1.0,
    onBoundary: () => { level = 0.95; },
    onDone: done, onStopped: done, onError: done,
  });
}

export function stopSpeaking() {
  Speech.stop();
  if (speaking) { speaking = false; stopPulse(); emit(); }
}
