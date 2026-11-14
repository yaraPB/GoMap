import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCrowding } from '../api/hooks';
import { useMap } from '../map/MapContext';
import { usePanels } from '../state/panels';
import { IconBtn, Label, Notice, T } from '../ui/kit';
import { color, shadow } from '../ui/theme';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);

/** Board 21: historic footfall per walkway segment, by hour. No live tracking, no identities. */
export default function Crowding() {
  const insets = useSafeAreaInsets();
  const { pop } = usePanels();
  const map = useMap();
  const now = new Date();
  const [weekday, setWeekday] = useState((now.getDay() + 6) % 7);
  const [hour, setHour] = useState(Math.min(20, Math.max(8, now.getHours())));
  const { data, isLoading, isError } = useCrowding(weekday, hour, true);

  useEffect(() => { map.setLayers({ crowding: true }); return () => map.setLayers({ crowding: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) map.send({ type: 'crowding', data, fit: hour === Math.min(20, Math.max(8, now.getHours())) }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const f = data?.features ?? [];
    const high = f.filter(x => x.properties.level === 'high');
    const delay = Math.round(high.reduce((s, x) => s + x.properties.delay_s, 0) / Math.max(1, high.length));
    return { high: high.length, delay };
  }, [data]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <IconBtn icon="back" label="Back to the map" onPress={pop} />
        <View style={styles.title}><T weight="bold" style={{ fontSize: 15 }}>Crowding by walkway</T><T style={{ fontSize: 12, color: color.muted }}>Typical {DAYS[weekday]}, past four weeks</T></View>
      </View>
      <Animated.View entering={FadeInDown.duration(320)} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <T weight="bold" style={{ fontSize: 26, letterSpacing: -0.5 }}>{String(hour).padStart(2, '0')}:00</T>
          <T style={{ fontSize: 13, color: color.muted }}>{isLoading ? 'Loading…' : summary.high ? `${summary.high} busy stretches · up to +${Math.max(1, Math.round(summary.delay / 60))} min` : 'Paths are quiet'}</T>
        </View>
        {/* hour scrubber, 08:00 to 20:00 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
          {HOURS.map(h => (
            <Pressable key={h} accessibilityRole="button" accessibilityState={{ selected: h === hour }} accessibilityLabel={`${h}:00`} onPress={() => setHour(h)}
              style={[styles.hour, h === hour && { backgroundColor: color.ink }]}>
              <T weight="semibold" style={{ fontSize: 13, color: h === hour ? '#fff' : color.ink2 }}>{h}</T>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {DAYS.map((d, i) => (
            <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: i === weekday }} onPress={() => setWeekday(i)} style={[styles.day, i === weekday && { borderColor: color.ink, backgroundColor: color.surface }]}>
              <T weight="semibold" style={{ fontSize: 12, color: i === weekday ? color.ink : color.muted }}>{d}</T>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <Label>Quiet</Label>
          <View style={{ flex: 1, height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden' }}>
            {color.crowd.map(c => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
          </View>
          <Label>Busy</Label>
        </View>
        {isError ? <View style={{ marginTop: 12 }}><Notice tone="missing" icon="wifiOff" text="Crowding needs a connection." /></View>
          : <T style={{ fontSize: 11.5, color: color.muted, marginTop: 12, lineHeight: 16 }}>Historic and anonymous, by path segment, never by person. {data?.basis.includes('simulated') ? 'Simulated until real anonymous traces exist.' : ''}</T>}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', gap: 10, alignItems: 'center' },
  title: { flex: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#fff', ...shadow.float },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, ...shadow.sheet },
  hour: { width: 42, height: 38, borderRadius: 10, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  day: { flex: 1, height: 32, borderRadius: 9, borderWidth: 1, borderColor: color.hairline, alignItems: 'center', justifyContent: 'center' },
});
