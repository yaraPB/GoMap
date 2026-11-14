import React, { useEffect, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

export type WaveMode = 'idle' | 'listening' | 'thinking' | 'speaking';

const N = 44;           // history samples, newest in the middle
const HEIGHT = 150;
const YOU = ['#22D3EE', '#3B82F6', '#8B5CF6', '#EC4899', '#8B5CF6', '#3B82F6', '#22D3EE'];
const GOMAP = ['#34D399', '#22D3EE', '#3B82F6', '#A78BFA', '#3B82F6', '#22D3EE', '#34D399'];

/**
 * Live voice ribbon. Every frame the current loudness enters at the centre and the past spreads
 * outwards, so what you see is literally your last second and a half of speech. Two thin carrier
 * lines ride on top. Touch it and it ripples. When GoMap answers, the same ribbon follows its
 * voice in green-blue; while thinking it settles into a travelling shimmer.
 */
export default function Waveform({ level, mode, reduceMotion = false }: { level: number; mode: WaveMode; reduceMotion?: boolean }) {
  const [w, setW] = useState(320);
  const target = useSharedValue(0);
  const smooth = useSharedValue(0);
  const hist = useSharedValue<number[]>(new Array(N).fill(0));
  const clock = useSharedValue(0);
  const think = useSharedValue(0);
  const answer = useSharedValue(0);
  const touchX = useSharedValue(-1);
  const pluck = useSharedValue(0);
  const last = useSharedValue(0);

  useEffect(() => { target.value = level; }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    think.value = withTiming(mode === 'thinking' ? 1 : 0, { duration: 350 });
    answer.value = withTiming(mode === 'speaking' ? 1 : 0, { duration: 350 });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrameCallback(f => {
    clock.value = f.timeSinceFirstFrame;
    // fast attack, slow release: syllables pop, silence settles
    const t = target.value * (1 - think.value);
    smooth.value += (t - smooth.value) * (t > smooth.value ? 0.45 : 0.12);
    pluck.value *= 0.94;
    if (f.timeSinceFirstFrame - last.value > 32) {
      last.value = f.timeSinceFirstFrame;
      const next = hist.value.slice(1);
      next.push(smooth.value);
      hist.value = next;
    }
  }, true);

  const mid = HEIGHT / 2;
  const ribbon = useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const half = w / 2;
    const step = half / (N - 1);
    const t = clock.value / 1000;
    const amp = (k: number) => {
      // k = 0 at the centre (now) … N-1 at the edges (1.5 s ago)
      const edge = Math.pow(Math.sin(((N - 1 - k) / (N - 1)) * (Math.PI / 2)), 0.8);
      const idle = reduceMotion ? 0.02 : 0.025 + 0.02 * Math.sin(t * 2 + k * 0.5);
      const shimmer = think.value * (reduceMotion ? 0.04 : 0.05 + 0.05 * Math.max(0, Math.sin(t * 6 - k * 0.35)));
      return (Math.max(idle, hist.value[N - 1 - k]) + shimmer) * edge * (HEIGHT * 0.44);
    };
    const bump = (x: number) => (touchX.value < 0 ? 0 : pluck.value * HEIGHT * 0.25 * Math.exp(-Math.pow((x - touchX.value) / 38, 2)));
    const pts: [number, number][] = [];
    for (let k = N - 1; k >= 0; k--) { const x = half - k * step; pts.push([x, amp(k) + bump(x)]); }
    for (let k = 1; k < N; k++) { const x = half + k * step; pts.push([x, amp(k) + bump(x)]); }
    // top edge, smoothed through midpoints
    p.moveTo(pts[0][0], mid - pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, a0] = pts[i - 1], [x1, a1] = pts[i];
      p.quadTo(x0, mid - a0, (x0 + x1) / 2, mid - (a0 + a1) / 2);
    }
    p.lineTo(pts[pts.length - 1][0], mid);
    // bottom edge, a little shorter so the ribbon has weight
    for (let i = pts.length - 1; i > 0; i--) {
      const [x0, a0] = pts[i], [x1, a1] = pts[i - 1];
      p.quadTo(x0, mid + a0 * 0.78, (x0 + x1) / 2, mid + ((a0 + a1) / 2) * 0.78);
    }
    p.close();
    return p.detach();
  });

  const useCarrier = (freq: number, speed: number, scale: number) => useDerivedValue(() => {
    const p = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    const a = (0.08 + smooth.value * 0.9 + think.value * 0.1) * HEIGHT * 0.32 * scale;
    for (let x = 0; x <= w; x += 6) {
      const env = Math.sin((x / w) * Math.PI);
      const y = mid + Math.sin(x * freq + t * speed * (reduceMotion ? 0 : 1)) * a * env * env;
      if (x === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    return p.detach();
  });
  const lineA = useCarrier(0.035, 5.5, 1);
  const lineB = useCarrier(0.052, -4.2, 0.7);

  const youOpacity = useDerivedValue(() => 1 - answer.value);
  const glow = useDerivedValue(() => { const p = Skia.PathBuilder.Make(); p.addCircle(w / 2, mid, 30 + smooth.value * 70); return p.detach(); });
  const glowOpacity = useDerivedValue(() => 0.35 + smooth.value * 0.5);

  const touch = (e: GestureResponderEvent) => { touchX.value = e.nativeEvent.locationX; pluck.value = 1; };
  const grad = (colors: string[]) => <LinearGradient start={vec(0, 0)} end={vec(w, 0)} colors={colors} />;

  return (
    <View style={{ height: HEIGHT, width: '100%' }} onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => true} onResponderGrant={touch} onResponderMove={touch}
      accessibilityRole="progressbar" accessibilityLabel={mode === 'thinking' ? 'Working on your question' : mode === 'speaking' ? 'GoMap is answering' : 'Your voice level'}>
      <Canvas style={{ width: w, height: HEIGHT }} pointerEvents="none">
        <Group opacity={glowOpacity}>
          <Path path={glow} color={mode === 'speaking' ? 'rgba(52,211,153,0.35)' : 'rgba(59,130,246,0.38)'}>
            <BlurMask blur={40} style="normal" />
          </Path>
        </Group>
        <Group opacity={youOpacity}>
          <Path path={ribbon} opacity={0.92}>{grad(YOU)}</Path>
          <Path path={lineA} style="stroke" strokeWidth={2} opacity={0.75}>{grad(YOU)}</Path>
          <Path path={lineB} style="stroke" strokeWidth={1.5} opacity={0.5}>{grad(YOU)}</Path>
        </Group>
        <Group opacity={answer}>
          <Path path={ribbon} opacity={0.92}>{grad(GOMAP)}</Path>
          <Path path={lineA} style="stroke" strokeWidth={2} opacity={0.75}>{grad(GOMAP)}</Path>
        </Group>
      </Canvas>
    </View>
  );
}
