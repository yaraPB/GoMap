import React from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useMap, type MapStyle } from '../map/MapContext';
import { USERS, useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, IconBtn, Label, Sheet, T } from '../ui/kit';
import { color, type IconName } from '../ui/theme';
import { SPEECH_ENGINE } from '../voice/useSpeech';

const STYLES: { id: MapStyle; name: string; swatch: string[] }[] = [
  { id: 'default', name: 'Default', swatch: ['#E9E5DA', '#CFE3C4'] },
  { id: 'satellite', name: 'Satellite', swatch: ['#3E4C44', '#6B7B5E'] },
  { id: 'contrast', name: 'High contrast', swatch: ['#FFFFFF', '#15171A'] },
];

/** Board 05: map style and layers (+ the demo account switcher until SSO). */
export default function Layers() {
  const { pop, push } = usePanels();
  const map = useMap();
  const { user, setUser, lang, setLang } = useApp();
  const toggles: { key: keyof typeof map.layers; label: string; sub: string; icon: IconName }[] = [
    { key: 'threeD', label: '3D buildings', sub: 'Extruded buildings at walking zoom', icon: 'building' },
    { key: 'cars', label: 'Show where cars go', sub: 'Roads as a solid band, paths stay dotted', icon: 'car' },
    { key: 'labels', label: 'Building labels', sub: 'Numbers on the pins up close', icon: 'pin' },
  ];
  const header = <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 }}><T weight="bold" style={{ flex: 1, fontSize: 18 }}>Map style and layers</T><IconBtn icon="close" label="Close" onPress={pop} float={false} bg={color.surface} size={34} /></View>;
  return (
    <Sheet snaps={[0.62, 0.92]} onClose={pop} header={header}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {STYLES.map(s => (
            <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: map.style === s.id }} onPress={() => map.setStyle(s.id)} style={{ flex: 1, gap: 6 }}>
              <View style={{ height: 70, borderRadius: 14, overflow: 'hidden', borderWidth: map.style === s.id ? 3 : 1, borderColor: map.style === s.id ? color.blue : color.line, flexDirection: 'row' }}>
                {s.swatch.map(c => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
              </View>
              <T weight="semibold" style={{ fontSize: 13, textAlign: 'center', color: map.style === s.id ? color.blue : color.ink }}>{s.name}</T>
            </Pressable>
          ))}
        </View>
        <View>
          {toggles.map(t => (
            <View key={t.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
              <Icon name={t.icon} size={20} stroke={color.ink2} />
              <View style={{ flex: 1 }}><T weight="semibold" style={{ fontSize: 15 }}>{t.label}</T><T style={{ fontSize: 12.5, color: color.muted }}>{t.sub}</T></View>
              <Switch accessibilityLabel={t.label} value={map.layers[t.key]} onValueChange={v => map.setLayers({ [t.key]: v })} trackColor={{ true: color.blue, false: '#D5D7D2' }} />
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => { pop(); push({ name: 'crowding' }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
            <Icon name="flame" size={20} stroke={color.ink2} />
            <View style={{ flex: 1 }}><T weight="semibold" style={{ fontSize: 15 }}>Crowding</T><T style={{ fontSize: 12.5, color: color.muted }}>Busy walkways by hour, historic</T></View>
            <Icon name="chevron" size={16} stroke={color.muted} />
          </Pressable>
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>Language</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']] as const).map(([id, name]) => (
              <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: lang === id }} onPress={() => setLang(id)} style={{ flex: 1, height: 40, borderRadius: 11, borderWidth: 1, borderColor: lang === id ? color.ink : color.line, backgroundColor: lang === id ? color.ink : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <T weight="semibold" style={{ color: lang === id ? '#fff' : color.ink }}>{name}</T>
              </Pressable>
            ))}
          </View>
          {lang !== 'en' && <T style={{ fontSize: 12, color: color.warnText, marginTop: 6 }}>Translation under review: the assistant and map controls switch; most screens are English for now.</T>}
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>Demo account · until GoCampus sign-in</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {USERS.map(u => (
              <Pressable key={u.id} accessibilityRole="radio" accessibilityState={{ selected: user.id === u.id }} onPress={() => setUser(u)} style={{ paddingHorizontal: 12, height: 36, borderRadius: 999, borderWidth: 1, borderColor: user.id === u.id ? color.blue : color.line, backgroundColor: user.id === u.id ? '#EEF4FF' : '#fff', justifyContent: 'center' }}>
                <T weight="semibold" style={{ fontSize: 13, color: user.id === u.id ? color.blue : color.ink }}>{u.role === 'faculty' ? `Faculty (${u.name})` : u.role[0].toUpperCase() + u.role.slice(1)}</T>
              </Pressable>
            ))}
          </View>
          {user.role === 'faculty' && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/faculty-status')} style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, backgroundColor: '#EEF4FF' }}>
              <Icon name="user" size={18} stroke={color.blue} /><T weight="semibold" style={{ flex: 1, color: color.blue }}>I'm in / I'm out · set today's status</T><Icon name="chevron" size={16} stroke={color.blue} />
            </Pressable>
          )}
        </View>
        <T style={{ fontSize: 11.5, color: color.muted }}>Voice: {SPEECH_ENGINE === 'native' ? 'on-device recognition' : 'recorded and transcribed by the server (Expo Go)'} · Map © Mapbox © OpenStreetMap</T>
      </ScrollView>
    </Sheet>
  );
}
