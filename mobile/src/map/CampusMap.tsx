import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useMap, type MapEvent } from './MapContext';
import { mapHtml } from './mapHtml';

// WebView 14's combined platform declaration resolves its props to never under RN 0.88.
const MapWebView = WebView as unknown as React.ComponentType<any>;

export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

export default function CampusMap({ flyIn }: { flyIn: boolean }) {
  const map = useMap();
  const web = useRef<{ injectJavaScript: (s: string) => void } | null>(null);
  const html = useMemo(() => (MAPBOX_TOKEN.startsWith('pk.') ? mapHtml(MAPBOX_TOKEN, { flyIn }) : ''), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!MAPBOX_TOKEN.startsWith('pk.')) map._emit({ type: 'error', detail: 'The map isn’t connected yet. Please ask the person setting up GoMap to finish connecting it.' });
    map._attach(msg => web.current?.injectJavaScript(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}));true;`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = (e: WebViewMessageEvent) => {
    try { map._emit(JSON.parse(e.nativeEvent.data) as MapEvent); } catch { /* ignore */ }
  };

  if (!html) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#3E4C44' }]} />;
  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel="Campus map">
      <MapWebView ref={web} style={{ flex: 1, backgroundColor: '#3E4C44' }} originWhitelist={['*']}
        source={{ html, baseUrl: 'https://api.mapbox.com/' }} javaScriptEnabled domStorageEnabled onMessage={onMessage}
        androidLayerType="hardware" scrollEnabled={false} overScrollMode="never" bounces={false}
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        onError={() => map._emit({ type: 'error', detail: 'The map view could not load.' })}
        onRenderProcessGone={() => map._emit({ type: 'error', detail: 'The map view stopped. Reopen the app.' })} />
    </View>
  );
}
