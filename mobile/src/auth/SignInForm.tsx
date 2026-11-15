/**
 * Sign in, or create an account, with an email and a password. The API hashes the password and
 * returns a session carrying the role the dev dashboard gave this email. Below the form, the test
 * accounts (one for each role, password 123abc) sign in with one tap while the dev dashboard keeps them on.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { SignedInUser } from '../api/types';
import { useT } from '../i18n';
import { useApp } from '../state/app';
import { Btn, Icon, Label, T } from '../ui/kit';
import { color, font, type IconName } from '../ui/theme';

type Look = { icon: IconName; title: string; tint: string; ink: string; blurb: string };

export default function SignInForm({ onDone, looks }: { onDone?: () => void; looks: Record<string, Look> }) {
  const t = useT();
  const { signIn } = useApp();
  const cfg = useQuery({ queryKey: ['authConfig'], queryFn: api.authConfig, staleTime: 5 * 60_000 });
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passRef = useRef<TextInputInstance>(null);

  const done = async (r: { token: string; user: SignedInUser }) => { await signIn(r.token, r.user); onDone?.(); };
  const fail = (e: unknown) => setError(e instanceof ApiError && e.status > 0 ? e.message : t('Could not reach GoMap. Check your connection.'));

  const submit = async () => {
    if (!email.trim() || !password) { setError(t('Enter your email and password.')); return; }
    setBusy('form'); setError(null);
    try { await done(mode === 'in' ? await api.login(email.trim(), password) : await api.signUp(email.trim(), password, name.trim() || undefined)); }
    catch (e) { fail(e); } finally { setBusy(null); }
  };
  const quick = async (testEmail: string) => {
    setBusy(testEmail); setError(null);
    try { await done(await api.login(testEmail, cfg.data?.test_password ?? '')); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const domains = cfg.data?.allowed_domains ?? ['aui.ma'];
  const min = cfg.data?.min_password ?? 6;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['in', 'up'] as const).map(m => (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setError(null); }}
            style={[styles.tab, mode === m && styles.tabOn]}>
            <T weight={mode === m ? 'bold' : 'semibold'} style={{ fontSize: 14, color: mode === m ? color.ink : color.muted }}>{m === 'in' ? t('Sign in') : t('Create account')}</T>
          </Pressable>
        ))}
      </View>

      {mode === 'up' && (
        <View style={styles.field}>
          <Icon name="user" size={18} stroke={color.muted} />
          <TextInput value={name} onChangeText={setName} placeholder={t('Your name (optional)')} placeholderTextColor={color.muted} style={styles.input}
            accessibilityLabel={t('Your name (optional)')} autoComplete="name" returnKeyType="next" />
        </View>
      )}
      <View style={styles.field}>
        <Icon name="mail" size={18} stroke={color.muted} />
        <TextInput value={email} onChangeText={setEmail} placeholder={`you@${domains[0] ?? 'aui.ma'}`} placeholderTextColor={color.muted} style={styles.input}
          accessibilityLabel={t('Email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress"
          returnKeyType="next" onSubmitEditing={() => passRef.current?.focus()} />
      </View>
      <View style={styles.field}>
        <Icon name="lock" size={18} stroke={color.muted} />
        <TextInput ref={passRef} value={password} onChangeText={setPassword} placeholder={mode === 'up' ? t('Password ({n}+ characters)', { n: min }) : t('Password')} placeholderTextColor={color.muted}
          style={styles.input} accessibilityLabel={t('Password')} secureTextEntry autoCapitalize="none" autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          textContentType={mode === 'up' ? 'newPassword' : 'password'} returnKeyType="go" onSubmitEditing={submit} />
      </View>
      {error && <T style={{ color: color.danger, fontSize: 12.5 }} accessibilityLiveRegion="polite">{error}</T>}
      <Btn title={mode === 'in' ? t('Sign in') : t('Create account')} loading={busy === 'form'} onPress={submit} />
      {mode === 'up' && <T style={{ fontSize: 12, color: color.muted }}>{t('Your role comes from your email: AUI addresses start as students, professors get faculty from the directory.')}</T>}

      {!!cfg.data?.test_accounts.length && <>
        {/* the label is upper-case; the password itself must keep its real case (123abc, not 123ABC) */}
        <Label style={{ marginTop: 12 }}>{t('Test accounts · password {p}').split('{p}')[0]}<T weight="bold" style={styles.pw}>{cfg.data.test_password}</T>{t('Test accounts · password {p}').split('{p}')[1]}</Label>
        {cfg.data.test_accounts.map((a, i) => {
          const look = looks[a.role] ?? looks.student;
          return (
            <Animated.View key={a.email} entering={FadeInDown.delay(i * 40).duration(240)}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t(look.title)} ${a.email}`} disabled={!!busy} onPress={() => quick(a.email)}
                style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.985 }] }]}>
                <View style={[styles.badge, { backgroundColor: look.tint }]}><Icon name={look.icon} size={20} stroke={look.ink} /></View>
                <View style={{ flex: 1 }}>
                  <T weight="bold" style={{ fontSize: 15 }}>{t(look.title)}{a.role === 'faculty' ? ` · ${a.name.replace(/ \(test\)$/, '')}` : ''}</T>
                  <T style={{ fontSize: 12.5, color: color.ink2 }} numberOfLines={1}>{a.email}</T>
                </View>
                {busy === a.email ? <ActivityIndicator color={look.ink} /> : <Icon name="chevron" size={18} stroke={color.muted} />}
              </Pressable>
            </Animated.View>
          );
        })}
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: 12, padding: 3 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  tabOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: color.hairline, backgroundColor: '#fff' },
  // the field's border already shows focus; the browser's own outline would draw a second box inside it
  input: { flex: 1, minWidth: 0, fontSize: 15, fontFamily: font.regular, color: color.ink, paddingVertical: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
  pw: { textTransform: 'none', letterSpacing: 0, color: color.ink, fontSize: 13 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: color.hairline, backgroundColor: '#fff' },
  badge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
