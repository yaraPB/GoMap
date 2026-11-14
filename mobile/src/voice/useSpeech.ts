/**
 * SpeechProvider, as a hook. One interface, two engines:
 *
 *  - native:   on-device recognition (expo-speech-recognition). Live partial words, EN/FR/AR.
 *              Needs a dev build on phones (a native module); on web it uses the Web Speech API.
 *  - recorded: Expo Go fallback. Records with expo-audio (real mic metering drives the waveform),
 *              then the server transcribes the clip on release.
 *
 * The engine is chosen at runtime, so the same code runs in Expo Go and in a dev build.
 * Swapping in another provider (e.g. Soniox for Arabic) means adding a third engine here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import type { Lang } from '../api/types';
import { api } from '../api/client';
import { speechLocale } from '../i18n/strings';

export type SpeechState = 'idle' | 'listening' | 'transcribing' | 'error';
export type SpeechEngine = 'native' | 'recorded';

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
const native = loadNative();
export const SPEECH_ENGINE: SpeechEngine = native ? 'native' : 'recorded';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function useSpeech(handlers: { onLevel: (level: number) => void; onPartial: (text: string) => void }) {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const final = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);
  const transcript = useRef('');
  const meter = useRef<ReturnType<typeof setInterval> | null>(null);
  const h = useRef(handlers);
  h.current = handlers;
  const langRef = useRef<Lang>('en');

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
        h.current.onLevel(0);
        if (final.current) { final.current.resolve(transcript.current); final.current = null; }
        setState(s => (s === 'listening' ? 'idle' : s));
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);

  const start = useCallback(async (lang: Lang) => {
    setError(null);
    transcript.current = '';
    langRef.current = lang;
    h.current.onPartial('');
    if (native) {
      const perm = await native.requestPermissionsAsync();
      if (!perm.granted) { setError('Microphone permission is off.'); setState('error'); return false; }
      native.start({ lang: speechLocale(lang), interimResults: true, continuous: false, maxAlternatives: 1, addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 60 }, contextualStrings: ['GoMap', 'AUI', 'Al Akhawayn', 'building', 'registrar', 'NAB'] });
      setState('listening');
      return true;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setError('Microphone permission is off.'); setState('error'); return false; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState('listening');
    // dBFS: silence ≈ -60, speech ≈ -35…-10
    meter.current = setInterval(() => {
      const db = recorder.getStatus().metering;
      if (typeof db === 'number') h.current.onLevel(clamp01((db + 55) / 45));
    }, 60);
    return true;
  }, [recorder]);

  /** Stop listening and resolve the final transcript. */
  const stop = useCallback(async (): Promise<string> => {
    if (native) {
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
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) { setState('idle'); return ''; }
    setState('transcribing');
    try {
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
    if (native) native.abort();
    else {
      if (meter.current) clearInterval(meter.current);
      meter.current = null;
      if (recorder.isRecording) await recorder.stop().catch(() => {});
    }
    final.current = null;
    h.current.onLevel(0);
    setState('idle');
  }, [recorder]);

  useEffect(() => () => { if (meter.current) clearInterval(meter.current); }, []);

  return { state, error, engine: SPEECH_ENGINE, start, stop, cancel };
}
