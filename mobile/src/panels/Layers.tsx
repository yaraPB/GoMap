import React from 'react';
import { Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '../i18n';
import { useMap, type MapSkin, type MapStyle } from '../map/MapContext';
import { useApp } from '../state/app';
import { usePanels } from '../state/panels';
import { Icon, Label, Sheet, T } from '../ui/kit';
import { color, type IconName } from '../ui/theme';
import { ROLE_LOOK } from './Views';

const STYLES: { id: MapStyle; name: string; swatch: string[]; icon: IconName }[] = [
  { id: 'default', name: 'Map', swatch: ['#3E4C44', '#2B3150'], icon: 'map' },
  { id: 'satellite', name: 'Satellite', swatch: ['#3E4C44', '#6B7B5E'], icon: 'satellite' },
];
const SKINS: { id: MapSkin; name: string; sub: string; colors: string[]; icon: IconName }[] = [
  { id: 'campus', name: 'GoCampus', sub: 'The GoCampus look, following the campus clock', colors: ['#3E4C44', '#5B5068', '#2B3150'], icon: 'clock' },
  { id: 'day', name: 'Day', sub: 'Bright', colors: ['#EAF2FA', '#CFE3C4'], icon: 'sun' },
  { id: 'evening', name: 'Evening', sub: 'Golden hour', colors: ['#F9C78B', '#D9773F'], icon: 'sunset' },
];

/** Board 05: map style, time-of-day skin, layers, language and the demo view. */
export default function Layers() {
  const { pop, push } = usePanels();
  const map = useMap();
  const t = useT();
  const { user, lang, setLang } = useApp();
  const toggles: { key: keyof typeof map.layers; label: string; sub: string; icon: IconName }[] = [
    { key: 'crowding', label: 'Busy paths now', sub: 'Only busy paths are coloured; quiet ones stay as they are', icon: 'flame' },
    { key: 'threeD', label: '3D buildings', sub: 'See buildings rise from the map as you zoom in', icon: 'building' },
    { key: 'cars', label: 'Show where cars go', sub: 'Roads as a solid band, paths stay dotted', icon: 'car' },
    { key: 'access', label: 'Step-free view', sub: 'Paths by how easy they are on wheels: green gentle, amber ramp-steep, red steeper or stairs', icon: 'wheel' },
    { key: 'labels', label: 'Building labels', sub: 'Numbers on the pins up close', icon: 'pin' },
  ];
  const look = ROLE_LOOK[user.role] ?? ROLE_LOOK.student;
  // the map stays live above: watch the style change, tap the map when done
  const header = <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}><T weight="bold" style={{ fontSize: 18 }}>{t('Map style and layers')}</T></View>;
  return (
    <Sheet snaps={[0.66, 0.8]} onClose={pop} header={header}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 20 }}>
        <View>
          <Label style={{ marginBottom: 8 }}>{t('Map')}</Label>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {STYLES.map(s => {
              const on = map.style === s.id;
              return (
                <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => map.setStyle(s.id)} style={{ flex: 1, gap: 6 }}>
                  <View style={{ height: 64, borderRadius: 14, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? color.blue : color.line, flexDirection: 'row' }}>
                    {s.swatch.map(c => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}
                    <View style={{ position: 'absolute', top: 6, start: 6, width: 24, height: 24, borderRadius: 8, backgroundColor: '#ffffffd9', alignItems: 'center', justifyContent: 'center' }}><Icon name={s.icon} size={14} stroke={color.ink} /></View>
                  </View>
                  <T weight="semibold" style={{ fontSize: 13, textAlign: 'center', color: on ? color.blue : color.ink }}>{t(s.name)}</T>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>{t('Scene')}</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {SKINS.map(s => {
              const on = map.skin === s.id;
              return (
                <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: false }} accessibilityHint={t(s.sub)} onPress={() => map.setSkin(s.id)} style={{ flex: 1, gap: 6, opacity: 1 }}>
                  <View style={{ height: 52, borderRadius: 12, overflow: 'hidden', borderWidth: on ? 3 : 1, borderColor: on ? color.blue : color.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    {s.colors.map(c => <View key={c} style={{ flex: 1, alignSelf: 'stretch', backgroundColor: c }} />)}
                    <View style={{ position: 'absolute' }}><Icon name={s.icon} size={18} stroke={s.id === 'night' ? '#FFE2A8' : '#15171A'} /></View>
                  </View>
                  <T weight="semibold" style={{ fontSize: 12, textAlign: 'center', color: on ? color.blue : color.ink }}>{t(s.name)}</T>
                </Pressable>
              );
            })}
          </View>
          <T style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>{map.style === 'satellite' ? t('Satellite imagery with the selected time-of-day filter.') : t(SKINS.find(s => s.id === map.skin)?.sub ?? '')}</T>
        </View>

        <View>
          {toggles.map(tg => (
            <View key={tg.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
              <Icon name={tg.icon} size={20} stroke={color.ink2} />
              <View style={{ flex: 1 }}><T weight="semibold" style={{ fontSize: 15 }}>{t(tg.label)}</T><T style={{ fontSize: 12.5, color: color.muted }}>{tg.key === 'threeD' && map.style === 'satellite' ? t('Raised building preview over satellite imagery') : t(tg.sub)}</T></View>
              {/* react-native-web draws switches broken in right-to-left: keep them left-to-right there */}
              <View style={Platform.OS === 'web' ? { direction: 'ltr' } : undefined}><Switch accessibilityLabel={t(tg.label)} value={map.layers[tg.key]} onValueChange={v => map.setLayers({ [tg.key]: v })} trackColor={{ true: color.blue, false: '#D5D7D2' }} /></View>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={() => { pop(); push({ name: 'crowding' }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
            <Icon name="clock" size={20} stroke={color.ink2} />
            <View style={{ flex: 1 }}><T weight="semibold" style={{ fontSize: 15 }}>{t('Busy paths by hour')}</T><T style={{ fontSize: 12.5, color: color.muted }}>{t('Typical crowding for any day and hour')}</T></View>
            <Icon name="chevron" size={16} stroke={color.muted} />
          </Pressable>
        </View>

        <View>
          <Label style={{ marginBottom: 8 }}>{t('Language')}</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['en', 'English'], ['fr', 'Français'], ['ar', 'العربية']] as const).map(([id, name]) => (
              <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: lang === id }} onPress={() => setLang(id)} style={{ flex: 1, height: 40, borderRadius: 11, borderWidth: 1, borderColor: lang === id ? color.ink : color.line, backgroundColor: lang === id ? color.ink : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <T weight="semibold" style={{ color: lang === id ? '#fff' : color.ink, textAlign: 'center' }}>{name}</T>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Label>{t('View')}</Label>
          <Pressable accessibilityRole="button" onPress={() => { pop(); push({ name: 'views' }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: look.tint }}>
            <Icon name={look.icon} size={20} stroke={look.ink} />
            <T weight="semibold" style={{ flex: 1, color: look.ink }}>{t(look.title)}{user.role === 'faculty' ? ` · ${user.name}` : ''}</T>
            <T weight="semibold" style={{ color: look.ink, fontSize: 13 }}>{t('Switch')}</T>
          </Pressable>
          {user.role === 'faculty' && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/faculty-status')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#EEF4FF' }}>
              <Icon name="door" size={18} stroke={color.blue} /><T weight="semibold" style={{ flex: 1, color: color.blue }}>{t("I'm in / I'm away · set my status")}</T><Icon name="chevron" size={16} stroke={color.blue} />
            </Pressable>
          )}
        </View>
        <Pressable accessibilityRole="button" onPress={() => push({ name: 'help', step: 0 })} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 18, backgroundColor: '#E8F3EB' }}>
          <Icon name="map" stroke="#226348" size={22} />
          <View style={{ flex: 1 }}><T weight="semibold" style={{ color: '#226348' }}>{t('Take a quick tour')}</T><T style={{ color: '#617368', fontSize: 12, marginTop: 3 }}>{t('Try the map and meet your campus guide.')}</T></View>
          <Icon name="chevron" stroke="#226348" size={18} />
        </Pressable>
        <T style={{ fontSize: 11.5, color: color.muted }}>Map © Mapbox © OpenStreetMap</T>
      </ScrollView>
    </Sheet>
  );
}
