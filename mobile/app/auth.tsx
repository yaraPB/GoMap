/**
 * Where Microsoft sends you back after "Sign in with Outlook" (gomap://auth on the phone,
 * /auth on the web). expo-auth-session reads the result; this screen only closes itself.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { color } from '../src/ui/theme';

WebBrowser.maybeCompleteAuthSession();

export default function AuthReturn() {
  useEffect(() => { const id = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), 50); return () => clearTimeout(id); }, []);
  return <View style={{ flex: 1, backgroundColor: color.map }} />;
}
