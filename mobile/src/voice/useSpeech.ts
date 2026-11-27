/**
 * SpeechProvider, as a hook. One interface, two engines:
 *
 *  - native:   on-device recognition (expo-speech-recognition). Live partial words, EN/FR/AR.
 *              Needs a dev build on phones (a native module); on web it uses the Web Speech API.
 *  - recorded: Expo Go fallback. Records with expo-audio (real mic metering drives the waveform),
 *              then the server transcribes the clip on release.
 *
 * The engine is chosen at runtime, so the same code runs in Expo Go and in a dev build.
 *  - soniox:   live words from Soniox (best for Arabic/Darija/French), streamed straight from the
 *              phone with a 5-minute key from our server. Tried first when the server has a
 *              Soniox key and expo-audio can stream PCM; otherwise the engines above take over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import type { Lang } from '../api/types';
import { api } from '../api/client';
import { speechLocale } from '../i18n/strings';
import { SonioxSession, sonioxAvailable } from './soniox';

export type SpeechState = 'idle' | 'listening' | 'transcribing' | 'error';
export type SpeechEngine = 'soniox' | 'native' | 'recorded';

type NativeModule = {
  start: (o: Record<string, unknown>) => void; stop: () => void; abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  isRecognitionAvailable: () => boolean;
  addListener: (event: string, cb: (e: any) => void) => { remove: () => void };
};

function loadNative(): NativeModule | null {
  try {
    if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoSpeechRecognition')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition').ExpoSpeechRecognitionModule as NativeModule;
    if (Platform.OS === 'web' && !mod.isRecognitionAvailable()) return null;
    return mod;
  } catch {
    return null;
  }
}
// Recorded mode uses the server's configured Soniox provider, including in a dev build.
const forced = process.env.EXPO_PUBLIC_SPEECH_ENGINE;
const native = forced === 'recorded' || forced === 'soniox' ? null : loadNative();
const trySoniox = forced !== 'native' && forced !== 'recorded';
export const SPEECH_ENGINE: SpeechEngine = native ? 'native' : 'recorded';

/**
 * On-device recognition (the phone's or the browser's) listens in ONE language, so "Where is le bureau des
 * admissions?" comes out wrong. Soniox follows English, French and Arabic in the same sentence. So when the
 * server transcribes with Soniox, a recording sent to it beats on-device recognition (words appear on release
 * instead of live). Asked once per app run.
 */
