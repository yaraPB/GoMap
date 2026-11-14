/**
 * The conversation with GoMap, outside any one panel: going to voice and back, or into
 * directions and back, keeps the chat. Plain store + useSyncExternalStore, no extra library.
 */
import { useSyncExternalStore } from 'react';
import type { Answer } from '../api/types';

export type Turn = { role: 'user'; text: string } | { role: 'assistant'; answer: Answer } | { role: 'error'; text: string };
type State = {
  turns: Turn[];
  /** hands-free: after GoMap answers out loud, listen again */
  talk: boolean;
  /** voice replies on/off */
  voice: boolean;
  /** a question waiting for the assistant panel to send (from the voice screen) */
  pending: string | null;
};

let state: State = { turns: [], talk: false, voice: true, pending: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach(l => l());
};

export const chat = {
  get: () => state,
  add: (t: Turn) => set(s => ({ turns: [...s.turns.slice(-40), t] })),
  clear: () => set({ turns: [], pending: null }),
  setTalk: (talk: boolean) => set({ talk }),
  setVoice: (voice: boolean) => set({ voice }),
  ask: (text: string) => set({ pending: text }),
  takePending: () => { const p = state.pending; if (p) set({ pending: null }); return p; },
  history: (): { role: 'user' | 'assistant'; text: string }[] => state.turns.flatMap((t): { role: 'user' | 'assistant'; text: string }[] => (t.role === 'user' ? [{ role: 'user', text: t.text }] : t.role === 'assistant' ? [{ role: 'assistant', text: t.answer.text }] : [])),
};

export function useChat() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => state);
}
