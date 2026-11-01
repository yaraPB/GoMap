import { Platform } from 'react-native';

export type Entrance = {
  id: string;
  placeId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  verificationStatus: 'unverified' | 'verified' | 'retired';
  accessStatus: 'unknown' | 'approved' | 'restricted';
  verifiedBy: string | null;
  verifiedAt: string | null;
  accessCheckedBy: string | null;
  accessCheckedAt: string | null;
  mapVisible: boolean;
  routeEligible: boolean;
};
export type Place = {
  id: string;
  name: string;
  category: string;
  description: string;
  latitude: number;
  longitude: number;
  verificationStatus: string;
  hours: string | null;
  entrance: string | null;
  entrances?: Entrance[];
};
export type Service = { id: string; title: string; description: string; destinationId: string; note: string };

const local = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || local).replace(/\/$/, '');
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result as T;
}
export const api = {
  places: () => get<Place[]>('/api/places'),
  search: (query: string) => get<Place[]>(`/api/places?q=${encodeURIComponent(query)}`),
  services: () => get<Service[]>('/api/services'),
  report: async (placeId: string, issueType: string, details: string) => {
    const response = await fetch(`${API_URL}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ placeId, issueType, details }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result as { id: number; status: string };
  },
};
