import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useAccounts } from '../api/hooks';
import type { MockUser } from '../api/types';
import { chat } from '../state/chat';
import { USERS, useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, Sheet, T } from '../ui/kit';
import { color } from '../ui/theme';

export const ROLE_LOOK: Record<string, { emoji: string; title: string; tint: string }> = {
  student: { emoji: '🎒', title: 'Student', tint: '#EEF4FF' },
  faculty: { emoji: '🧑‍🏫', title: 'Faculty', tint: '#E6F4EC' },
  staff: { emoji: '🗂️', title: 'Staff', tint: '#FFF3DB' },
  guest: { emoji: '🧭', title: 'Visitor', tint: '#F2F3F0' },
};

/** Demo accounts from SQLite, one tap each. The admin dashboard is a separate web app. TODO: GoCampus SSO */
export default function Views() {
  const { pop } = usePanels();
  const { user, setUser } = useApp();
  const accounts = useAccounts();
  const qc = useQueryClient();
  const list: MockUser[] = accounts.data?.length ? accounts.data : USERS;
  const pick = (u: MockUser) => { setUser(u); chat.clear(); qc.invalidateQueries(); pop(); };
  return (
    <Sheet snaps={[0.62]} onClose={pop} header={<View style={styles.head}><T weight="bold" style={{ fontSize: 18 }}>Choose a view</T><T style={{ fontSize: 12.5, color: color.muted }}>Demo accounts until GoCampus sign-in</T></View>}>
      <View style={{ padding: 16, gap: 10 }}>
        {list.map((u, i) => {
          const look = ROLE_LOOK[u.role] ?? ROLE_LOOK.student;
          const on = user.id === u.id;
          return (
            <Animated.View key={u.id} entering={FadeInDown.delay(i * 50).duration(260)}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => pick(u)}
                style={[styles.card, { backgroundColor: look.tint, borderColor: on ? color.ink : 'transparent' }]}>
                <T style={{ fontSize: 30 }} accessibilityElementsHidden>{look.emoji}</T>
                <View style={{ flex: 1 }}>
                  <T weight="bold" style={{ fontSize: 16 }}>{look.title}{u.role === 'faculty' ? ` · ${u.name}` : ''}</T>
                  <T style={{ fontSize: 12.5, color: color.ink2, marginTop: 2 }}>{u.description ?? ''}</T>
                </View>
                {on ? <Icon name="check" size={20} stroke={color.ink} /> : <Icon name="chevron" size={16} stroke={color.muted} />}
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, borderWidth: 2 },
});
