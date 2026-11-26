import React, { createElement, forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { campus3dHtml } from './campus3dHtml';

/** Google Map Tiles API key (Photorealistic 3D Tiles). Without it the 3D view is not offered. */
export const GOOGLE_3D_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAP_TILES_KEY || '';
export const has3D = () => GOOGLE_3D_KEY.length > 10;

export type Campus3DEvent = { type: 'ready' | 'select' | 'tapMap' | 'error'; detail: unknown };
export type Campus3DHandle = { send: (msg: Record<string, unknown>) => void };

/** Web: the same 3D page in an iframe, talking through postMessage. */
const Campus3D = forwardRef<Campus3DHandle, { onEvent: (e: Campus3DEvent) => void }>(function Campus3D({ onEvent }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => campus3dHtml(GOOGLE_3D_KEY), []);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useImperativeHandle(ref, () => ({ send: msg => frame.current?.contentWindow?.postMessage(JSON.stringify(msg), '*') }), []);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      try { handler.current(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#14211b' }]}>
      {createElement('iframe', { ref: frame, srcDoc: html, title: 'Campus in 3D', style: { border: 0, width: '100%', height: '100%' } })}
    </View>
  );
});
export default Campus3D;
