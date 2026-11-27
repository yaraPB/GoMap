/**
 * The map's category filter (the chips at the top of Home), outside Home so the assistant can set it:
 * "where can I eat?" switches the map to Dining exactly as tapping the chip would.
 */
import { useSyncExternalStore } from 'react';

type State = { category: string; school: string };
let state: State = { category: 'all', school: 'all' };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };

export const mapFilter = {
  get: () => state,
  setCategory: (category: string) => set({ category, school: 'all' }),
  setSchool: (school: string) => set({ school }),
  clear: () => set({ category: 'all', school: 'all' }),
};

export function useMapFilter() {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => state);
}
