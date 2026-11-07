import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Place } from './api';

// WebView 14's combined platform declaration resolves its props to never under RN 0.88.
const MapWebView = WebView as unknown as React.ComponentType<any>;

type Props = {
  places: Place[]; category: string; focusPlaceId: string | null;
  resetToken: number; tiltToken: number; onSelect: (id: string) => void;
  onMapError: (message: string) => void; onMapReady: () => void;
};
const center = [-5.1059, 33.5396];
const colors: Record<string, string> = {
  'Dining Services': '#db686b', Residential: '#dc8500', Facilities: '#6c7a8c',
  'Campus Services': '#119d97', Academic: '#3269d5', Administrative: '#6650dd',
  'Athletics & Recreation': '#1da853',
};
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function htmlForPlaces(places: Place[], token: string) {
  const pins = places.map(place => ({
    id: place.id, name: place.name, category: place.category,
    xy: [place.longitude, place.latitude], color: colors[place.category] || '#138c67',
  }));
  return `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css" rel="stylesheet" />
    <style>
      html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#e4ede8}
      .pin{width:32px;height:32px;border:3px solid #fff;border-radius:50%;background:var(--pin);box-shadow:0 2px 9px #0008;cursor:pointer;padding:0}
      .pin:after{content:'';display:block;width:8px;height:8px;background:#fff;border-radius:50%;margin:auto}
      .mapboxgl-ctrl-attrib{font:10px Arial,sans-serif!important}
    </style>
    <script src="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js"></script>
    </head><body><div id="map" role="img" aria-label="Interactive campus map"></div>
    <script>
      (function(){
        var send=function(type,detail){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:type,detail:detail||''}));};
        if(!window.mapboxgl||!window.mapboxgl.supported()){send('error','Mapbox needs WebGL support on this device.');return;}
        var data=${inlineJson(pins)}, token=${inlineJson(token)}, markers=[], ready=false;
        try {
          var map=new window.mapboxgl.Map({container:'map',accessToken:token,style:'mapbox://styles/mapbox/streets-v12',
            center:${inlineJson(center)},zoom:16.5,pitch:45,bearing:-23,attributionControl:true});
          data.forEach(function(place){
            var element=document.createElement('button');element.className='pin';element.style.setProperty('--pin',place.color);
            element.setAttribute('aria-label',place.name+' (sample pin)');
            element.onclick=function(){send('select',place.id);};
            var marker=new window.mapboxgl.Marker({element:element}).setLngLat(place.xy).addTo(map);
            markers.push({marker:marker,category:place.category});
          });
          window.gomap={
            focus:function(id){var p=data.find(function(item){return item.id===id;});if(p)map.flyTo({center:p.xy,zoom:17.5,pitch:45,offset:[0,-120],duration:550});},
            filter:function(category){markers.forEach(function(item){item.marker.getElement().style.display=category==='All'||category===item.category?'':'none';});},
            reset:function(){map.flyTo({center:${inlineJson(center)},zoom:16.5,pitch:45,bearing:-23,duration:500});},
            tilt:function(){map.easeTo({pitch:map.getPitch()>10?0:45,duration:500});}
          };
          map.on('load',function(){ready=true;send('ready');});
          map.on('error',function(event){if(!ready)send('error',event&&event.error&&event.error.message||'Mapbox tiles could not load. Check the token and internet access.');});
          setTimeout(function(){if(!ready)send('error','Mapbox did not load. Check the token and internet access.');},15000);
        }catch(error){send('error',String(error));}
      })();
    </script></body></html>`;
}

export default function CampusMap({ places, category, focusPlaceId, resetToken, tiltToken, onSelect, onMapError, onMapReady }: Props) {
  const web = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
  const html = useMemo(() => token ? htmlForPlaces(places, token) : '', [places, token]);
  const run = (script: string) => web.current?.injectJavaScript(`${script};true;`);
  useEffect(() => { setReady(false); if (!token.startsWith('pk.')) onMapError('Set EXPO_PUBLIC_MAPBOX_TOKEN to a Mapbox public token in mobile/.env.local.'); }, [html, token, onMapError]);
  useEffect(() => { if (ready) run(`window.gomap?.filter(${JSON.stringify(category)})`); }, [ready, category]);
  useEffect(() => { if (ready && focusPlaceId) run(`window.gomap?.focus(${JSON.stringify(focusPlaceId)})`); }, [ready, focusPlaceId]);
  useEffect(() => { if (ready && resetToken) run('window.gomap?.reset()'); }, [ready, resetToken]);
  useEffect(() => { if (ready && tiltToken) run('window.gomap?.tilt()'); }, [ready, tiltToken]);
  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type: string; detail: string };
      if (message.type === 'ready') { setReady(true); onMapReady(); }
      if (message.type === 'error') onMapError(message.detail);
      if (message.type === 'select') onSelect(message.detail);
    } catch { onMapError('Map response could not be read.'); }
  };
  return <View style={StyleSheet.absoluteFill}>
    {token.startsWith('pk.') && <MapWebView ref={web} style={styles.web} originWhitelist={['*']}
      source={{ html, baseUrl: 'https://api.mapbox.com/' }} javaScriptEnabled domStorageEnabled onMessage={handleMessage}
      androidLayerType="hardware" onError={() => onMapError('Map view could not load.')}
      onRenderProcessGone={() => onMapError('Map view stopped. Try reloading.')}
      scrollEnabled={false} overScrollMode="never" />}
  </View>;
}
const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#e4ede8' } });
