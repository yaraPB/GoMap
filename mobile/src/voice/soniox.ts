/**
 * Live speech-to-text with Soniox, streamed from the phone.
 *
 *   microphone ──PCM int16──▶ expo-audio AudioStream ──▶ WebSocket ──▶ Soniox (stt-rt)
 *                                                      ◀── tokens (final + partial)
 *
 * The server only hands out a 5-minute key (/api/assistant/stt-session); the permanent key
 * never reaches the phone. Needs expo-audio's native AudioStream (dev build, or an Expo Go that
 * ships it); `sonioxAvailable()` checks at runtime so callers can fall back.
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { Lang } from '../api/types';
import { api } from '../api/client';

type Buffer = { data: ArrayBuffer; sampleRate: number; channels: number };
type NativeStream = {
  start(): Promise<void>; stop(): void; release?: () => void; sampleRate: number;
  addListener(event: 'audioStreamBuffer', cb: (b: Buffer) => void): { remove(): void };
};
type StreamCtor = new (o: { sampleRate: number; channels: number; encoding: string }) => NativeStream;

function streamCtor(): StreamCtor | null {
  if (Platform.OS === 'web') return null;
  try {
    const mod = requireOptionalNativeModule<{ AudioStream?: StreamCtor }>('ExpoAudio');
    return typeof mod?.AudioStream === 'function' ? mod.AudioStream : null;
  } catch { return null; }
}
const Ctor = streamCtor();

let serverHasSoniox: boolean | null = null;
/** Native streaming exists and the server is configured (remembered after the first try). */
export const sonioxAvailable = () => !!Ctor && serverHasSoniox !== false;

/** RMS of an int16 buffer → 0–1 loudness, perceptual-ish (speech sits around 0.3–0.8). */
export function rmsLevel(data: ArrayBuffer) {
  const s = new Int16Array(data);
  if (!s.length) return 0;
  let sum = 0;
  for (let i = 0; i < s.length; i += 2) sum += s[i] * s[i];
  const rms = Math.sqrt(sum / Math.ceil(s.length / 2)) / 32768;
  const db = 20 * Math.log10(rms + 1e-6); // -120 … 0
  return Math.max(0, Math.min(1, (db + 55) / 45));
}

export type SonioxHandlers = { onPartial: (text: string) => void; onLevel: (l: number) => void; onEndpoint?: () => void; onError: (msg: string) => void };

export class SonioxSession {
  private ws: WebSocket | null = null;
  private stream: NativeStream | null = null;
  private sub: { remove(): void } | null = null;
  private pending: ArrayBuffer[] = [];
  private ready = false;
  private finalText = '';
  private partialText = '';
  private finished: ((text: string) => void) | null = null;
  private closed = false;

  constructor(private h: SonioxHandlers) {}

  private text() { return (this.finalText + this.partialText).replace(/<end>/g, '').replace(/\s+/g, ' ').trim(); }

  async start(lang: Lang): Promise<boolean> {
    if (!Ctor) return false;
    let session;
    try { session = await api.sttSession(); serverHasSoniox = true; }
    catch (e) { if ((e as { status?: number }).status === 404) serverHasSoniox = false; return false; }

    // start the microphone first so nothing said during the handshake is lost
    this.stream = new Ctor({ sampleRate: 16000, channels: 1, encoding: 'int16' });
    this.sub = this.stream.addListener('audioStreamBuffer', b => {
      this.h.onLevel(rmsLevel(b.data));
      if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(b.data);
      else if (this.pending.length < 200) this.pending.push(b.data);
    });
    await this.stream.start();

    return new Promise<boolean>(resolve => {
      const ws = new WebSocket(session.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timeout = setTimeout(() => { if (!this.ready) { this.h.onError('Live transcription took too long to connect.'); this.abort(); resolve(false); } }, 6000);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          api_key: session.api_key, model: session.model, audio_format: 'pcm_s16le',
          sample_rate: this.stream?.sampleRate || 16000, num_channels: 1,
          language_hints: [lang, ...(lang === 'en' ? [] : ['en'])], enable_endpoint_detection: true,
          context: { terms: ['GoMap', 'AUI', 'Al Akhawayn', 'Ifrane', 'registrar', 'NAB', 'Building 8B', 'Pathways', 'OIP', 'CLE', 'ITS'] },
        }));
        this.ready = true;
        clearTimeout(timeout);
        for (const chunk of this.pending) ws.send(chunk);
        this.pending = [];
        resolve(true);
      };
      ws.onmessage = e => {
        let msg: { tokens?: { text: string; is_final: boolean }[]; finished?: boolean; error_message?: string };
        try { msg = JSON.parse(String(e.data)); } catch { return; }
        if (msg.error_message) {
          // refused before a single word (no credit left on the account, bad key…): use the phone's own
          // recognition or the recorded path for the rest of this session instead of failing every time
          if (!this.text()) serverHasSoniox = false;
          this.h.onError(msg.error_message); this.finish(); return;
        }
        if (msg.tokens?.length) {
          let partial = '';
          let endpoint = false;
          for (const t of msg.tokens) {
            if (t.text === '<end>') { endpoint = true; continue; }
            if (t.is_final) this.finalText += t.text; else partial += t.text;
          }
          this.partialText = partial;
          this.h.onPartial(this.text());
          if (endpoint) this.h.onEndpoint?.();
        }
        if (msg.finished) this.finish();
      };
      ws.onerror = () => { if (!this.ready) { clearTimeout(timeout); this.abort(); resolve(false); } else this.finish(); };
      ws.onclose = () => this.finish();
    });
  }

  /** Stop the mic, let Soniox flush the last words, resolve the transcript. */
  stop(): Promise<string> {
    this.stopMic();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.resolve(this.text());
    return new Promise<string>(resolve => {
      this.finished = resolve;
      try { this.ws!.send(''); } catch { this.finish(); } // empty frame = end of audio
      setTimeout(() => this.finish(), 2500);
    });
  }

  abort() { this.stopMic(); this.closed = true; try { this.ws?.close(); } catch { /* closed */ } this.ws = null; }

  private stopMic() {
    this.sub?.remove(); this.sub = null;
    try { this.stream?.stop(); this.stream?.release?.(); } catch { /* already stopped */ }
    this.stream = null;
    this.h.onLevel(0);
  }

  private finish() {
    if (this.closed && !this.finished) return;
    this.closed = true;
    this.stopMic();
    const done = this.finished;
    this.finished = null;
    try { this.ws?.close(); } catch { /* closed */ }
    this.ws = null;
    done?.(this.text());
  }
}
