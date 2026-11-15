/**
 * "Sign in with Outlook": the AUI Microsoft account. Authorization code + PKCE with expo-auth-session
 * (no client secret on the phone); Microsoft's ID token goes to the GoMap API, which checks it and
 * returns a session with the role the dev dashboard gave this email.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { exchangeCodeAsync, makeRedirectUri, Prompt, ResponseType, useAuthRequest, useAutoDiscovery } from 'expo-auth-session';
import { api, ApiError } from '../api/client';
import type { AuthConfig } from '../api/types';
import { useT } from '../i18n';
import { useApp } from '../state/app';
import { T } from '../ui/kit';
import { color } from '../ui/theme';

// on the web build, the sign-in popup lands back here and hands the result to the opener
WebBrowser.maybeCompleteAuthSession();

const SCOPES = ['openid', 'profile', 'email'];

/** The Microsoft logo, as on Microsoft's own sign-in buttons. */
function MicrosoftMark() {
  const q = (c: string) => <View style={{ width: 8, height: 8, backgroundColor: c }} />;
  return <View style={{ width: 18, height: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{q('#F25022')}{q('#7FBA00')}{q('#00A4EF')}{q('#FFB900')}</View>;
}

function Button({ cfg, onDone }: { cfg: NonNullable<AuthConfig['microsoft']>; onDone?: () => void }) {
  const t = useT();
  const { signIn } = useApp();
  const discovery = useAutoDiscovery(`${cfg.authority}/${cfg.tenant}/v2.0`);
  const redirectUri = makeRedirectUri({ scheme: 'gomap', path: 'auth' });
  const [request, , promptAsync] = useAuthRequest({ clientId: cfg.client_id, scopes: SCOPES, redirectUri, usePKCE: true, responseType: ResponseType.Code, prompt: Prompt.SelectAccount }, discovery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!request || !discovery) return;
    setBusy(true); setError(null);
    try {
      const r = await promptAsync();
      if (r.type === 'error') throw new Error(r.error?.description ?? r.error?.message ?? t('Microsoft sign-in failed.'));
      if (r.type !== 'success') return; // closed by the user
      const tok = await exchangeCodeAsync({ clientId: cfg.client_id, code: r.params.code, redirectUri, scopes: SCOPES, extraParams: { code_verifier: request.codeVerifier ?? '' } }, discovery);
      if (!tok.idToken) throw new Error(t('Microsoft did not send an identity. Try again.'));
      const { token, user } = await api.signInMicrosoft(tok.idToken);
      await signIn(token, user);
      onDone?.();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? e.message : e instanceof Error ? e.message : t('Microsoft sign-in failed.'));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Sign in with Outlook')} disabled={!request || busy} onPress={go}
        style={({ pressed }) => [styles.btn, (!request || busy) && { opacity: 0.6 }, pressed && { backgroundColor: '#F3F3F3' }]}>
        {busy ? <ActivityIndicator color="#5E5E5E" /> : <MicrosoftMark />}
        <T weight="semibold" style={{ color: '#3B3B3B', fontSize: 15 }}>{t('Sign in with Outlook')}</T>
      </Pressable>
      {error && <T style={{ color: color.danger, fontSize: 12.5 }}>{error}</T>}
    </View>
  );
}

/** Shows the button when the server has Outlook sign-in set up; says so plainly when it has not. */
export default function OutlookSignIn({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: api.authConfig, staleTime: 10 * 60_000 });
  if (cfg.isLoading) return <ActivityIndicator />;
  if (!cfg.data?.microsoft) return <T style={{ fontSize: 12.5, color: color.muted }}>{t('Sign in with Outlook is not set up on the server yet. Demo accounts below.')}</T>;
  return <Button cfg={cfg.data.microsoft} onDone={onDone} />;
}

const styles = StyleSheet.create({
  btn: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#8C8C8C', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
