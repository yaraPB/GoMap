import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export type WaveMode = 'idle' | 'listening' | 'thinking' | 'speaking';

const N = 31; // odd: one centre bar
const YOU = ['#22D3EE', '#3B82F6', '#8B5CF6', '#EC4899'];
const GOMAP = ['#34D399', '#22D3EE', '#3B82F6', '#A78BFA'];

function mix(a: string, b: string, t: number) {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t)).join(',')})`;
}
const paletteAt = (pal: string[], t: number) => { const x = t * (pal.length - 1), i = Math.min(pal.length - 2, Math.floor(x)); return mix(pal[i], pal[i + 1], x - i); };

/** Web version of the voice ribbon (no Skia on web): gradient bars, newest loudness in the middle. */
export default function Waveform({ level, mode, reduceMotion = false }: { level: number; mode: WaveMode; reduceMotion?: boolean }) {
  const [hist, setHist] = useState<number[]>(() => new Array((N + 1) / 2).fill(0));
  const target = useRef(level);
  const smooth = useRef(0);
  target.current = mode === 'thinking' ? 0 : level;
  useEffect(() => {
    let raf = 0, last = 0, t0 = performance.now();
    const loop = (now: number) => {
      const tgt = target.current;
      smooth.current += (tgt - smooth.current) * (tgt > smooth.current ? 0.45 : 0.12);
      if (now - last > 40) {
        last = now;
        const t = (now - t0) / 1000;
        const idle = reduceMotion ? 0.03 : 0.03 + 0.02 * Math.sin(t * 2);
        const shimmer = mode === 'thinking' && !reduceMotion ? 0.08 * Math.max(0, Math.sin(t * 6)) : 0;
        setHist(h => [Math.max(idle, smooth.current) + shimmer, ...h.slice(0, -1)]);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, reduceMotion]);
  const pal = mode === 'speaking' ? GOMAP : YOU;
  return (
    <View style={{ height: 150, width: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}
      accessibilityRole="progressbar" accessibilityLabel={mode === 'thinking' ? 'Working on your question' : 'Voice level'}>
      {Array.from({ length: N }, (_, i) => {
        const k = Math.abs(i - (N - 1) / 2);
        const edge = Math.pow(Math.cos((k / ((N - 1) / 2)) * (Math.PI / 2)), 0.6);
        const h = 6 + hist[k] * edge * 120;
        return <View key={i} style={{ width: 5, height: h, borderRadius: 3, backgroundColor: paletteAt(pal, i / (N - 1)), opacity: 0.55 + 0.45 * edge }} />;
      })}
    </View>
  );
}
