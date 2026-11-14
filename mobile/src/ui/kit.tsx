import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeInDown, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, icons, shadow, status as statusColors, type IconName } from './theme';

const ARABIC = /[؀-ۿ]/;

export function Icon({ name, size = 20, stroke = color.ink, width = 2, fill = 'none' }: { name: IconName; size?: number; stroke?: string; width?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
      {...(Platform.OS === 'web' ? { 'aria-hidden': true } : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}>
      <Path d={icons[name]} />
    </Svg>
  );
}

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
export function T({ style, weight = 'regular', children, ...rest }: TextProps & { weight?: Weight }) {
  const text = typeof children === 'string' ? children : Array.isArray(children) ? children.filter(c => typeof c === 'string').join('') : '';
  const arabic = ARABIC.test(text);
  const family = arabic ? (weight === 'bold' || weight === 'semibold' ? font.arabicBold : font.arabic) : font[weight];
  return <Text {...rest} style={[{ fontFamily: family, color: color.ink }, arabic && { writingDirection: 'rtl' }, style]}>{children}</Text>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <T weight="bold" style={[s.label, style]}>{children}</T>;
}

type BtnProps = Omit<PressableProps, 'style'> & { title: string; icon?: IconName; kind?: 'primary' | 'secondary' | 'dark' | 'ghost' | 'green'; loading?: boolean; style?: StyleProp<ViewStyle>; small?: boolean };
export function Btn({ title, icon, kind = 'primary', loading, style, small, disabled, ...rest }: BtnProps) {
  const bg = { primary: color.blue, secondary: color.panel, dark: color.ink, ghost: 'transparent', green: color.greenDeep }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? color.ink : '#fff';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || loading} {...rest}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg }, kind === 'secondary' && s.btnLine, (disabled || loading) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>
        {icon && <Icon name={icon} size={small ? 16 : 18} stroke={fg} />}
        <T weight="semibold" style={{ color: fg, fontSize: small ? 13 : 15 }}>{title}</T>
      </>}
    </Pressable>
  );
}

export function IconBtn({ icon, label, onPress, size = 44, bg = color.panel, stroke = color.ink, style, float = true, iconSize }: { icon: IconName; label: string; onPress?: () => void; size?: number; bg?: string; stroke?: string; style?: StyleProp<ViewStyle>; float?: boolean; iconSize?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, float && shadow.float, pressed && { transform: [{ scale: 0.94 }] }, style]}>
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.42)} stroke={stroke} />
    </Pressable>
  );
}

export function Chip({ label, icon, active, activeColor = color.ink, onPress, small, light }: { label: string; icon?: IconName; active?: boolean; activeColor?: string; onPress?: () => void; small?: boolean; light?: boolean }) {
  const fg = active ? '#fff' : color.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress}
      style={({ pressed }) => [small ? s.chipSmall : s.chip, { backgroundColor: active ? activeColor : light ? 'rgba(255,255,255,0.92)' : color.panel }, !light && shadow.float, light && !active && s.chipLightBorder, pressed && { transform: [{ scale: 0.96 }] }]}>
      {icon && <Icon name={icon} size={16} stroke={fg} />}
      <T weight="semibold" style={{ color: fg, fontSize: small ? 12.5 : 14 }}>{label}</T>
    </Pressable>
  );
}

export function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
      style={[s.filter, active ? { backgroundColor: color.ink, borderColor: color.ink } : null]}>
      <T weight="semibold" style={{ fontSize: 13, color: active ? '#fff' : color.ink2 }}>{label}</T>
    </Pressable>
  );
}

export type Tone = keyof typeof statusColors;
export function StatusPill({ tone, text, dot = true, style }: { tone: Tone; text: string; dot?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = statusColors[tone];
  return (
    <View style={[s.pill, { backgroundColor: c.bg }, style]}>
      {dot && <View style={[s.dot, { backgroundColor: c.fg }]} />}
      <T weight="semibold" style={{ fontSize: 12, color: c.fg }}>{text}</T>
    </View>
  );
}
export function Tag({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.pill, { backgroundColor: color.surface }, style]}><T weight="semibold" style={{ fontSize: 12, color: color.ink2 }}>{text}</T></View>;
}

export function Notice({ text, tone = 'warn', icon = 'warn', action, onAction }: { text: string; tone?: 'warn' | 'missing' | 'info'; icon?: IconName; action?: string; onAction?: () => void }) {
  const palette = tone === 'missing' ? { bg: statusColors.missing.bg, line: '#F5C9C4', fg: statusColors.missing.fg } : tone === 'info' ? { bg: '#EEF4FF', line: '#CFDDFB', fg: '#1E3A8A' } : { bg: color.warnBg, line: color.warnLine, fg: color.warnText };
  return (
    <View style={[s.notice, { backgroundColor: palette.bg, borderColor: palette.line }]} accessibilityRole="text">
      <Icon name={icon} size={18} stroke={palette.fg} />
      <T style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: palette.fg }}>{text}</T>
      {action && <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}><T weight="bold" style={{ fontSize: 12.5, color: palette.fg, textDecorationLine: 'underline' }}>{action}</T></Pressable>}
    </View>
  );
}

