import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { campus3dHtml } from './campus3dHtml';

// WebView 14's combined platform declaration resolves its props to never under RN 0.88.
const PageView = WebView as unknown as React.ComponentType<any>;

/** Google Map Tiles API key (Photorealistic 3D Tiles). Without it the 3D view is not offered. */
export const GOOGLE_3D_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAP_TILES_KEY || '';
export const has3D = () => GOOGLE_3D_KEY.length > 10;

export type Campus3DEvent = { type: 'ready' | 'select' | 'tapMap' | 'error'; detail: unknown };
export type Campus3DHandle = { send: (msg: Record<string, unknown>) => void };

/** The photorealistic 3D page (campus3dHtml) in a WebView, with the same JSON bridge as the 2D map. */
const Campus3D = forwardRef<Campus3DHandle, { onEvent: (e: Campus3DEvent) => void }>(function Campus3D({ onEvent }, ref) {
  const web = useRef<{ injectJavaScript: (s: string) => void } | null>(null);
  const html = useMemo(() => campus3dHtml(GOOGLE_3D_KEY), []);
  useImperativeHandle(ref, () => ({
    send: msg => web.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`),
  }), []);
  const onMessage = (e: WebViewMessageEvent) => { try { onEvent(JSON.parse(e.nativeEvent.data) as Campus3DEvent); } catch { /* ignore */ } };
  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel="Campus in 3D">
      <PageView ref={web} style={{ flex: 1, backgroundColor: '#14211b' }} originWhitelist={['*']}
        source={{ html, baseUrl: 'https://cesium.com/' }} javaScriptEnabled domStorageEnabled onMessage={onMessage}
        androidLayerType="hardware" scrollEnabled={false} overScrollMode="never" bounces={false}
        onError={() => onEvent({ type: 'error', detail: 'The 3D view could not load.' })}
        onRenderProcessGone={() => onEvent({ type: 'error', detail: 'The 3D view stopped.' })} />
    </View>
  );
});
export default Campus3D;
