import React from 'react';
import { StyleSheet } from 'react-native';
import { BlurMask, Canvas, Circle, Group } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

/** Soft light behind the bars that swells with your voice (Skia, GPU-blurred). */
export default function Glow({ level }: { level: SharedValue<number> }) {
  const outer = useDerivedValue(() => 46 + level.value * 70);
  const inner = useDerivedValue(() => 22 + level.value * 38);
  const opacity = useDerivedValue(() => 0.45 + level.value * 0.55);
  return (
    <Canvas style={styles.canvas} pointerEvents="none">
      <Group opacity={opacity}>
        <Circle cx={170} cy={110} r={outer} color="rgba(37,99,235,0.42)"><BlurMask blur={38} style="normal" /></Circle>
        <Circle cx={170} cy={110} r={inner} color="rgba(111,160,242,0.45)"><BlurMask blur={22} style="normal" /></Circle>
      </Group>
    </Canvas>
  );
}
const styles = StyleSheet.create({ canvas: { position: 'absolute', width: 340, height: 220, top: -50 } });