let serverVoice: Promise<string | null> | null = null;
const serverTranscriber = () => (serverVoice ??= api.voice().then(v => v.transcription).catch(() => { serverVoice = null; return null; }));
if (native) serverTranscriber();

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function useSpeech(handlers: { onLevel: (level: number) => void; onPartial: (text: string) => void; onEndpoint?: () => void }) {
  const [state, setState] = useState<SpeechState>('idle');
  const [engine, setEngine] = useState<SpeechEngine>(trySoniox && sonioxAvailable() ? 'soniox' : SPEECH_ENGINE);
  const soniox = useRef<SonioxSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const final = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const transcript = useRef('');
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const h = useRef(handlers);
  h.current = handlers;
  const langRef = useRef<Lang>('en');
  const nativeRunning = useRef(false);
  /** the recorder (clip for the server) is the engine running right now */
  const recording = useRef(false);
  const generation = useRef(0);

  // native engine events
  useEffect(() => {
    if (!native) return;
    const subs = [
      native.addListener('result', (e: { results: { transcript: string }[]; isFinal: boolean }) => {
        const text = e.results?.[0]?.transcript ?? '';
        transcript.current = text;
        h.current.onPartial(text);
        if (e.isFinal && final.current) { final.current.resolve(text); final.current = null; }
      }),
      native.addListener('volumechange', (e: { value: number }) => h.current.onLevel(clamp01((e.value + 2) / 12))),
      native.addListener('error', (e: { error: string; message: string }) => {
        if (e.error === 'no-speech' || e.error === 'aborted') { final.current?.resolve(transcript.current); final.current = null; setState('idle'); return; }
        setError(e.message || e.error); setState('error');
        final.current?.reject(new Error(e.message || e.error)); final.current = null;
      }),
      native.addListener('end', () => {
        nativeRunning.current = false;
        h.current.onLevel(0);
        if (final.current) { final.current.resolve(transcript.current); final.current = null; }
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  const start = useCallback(async (lang: Lang) => {
    const attempt = ++generation.current;
    setError(null);
    transcript.current = '';
    langRef.current = lang;
    h.current.onPartial('');
    try {
    if (trySoniox && sonioxAvailable()) {
      const perm = await requestRecordingPermissionsAsync();
      if (attempt !== generation.current) return false;
      if (!perm.granted) { setError('Microphone permission is off.'); setState('error'); return false; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const session = new SonioxSession({
        onPartial: text => { transcript.current = text; h.current.onPartial(text); },
        onLevel: l => h.current.onLevel(l),
        onEndpoint: () => h.current.onEndpoint?.(),
        onError: msg => setError(msg),
      });
      if (await session.start(lang)) {
        if (attempt !== generation.current) { session.abort(); return false; }
        soniox.current = session;
        setEngine('soniox');
        setState('listening');
        return true;
      }
      setError(null);
      setEngine(SPEECH_ENGINE); // fall back for this and later sessions
    }
    // mixed languages: record for Soniox on the server rather than single-language on-device recognition
    const multilingual = native ? (await serverTranscriber()) === 'soniox' : false;
    if (attempt !== generation.current) return false;
    if (native && !multilingual) {
      const perm = await native.requestPermissionsAsync();
      if (attempt !== generation.current) return false;
      if (!perm.granted) { setError('Microphone permission is off.'); setState('error'); return false; }
      native.start({ lang: speechLocale(lang), interimResults: true, continuous: false, maxAlternatives: 1, addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 60 }, contextualStrings: ['GoMap', 'AUI', 'Al Akhawayn', 'building', 'registrar', 'NAB'] });
      nativeRunning.current = true;
      setState('listening');
      return true;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (attempt !== generation.current) return false;
    if (!perm.granted) { setError('Microphone permission is off.'); setState('error'); return false; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    if (attempt !== generation.current) { await setAudioModeAsync({ allowsRecording: false }).catch(() => {}); return false; }
    recorder.record();
    recording.current = true;
    setEngine('recorded');
    setState('listening');
    // dBFS: silence ≈ -60, speech ≈ -35…-10
    meter.current = setInterval(() => {
      const db = recorder.getStatus().metering;
      if (typeof db === 'number') h.current.onLevel(clamp01((db + 55) / 45));
    }, 60);
    return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      setState('error');
      return false;
    }
  }, [recorder]);

  /** Stop listening and resolve the final transcript. */
  const stop = useCallback(async (): Promise<string> => {
    if (soniox.current) {
      const session = soniox.current;
      soniox.current = null;
      const text = await session.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      setState('idle');
      return text;
    }
    if (native && !recording.current) {
      if (!nativeRunning.current) { setState('idle'); return transcript.current; }
      return new Promise<string>((resolve, reject) => {
        final.current = { resolve, reject };
        native.stop();
        // some engines never send a final result after stop(): fall back to the last partial
        setTimeout(() => { if (final.current) { final.current.resolve(transcript.current); final.current = null; } }, 1500);
      }).finally(() => setState('idle'));
    }
    if (meter.current) clearInterval(meter.current);
    meter.current = null;
    h.current.onLevel(0);
    recording.current = false;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      const uri = recorder.uri;
      if (!uri) { setState('idle'); return ''; }
      setState('transcribing');
      const { text } = await api.transcribe(uri, langRef.current);
      h.current.onPartial(text);
      setState('idle');
      return text;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not transcribe');
      setState('error');
      return '';
    }
  }, [recorder]);

  const cancel = useCallback(async () => {
    generation.current++;
    if (soniox.current) { soniox.current.abort(); soniox.current = null; await setAudioModeAsync({ allowsRecording: false }).catch(() => {}); }
    else if (native && !recording.current) { nativeRunning.current = false; native.abort(); }
    else {
      recording.current = false;
      if (meter.current) clearInterval(meter.current);
      meter.current = null;
      if (recorder.isRecording) await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
    final.current = null;
    h.current.onLevel(0);
    setState('idle');
  }, [recorder]);

  useEffect(() => () => { if (meter.current) clearInterval(meter.current); }, []);

  return { state, error, engine, start, stop, cancel };
}
