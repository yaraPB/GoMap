import React from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/** Web version of the glow: Skia on web needs CanvasKit, a CSS blur does the same job. */
export default function Glow({ level }: { level: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + level.value * 0.9 }], opacity: 0.45 + level.value * 0.55 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(37,99,235,0.45)', filter: 'blur(34px)' } as object, style]} />
  );
}
