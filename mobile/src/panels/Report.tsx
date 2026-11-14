import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Position, ReportKind } from '../api/types';
import { useMap, useMapEvent } from '../map/MapContext';
import { DEMO_POSITION, useLocation } from '../state/app';
import { usePanels } from '../state/panels';
import { Btn, Icon, IconBtn, Label, Notice, Sheet, T } from '../ui/kit';
import { color, font, shadow, type IconName } from '../ui/theme';

const KINDS: { id: ReportKind; label: string; icon: IconName }[] = [
  { id: 'closed', label: 'Closed or blocked', icon: 'ban' },
  { id: 'broken', label: 'Out of order', icon: 'wrench' },
  { id: 'info', label: 'Wrong information', icon: 'info' },
  { id: 'hazard', label: 'Hazard', icon: 'warn' },
  { id: 'light', label: 'Lighting', icon: 'light' },
  { id: 'access', label: 'Access blocked', icon: 'wheel' },
];
const DURATIONS = [['today', 'Just today'], ['days', 'A few days'], ['unknown', 'Not sure']] as const;

/** Board 29: drop a pin on what is wrong. Nothing reaches the map until the admin confirms it. */
export default function Report({ at }: { at?: Position }) {
  const insets = useSafeAreaInsets();
  const { pop } = usePanels();
  const map = useMap();
  const loc = useLocation();
  const [point, setPoint] = useState<Position>(at ?? loc.coord ?? DEMO_POSITION);
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState<'today' | 'days' | 'unknown'>('unknown');
  const [photo, setPhoto] = useState<string | null>(null);
  const submit = useMutation({ mutationFn: () => api.report({ kind: kind!, at: point, note, duration, photoUri: photo }) });

  useEffect(() => {
    map.send({ type: 'pick', on: true });
    map.send({ type: 'camera', center: point, zoom: 18, pitch: 30 });
    return () => map.send({ type: 'pick', on: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useMapEvent(e => { if (e.type === 'picked') setPoint(e.detail); });

  const addPhoto = async () => {
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false }).catch(() => null)
      ?? await ImagePicker.launchImageLibraryAsync({ quality: 0.6 }).catch(() => null);
    if (r && !r.canceled && r.assets[0]) setPhoto(r.assets[0].uri);
  };

  if (submit.isSuccess) {
    return (
      <Sheet snaps={[0.42]} onClose={pop}>
        <Animated.View entering={FadeIn} style={{ alignItems: 'center', padding: 24, gap: 12 }}>
          <Animated.View entering={ZoomIn.springify()} style={styles.done}><Icon name="check" size={30} stroke="#fff" width={3} /></Animated.View>
          <T weight="bold" style={{ fontSize: 20 }}>Thanks, it's with the admin</T>
          <T style={{ fontSize: 14, color: color.muted, textAlign: 'center', lineHeight: 20 }}>
            {submit.data.merged_with_existing ? 'Someone reported this spot already, so yours was added to the same item.' : 'Nothing changes on the map until it is confirmed.'} You'll see here when it is handled.
          </T>
          <Btn title="Back to the map" kind="dark" onPress={pop} style={{ alignSelf: 'stretch', marginTop: 6 }} />
        </Animated.View>
      </Sheet>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.hint, { top: insets.top + 8 }]}>
        <IconBtn icon="close" label="Cancel the report" onPress={pop} />
        <View style={styles.hintText}><T weight="semibold" style={{ fontSize: 13.5 }}>Tap the map to move the pin</T><T style={{ fontSize: 12, color: color.muted }}>Put it where the problem is</T></View>
      </View>
      <Sheet snaps={[0.56, 0.9]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 14 }} keyboardShouldPersistTaps="handled">
          <T weight="bold" style={{ fontSize: 20 }} accessibilityRole="header">Report a problem here</T>
          <View style={styles.kinds}>
            {KINDS.map(k => (
              <Pressable key={k.id} accessibilityRole="radio" accessibilityState={{ selected: kind === k.id }} onPress={() => setKind(k.id)} style={[styles.kind, kind === k.id && { borderColor: color.ink, backgroundColor: color.surface }]}>
                <Icon name={k.icon} size={20} stroke={kind === k.id ? color.ink : color.ink2} />
                <T weight="semibold" style={{ fontSize: 13 }}>{k.label}</T>
              </Pressable>
            ))}
          </View>
          <TextInput value={note} onChangeText={setNote} placeholder="What's wrong? (optional)" placeholderTextColor={color.muted} multiline maxLength={1000}
            style={styles.note} accessibilityLabel="Note" />
          <View>
            <Label style={{ marginBottom: 8 }}>How long will it last?</Label>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {DURATIONS.map(([id, label]) => (
                <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: duration === id }} onPress={() => setDuration(id)} style={[styles.dur, duration === id && { backgroundColor: color.ink, borderColor: color.ink }]}>
                  <T weight="semibold" style={{ fontSize: 13, color: duration === id ? '#fff' : color.ink2 }}>{label}</T>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={addPhoto} style={styles.photo}>
            {photo ? <Image source={{ uri: photo }} style={{ width: 56, height: 56, borderRadius: 10 }} accessibilityLabel="Attached photo" /> : <Icon name="camera" size={22} stroke={color.ink2} />}
            <T weight="semibold" style={{ flex: 1, fontSize: 14 }}>{photo ? 'Photo attached · tap to change' : 'Add a photo (optional)'}</T>
          </Pressable>
          <Notice tone="info" icon="shield" text="Your name goes with the report so the admin can ask you about it. It is never shown on the map." />
          {submit.isError && <Notice tone="missing" text={submit.error instanceof Error && submit.error.message !== 'offline' ? submit.error.message : 'Could not send. Check your connection.'} />}
          <Btn title="Send to the admin" kind="dark" disabled={!kind} loading={submit.isPending} onPress={() => submit.mutate()} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hintText: { flex: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#fff', ...shadow.float },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: color.line },
  note: { minHeight: 70, borderRadius: 12, backgroundColor: color.surface2, padding: 12, fontSize: 14, fontFamily: font.regular, color: color.ink, textAlignVertical: 'top' },
  dur: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  photo: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: color.line, borderStyle: 'dashed' },
  done: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' },
});
