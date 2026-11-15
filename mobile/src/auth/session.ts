/**
 * The GoMap session after "Sign in with Outlook": kept in the phone's secure storage (Keychain /
 * Keystore), or localStorage on the web build. The API reads the role from it on every request.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'gomap-session';

export async function loadSession(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch { return null; }
}
export async function saveSession(token: string | null) {
  try {
    if (Platform.OS === 'web') { if (token) globalThis.localStorage?.setItem(KEY, token); else globalThis.localStorage?.removeItem(KEY); return; }
    if (token) await SecureStore.setItemAsync(KEY, token); else await SecureStore.deleteItemAsync(KEY);
  } catch { /* storage unavailable: the session lasts until the app closes */ }
}
