import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts } from '../api/hooks';
import type { MockUser } from '../api/types';
import OutlookSignIn from '../auth/OutlookSignIn';
import { useT } from '../i18n';
import { chat } from '../state/chat';
import { USERS, useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Btn, Icon, Label, Sheet, T } from '../ui/kit';
import { color, type IconName } from '../ui/theme';

export const ROLE_LOOK: Record<string, { icon: IconName; title: string; tint: string; ink: string; blurb: string }> = {
  student: { icon: 'student', title: 'Student', tint: '#EEF4FF', ink: '#2563EB', blurb: 'Find classes, offices and services' },
  faculty: { icon: 'faculty', title: 'Faculty', tint: '#E6F4EC', ink: '#0B6B3F', blurb: 'Post your status and a note on your door' },
  staff: { icon: 'staff', title: 'Staff', tint: '#FFF3DB', ink: '#8A5A00', blurb: 'Office hours, lunch and service desks' },
  admin: { icon: 'shield', title: 'Admin', tint: '#F1E8FF', ink: '#6D28D9', blurb: 'Keeps the campus data true (admin dashboard)' },
  dev: { icon: 'shield', title: 'Developer', tint: '#FEECEC', ink: '#B91C1C', blurb: 'Assigns roles (dev dashboard)' },
  guest: { icon: 'visitor', title: 'Visitor', tint: '#EAF6F8', ink: '#0E7490', blurb: 'Explore the campus, no account needed' },
};

/** Your account: sign in with Outlook (AUI Microsoft account), or try the app with a demo account. */
export default function Views() {
  const { pop } = usePanels();
  const { user, setUser, signedIn, signOut } = useApp();
  const t = useT();
  const accounts = useAccounts();
  const qc = useQueryClient();
  // the server decides whether demo accounts exist (dev dashboard); offline, fall back to the built-in list
  const list: MockUser[] = accounts.data ?? (accounts.isError ? USERS : []);
  const fresh = () => { chat.clear(); qc.invalidateQueries(); };
  const pick = (u: MockUser) => { setUser(u); fresh(); pop(); };
  const me = signedIn ? ROLE_LOOK[signedIn.role] ?? ROLE_LOOK.student : null;
  return (
    <Sheet snaps={[0.7, 0.92]} onClose={pop} header={<View style={styles.head}><T weight="bold" style={{ fontSize: 18 }}>{t('Your account')}</T><T style={{ fontSize: 12.5, color: color.muted }}>{t('Sign in with your AUI Outlook account to get your own view')}</T></View>}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 30 }}>
        {signedIn && me ? (
          <View style={[styles.card, { borderColor: me.ink }]}>
            <View style={[styles.badge, { backgroundColor: me.tint }]}><Icon name={me.icon} size={22} stroke={me.ink} /></View>
            <View style={{ flex: 1 }}>
              <T weight="bold" style={{ fontSize: 16 }}>{signedIn.name}</T>
              <T style={{ fontSize: 12.5, color: color.ink2 }} numberOfLines={1}>{signedIn.email}</T>
              <T weight="semibold" style={{ fontSize: 12.5, color: me.ink, marginTop: 2 }}>{t(me.title)} · {t(me.blurb)}</T>
            </View>
          </View>
        ) : <OutlookSignIn onDone={() => { fresh(); pop(); }} />}
        {signedIn && <Btn title={t('Sign out')} kind="ghost" small onPress={() => { void signOut(); fresh(); }} />}

        {!!list.length && <Label style={{ marginTop: 10 }}>{t('Or try a demo account')}</Label>}
        {list.map((u, i) => {
          const look = ROLE_LOOK[u.role] ?? ROLE_LOOK.student;
          const on = !signedIn && user.id === u.id;
          return (
            <Animated.View key={u.id} entering={FadeInDown.delay(i * 50).duration(260)}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => pick(u)}
                style={({ pressed }) => [styles.card, { borderColor: on ? look.ink : color.hairline }, pressed && { transform: [{ scale: 0.985 }] }]}>
                <View style={[styles.badge, { backgroundColor: look.tint }]}><Icon name={look.icon} size={22} stroke={look.ink} /></View>
                <View style={{ flex: 1 }}>
                  <T weight="bold" style={{ fontSize: 16 }}>{t(look.title)}{u.role === 'faculty' ? ` · ${u.name}` : ''}</T>
                  <T style={{ fontSize: 12.5, color: color.ink2, marginTop: 2 }}>{t(look.blurb)}</T>
                </View>
                <View style={[styles.radio, on && { borderColor: look.ink }]}>{on && <View style={[styles.radioDot, { backgroundColor: look.ink }]} />}</View>
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: color.hairline },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, borderWidth: 1.5, backgroundColor: '#fff' },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D5D7D2', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
