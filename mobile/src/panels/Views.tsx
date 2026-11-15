import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts } from '../api/hooks';
import type { MockUser } from '../api/types';
import { useT } from '../i18n';
import { chat } from '../state/chat';
import { USERS, useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, Sheet, T } from '../ui/kit';
import { color, type IconName } from '../ui/theme';

export const ROLE_LOOK: Record<string, { icon: IconName; title: string; tint: string; ink: string; blurb: string }> = {
  student: { icon: 'student', title: 'Student', tint: '#EEF4FF', ink: '#2563EB', blurb: 'Find classes, offices and services' },
  faculty: { icon: 'faculty', title: 'Faculty', tint: '#E6F4EC', ink: '#0B6B3F', blurb: 'Post your status and a note on your door' },
  staff: { icon: 'staff', title: 'Staff', tint: '#FFF3DB', ink: '#8A5A00', blurb: 'Office hours, lunch and service desks' },
  guest: { icon: 'visitor', title: 'Visitor', tint: '#EAF6F8', ink: '#0E7490', blurb: 'Explore the campus, no account needed' },
};

/** Demo accounts from SQLite, one tap each. The admin dashboard is a separate web app. TODO: GoCampus SSO */
export default function Views() {
  const { pop } = usePanels();
  const { user, setUser } = useApp();
  const t = useT();
  const accounts = useAccounts();
  const qc = useQueryClient();
  const list: MockUser[] = accounts.data?.length ? accounts.data : USERS;
  const pick = (u: MockUser) => { setUser(u); chat.clear(); qc.invalidateQueries(); pop(); };
  return (
    <Sheet snaps={[0.62]} onClose={pop} header={<View style={styles.head}><T weight="bold" style={{ fontSize: 18 }}>{t('Choose a view')}</T><T style={{ fontSize: 12.5, color: color.muted }}>{t('Demo accounts until GoCampus sign-in')}</T></View>}>
      <View style={{ padding: 16, gap: 10 }}>
        {list.map((u, i) => {
          const look = ROLE_LOOK[u.role] ?? ROLE_LOOK.student;
          const on = user.id === u.id;
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
      </View>
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
