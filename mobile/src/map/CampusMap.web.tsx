import React, { createElement, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMap, type MapEvent } from './MapContext';
import { mapHtml } from './mapHtml';

export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

export default function CampusMap({ flyIn }: { flyIn: boolean }) {
  const map = useMap();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => (MAPBOX_TOKEN.startsWith('pk.') ? mapHtml(MAPBOX_TOKEN, { flyIn }) : ''), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!MAPBOX_TOKEN.startsWith('pk.')) map._emit({ type: 'error', detail: 'Set EXPO_PUBLIC_MAPBOX_TOKEN to a Mapbox public token in mobile/.env.local.' });
    map._attach(msg => frame.current?.contentWindow?.postMessage(msg, '*'));
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      try { map._emit(JSON.parse(e.data) as MapEvent); } catch { /* ignore */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#3E4C44' }]}>
      {!!html && createElement('iframe', { ref: frame, srcDoc: html, title: 'Campus map', style: { border: 0, width: '100%', height: '100%' }, allow: 'geolocation' })}
    </View>
  );
}