export function Avatar({ name, tone = 'closed', size = 40 }: { name: string; tone?: Tone; size?: number }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const c = statusColors[tone];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><T weight="bold" style={{ fontSize: size * 0.32, color: c.fg }}>{initials}</T></View>;
}

export function Provenance({ text, onReport }: { text: string; onReport?: () => void }) {
  return (
    <View style={s.prov}>
      <Icon name="shield" size={16} stroke={color.muted} />
      <T style={{ flex: 1, fontSize: 11.5, lineHeight: 16, color: color.muted }}>{text}</T>
      {onReport && <Pressable accessibilityRole="button" onPress={onReport} hitSlop={8}><T weight="semibold" style={{ fontSize: 12, color: color.blue }}>Report</T></Pressable>}
    </View>
  );
}

/** "rise": sheets and banners entering. */
export const rise = FadeInDown.duration(460).easing(Easing.bezier(0.2, 0.8, 0.2, 1));

/**
 * Bottom sheet with snap points (fractions of screen height). Drag the handle area to move it;
 * flick down from the lowest snap to dismiss. Content scrolls normally inside.
 */
export function Sheet({ snaps = [0.5, 0.9], initial = 0, onClose, children, header, dark, style, index, onIndexChange }: {
  snaps?: number[]; initial?: number; onClose?: () => void; children: React.ReactNode; header?: React.ReactNode; dark?: boolean;
  style?: StyleProp<ViewStyle>; index?: number; onIndexChange?: (i: number) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heights = snaps.map(f => Math.round(height * f));
  const max = heights[heights.length - 1];
  const y = useSharedValue(max);
  const start = useSharedValue(0);
  const snapTo = (i: number) => { 'worklet'; y.value = withSpring(max - heights[i], { damping: 22, stiffness: 220, mass: 0.8 }); };
  useEffect(() => { snapTo(index ?? initial); }, [index, height]);
  const notifyIndex = (i: number) => onIndexChange?.(i);
  const close = () => onClose?.();
  const pan = Gesture.Pan()
    .onStart(() => { start.value = y.value; })
    .onUpdate(e => { y.value = Math.max(0, start.value + e.translationY); })
    .onEnd(e => {
      const current = max - y.value;
      const projected = current - e.velocityY * 0.18;
      if (onClose && projected < heights[0] * 0.55) { y.value = withTiming(max, { duration: 200 }); runOnJS(close)(); return; }
      let best = 0;
      heights.forEach((h, i) => { if (Math.abs(h - projected) < Math.abs(heights[best] - projected)) best = i; });
      snapTo(best);
      runOnJS(notifyIndex)(best);
    });
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[s.sheet, { height: max, paddingBottom: insets.bottom }, dark && { backgroundColor: '#14171C' }, anim, style]}>
      <GestureDetector gesture={pan}>
        <View accessible accessibilityRole="adjustable" accessibilityLabel="Sheet handle. Drag to resize." style={{ paddingTop: 10 }}>
          <View style={[s.handle, dark && { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
          {header}
        </View>
      </GestureDetector>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}

export function Empty({ icon = 'search', title, body, action, onAction }: { icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: 'center', padding: 28, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={24} stroke={color.muted} /></View>
      <T weight="semibold" style={{ fontSize: 16, textAlign: 'center' }}>{title}</T>
      {body && <T style={{ fontSize: 13.5, color: color.muted, textAlign: 'center', lineHeight: 19 }}>{body}</T>}
      {action && <Btn title={action} kind="secondary" small onPress={onAction} style={{ marginTop: 6 }} />}
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <View style={{ padding: 28, alignItems: 'center' }} accessibilityLabel={label}><ActivityIndicator color={color.muted} /></View>;
}

export const s = StyleSheet.create({
  label: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: color.muted },
  btn: { height: 50, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { height: 38, borderRadius: 11, paddingHorizontal: 12 },
  btnLine: { borderWidth: 1, borderColor: color.line },
  chip: { height: 44, paddingHorizontal: 16, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipSmall: { height: 34, paddingHorizontal: 13, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipLightBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  filter: { height: 34, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: '#E2E3DE', backgroundColor: color.panel, justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 11, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  notice: { flexDirection: 'row', gap: 10, padding: 13, borderRadius: 12, borderWidth: 1, alignItems: 'flex-start' },
  prov: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: color.hairline },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, ...shadow.sheet },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: '#D5D7D2', marginBottom: 8 },
});
