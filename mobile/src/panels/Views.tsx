import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import SignInForm from '../auth/SignInForm';
import { useT } from '../i18n';
import { chat } from '../state/chat';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Btn, Icon, Sheet, T } from '../ui/kit';
import { color, font, type IconName } from '../ui/theme';

export const ROLE_LOOK: Record<string, { icon: IconName; title: string; tint: string; ink: string; blurb: string }> = {
  student: { icon: 'student', title: 'Student', tint: '#EEF4FF', ink: '#2563EB', blurb: 'Find classes, offices and services' },
  faculty: { icon: 'faculty', title: 'Faculty', tint: '#E6F4EC', ink: '#0B6B3F', blurb: 'Post your status and a note on your door' },
  staff: { icon: 'staff', title: 'Staff', tint: '#FFF3DB', ink: '#8A5A00', blurb: 'Office hours, lunch and service desks' },
  admin: { icon: 'shield', title: 'Admin', tint: '#F1E8FF', ink: '#6D28D9', blurb: 'Keeps the campus data true (admin dashboard)' },
  dev: { icon: 'shield', title: 'Developer', tint: '#FEECEC', ink: '#B91C1C', blurb: 'Assigns roles (dev dashboard)' },
  guest: { icon: 'visitor', title: 'Visitor', tint: '#EAF6F8', ink: '#0E7490', blurb: 'Explore the campus, no account needed' },
};

/** Your account: sign in with an email and password (or a test account), see your role, change your password. */
export default function Views() {
  const { pop } = usePanels();
  const { signedIn, signOut } = useApp();
  const t = useT();
  const qc = useQueryClient();
  const [changing, setChanging] = useState(false);
  const fresh = () => { chat.clear(); qc.invalidateQueries(); };
  const me = signedIn ? ROLE_LOOK[signedIn.role] ?? ROLE_LOOK.student : null;
  return (
    <Sheet snaps={[0.75, 0.9]} onClose={pop} scrim header={<View style={styles.head}><T weight="bold" style={{ fontSize: 18 }}>{t('Your account')}</T><T style={{ fontSize: 12.5, color: color.muted }}>{signedIn ? t('Signed in to GoMap') : t('Sign in to get your own view: faculty post their status, admins edit the campus')}</T></View>}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        {signedIn && me ? <>
          <Animated.View entering={FadeInDown.duration(260)} style={[styles.card, { borderColor: me.ink }]}>
            <View style={[styles.badge, { backgroundColor: me.tint }]}><Icon name={me.icon} size={22} stroke={me.ink} /></View>
            <View style={{ flex: 1 }}>
              <T weight="bold" style={{ fontSize: 16 }}>{signedIn.name}</T>
              <T style={{ fontSize: 12.5, color: color.ink2 }} numberOfLines={1}>{signedIn.email}</T>
              <T weight="semibold" style={{ fontSize: 12.5, color: me.ink, marginTop: 2 }}>{t(me.title)} · {t(me.blurb)}</T>
            </View>
          </Animated.View>
          {changing ? <ChangePassword onDone={() => setChanging(false)} /> : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn title={t('Change password')} kind="secondary" small style={{ flex: 1 }} onPress={() => setChanging(true)} />
              <Btn title={t('Sign out')} kind="secondary" small style={{ flex: 1 }} onPress={() => { void signOut(); fresh(); }} />
            </View>
          )}
        </> : <SignInForm looks={ROLE_LOOK} onDone={() => { fresh(); pop(); }} />}
      </ScrollView>
    </Sheet>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api.changePassword(current, next); setMsg({ ok: true, text: t('Password changed.') }); setTimeout(onDone, 900); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError && e.status > 0 ? e.message : t('Could not reach GoMap. Check your connection.') }); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput value={current} onChangeText={setCurrent} placeholder={t('Current password')} placeholderTextColor={color.muted} secureTextEntry autoCapitalize="none" style={styles.input} accessibilityLabel={t('Current password')} />
      <TextInput value={next} onChangeText={setNext} placeholder={t('New password')} placeholderTextColor={color.muted} secureTextEntry autoCapitalize="none" style={styles.input} accessibilityLabel={t('New password')} onSubmitEditing={save} />
      {msg && <T style={{ fontSize: 12.5, color: msg.ok ? color.greenDeep : color.danger }}>{msg.text}</T>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title={t('Cancel')} kind="secondary" small style={{ flex: 1 }} onPress={onDone} />
        <Btn title={t('Save')} small style={{ flex: 1 }} loading={busy} disabled={!current || !next} onPress={save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, borderWidth: 1.5, backgroundColor: '#fff' },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  input: { height: 46, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: color.hairline, backgroundColor: '#fff', fontSize: 15, fontFamily: font.regular, color: color.ink, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}) },
});
