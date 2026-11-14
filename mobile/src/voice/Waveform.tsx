import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Glow from './Glow';

/** Bar envelope from design board 12: taller in the middle, so speech reads as a shape, not noise. */
const H = [14, 26, 42, 30, 58, 70, 46, 64, 34, 22, 38, 56, 72, 50, 30, 44, 24, 16, 12];
export type WaveMode = 'idle' | 'listening' | 'thinking';

function Bar({ i, level, clock, mode, reduce }: { i: number; level: SharedValue<number>; clock: SharedValue<number>; mode: SharedValue<number>; reduce: boolean }) {
  const strong = H[i] > 40;
  // each bar follows the signal on its own spring, so the wave has depth rather than moving as one block
  const target = useDerivedValue(() => {
    const t = clock.value / 1000;
    const l = level.value;
    if (mode.value > 0.5) return 0.1; // thinking: collapse into a line
    const travel = reduce ? 1 : 0.55 + 0.45 * Math.sin(t * 7 - i * 0.62); // speech flows left → right
    const breathe = reduce ? 0 : 0.06 * (1 + Math.sin(t * 2.2 + i * 0.9));  // idle shimmer so it never looks frozen
    return Math.min(1, 0.16 + breathe + l * travel * 0.95);
  });
  const sy = useSharedValue(0.16);
  useAnimatedReaction(() => target.value, v => { sy.value = withSpring(v, { damping: 14, stiffness: 260, mass: 0.5 }); });
  const style = useAnimatedStyle(() => {
    const t = clock.value / 1000;
    const shimmer = mode.value > 0.5 && !reduce ? 0.35 + 0.65 * Math.max(0, Math.sin(t * 5 - i * 0.45)) : 1;
    return { transform: [{ scaleY: sy.value }], opacity: shimmer };
  });
  return <Animated.View style={[{ width: 5, height: H[i], borderRadius: 999, backgroundColor: strong ? '#4F8BF0' : 'rgba(255,255,255,0.38)' }, style]} />;
}

/**
 * Live voice waveform. `level` is the mic level 0–1 (native volume events or recorder metering),
 * smoothed here; `mode` switches between listening and the "thinking" shimmer after release.
 */
export default function Waveform({ level, mode, reduceMotion = false }: { level: number; mode: WaveMode; reduceMotion?: boolean }) {
  const smooth = useSharedValue(0);
  const clock = useSharedValue(0);
  const modeV = useSharedValue(0);
  useFrameCallback(f => { clock.value = f.timeSinceFirstFrame; }, true);
  useEffect(() => {
    // fast attack, slower release: words pop, silence settles
    smooth.value = level > smooth.value ? withTiming(level, { duration: 60 }) : withTiming(level, { duration: 260 });
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { modeV.value = withTiming(mode === 'thinking' ? 1 : 0, { duration: 300 }); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={mode === 'thinking' ? 'Working on your question' : 'Voice level'} accessibilityRole="progressbar">
      <Glow level={smooth} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 76 }}>
        {H.map((_, i) => <Bar key={i} i={i} level={smooth} clock={clock} mode={modeV} reduce={reduceMotion} />)}
      </View>
    </View>
  );
}
