import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { focusManager, QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './client';

/** No cached truth: admin edits must show up, so data goes stale after 30 s and refetches on focus. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

/** React Native has no window focus: map app foreground/background onto it. */
export function useAppFocusRefetch() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', s => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
}

/**
 * Admin edits reach the app within ~10 s: the server bumps a version number on every change,
 * and when it moves everything refetches (cheap: one tiny request while the app is open).
 */
export function useLiveRefresh() {
  useEffect(() => {
    let last: number | null = null;
    let active = true;
    const tick = async () => {
      if (!active || (Platform.OS !== 'web' && AppState.currentState !== 'active')) return;
      try {
        const { version } = await api.version();
        if (last !== null && version !== last) queryClient.invalidateQueries();
        last = version;
      } catch { /* offline: try again next tick */ }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);
}

export const usePlaces = () => useQuery({ queryKey: ['places'], queryFn: () => api.places() });
export const usePlace = (id: string | null) => useQuery({ queryKey: ['place', id], queryFn: () => api.place(id!), enabled: !!id });
export const useOffices = (id: string | null) => useQuery({ queryKey: ['offices', id], queryFn: () => api.offices(id!), enabled: !!id });
export const usePerson = (id: string | null) => useQuery({ queryKey: ['person', id], queryFn: () => api.person(id!), enabled: !!id });
export const usePeople = (q: string) => useQuery({ queryKey: ['people', q], queryFn: () => api.people({ q, limit: 60 }) });
export const useWalkways = () => useQuery({ queryKey: ['walkways'], queryFn: api.walkways, staleTime: 10 * 60_000 });
export const useClosures = () => useQuery({ queryKey: ['closures'], queryFn: api.closures });
export const useCrowding = (weekday: number, hour: number, enabled: boolean) => useQuery({ queryKey: ['crowding', weekday, hour], queryFn: () => api.crowding(weekday, hour), enabled, staleTime: 10 * 60_000 });
export const useMyReports = (enabled: boolean) => useQuery({ queryKey: ['myReports'], queryFn: api.myReports, enabled, refetchInterval: enabled ? 60_000 : false });
export const useServices = (q = '') => useQuery({ queryKey: ['services', q], queryFn: () => api.services(q || undefined) });
export const useCampus = () => useQuery({ queryKey: ['campus'], queryFn: api.campus, staleTime: 5 * 60_000 });
export const useBuildings = () => useQuery({ queryKey: ['buildings'], queryFn: api.buildings, refetchInterval: 5 * 60_000 });
export const useExtraBuildings = () => useQuery({ queryKey: ['extraBuildings'], queryFn: api.extraBuildings, staleTime: 10 * 60_000 });
/** Campus events for this role, refreshed every minute so "on now" stays true. */
export const useEvents = (audience?: string) => useQuery({ queryKey: ['events', audience ?? 'all'], queryFn: () => api.events(audience), refetchInterval: 60_000 });
