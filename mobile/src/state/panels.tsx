import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

/** Everything that opens over the one persistent map. Full-screen modes (AR, faculty status) are routes. */
export type Panel =
  | { name: 'home' }
  | { name: 'search'; query?: string }
  | { name: 'place'; id: string }
  | { name: 'offices'; placeId: string; department?: string }
  | { name: 'person'; id: string }
  | { name: 'people' }
  | { name: 'assistant'; ask?: string }
  | { name: 'voice' }
  | { name: 'route'; said?: string; reply?: string }
  | { name: 'go' }
  | { name: 'arrived' }
  | { name: 'crowding' }
  | { name: 'layers' }
  | { name: 'report'; at?: [number, number] }
  | { name: 'help'; step?: number };

type Ctx = { stack: Panel[]; top: Panel; push: (p: Panel) => void; replace: (p: Panel) => void; pop: () => void; reset: (p?: Panel) => void };
const PanelCtx = createContext<Ctx | null>(null);

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Panel[]>([{ name: 'home' }]);
  const push = useCallback((p: Panel) => setStack(s => (s.at(-1)?.name === p.name ? [...s.slice(0, -1), p] : [...s, p])), []);
  const replace = useCallback((p: Panel) => setStack(s => [...s.slice(0, -1), p]), []);
  const pop = useCallback(() => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((p?: Panel) => setStack(p && p.name !== 'home' ? [{ name: 'home' }, p] : [{ name: 'home' }]), []);
  const depth = useRef(1);
  depth.current = stack.length;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (depth.current <= 1) return false;
      setStack(s => s.slice(0, -1));
      return true;
    });
    return () => sub.remove();
  }, []);
  const value = useMemo(() => ({ stack, top: stack[stack.length - 1], push, replace, pop, reset }), [stack, push, replace, pop, reset]);
  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>;
}
export function usePanels() {
  const c = useContext(PanelCtx);
  if (!c) throw new Error('usePanels outside PanelProvider');
  return c;
}
