import React, { createElement, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Place } from './api';

type Props = {
  places: Place[]; category: string; focusPlaceId: string | null;
  resetToken: number; tiltToken: number; satelliteToken: number; onSelect: (id: string) => void;
  onMapError: (message: string) => void; onMapReady: () => void;
};

const center = [-5.1059, 33.5396];
const colors: Record<string, string> = {
  'Dining Services': '#db686b', Residential: '#dc8500', Facilities: '#6c7a8c',
  'Campus Services': '#119d97', Academic: '#3269d5', Administrative: '#6650dd',
  'Athletics & Recreation': '#1da853',
};
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

function htmlForPlaces(places: Place[], token: string) {
  const pins = places.map(place => ({
    id: place.id, name: place.name, category: place.category,
    xy: [place.longitude, place.latitude], color: colors[place.category] || '#138c67',
  }));
  return `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css" rel="stylesheet" />
    <style>html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#e4ede8}.pin{width:32px;height:32px;border:3px solid #fff;border-radius:50%;background:var(--pin);box-shadow:0 2px 9px #0008;cursor:pointer;padding:0}.pin:after{content:'';display:block;width:8px;height:8px;background:#fff;border-radius:50%;margin:auto}.mapboxgl-ctrl-attrib{font:10px Arial,sans-serif!important}</style>
    <script src="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js"></script>
    </head><body><div id="map" role="img" aria-label="Interactive campus map"></div>
    <script>
      (function(){
        var send=function(type,detail){if(window.parent!==window)window.parent.postMessage(JSON.stringify({type:type,detail:detail||''}),'*');};
        if(!window.mapboxgl||!window.mapboxgl.supported()){send('error','Mapbox needs WebGL support on this device.');return;}
        var data=${inlineJson(pins)}, token=${inlineJson(token)}, markers=[], ready=false;
        try {
          var satellite=false;function satelliteStyle(){return {version:8,glyphs:'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',sources:{'aui-imagery':{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community.'},'aui-vector':{type:'vector',url:'mapbox://mapbox.mapbox-streets-v8',attribution:'© Mapbox'}},layers:[{id:'aui-imagery',type:'raster',source:'aui-imagery'},{id:'aui-3d-buildings',type:'fill-extrusion',source:'aui-vector','source-layer':'building',minzoom:15,filter:['==','extrude','true'],paint:{'fill-extrusion-color':'#d7c39f','fill-extrusion-height':['interpolate',['linear'],['zoom'],15,0,15.05,['coalesce',['get','height'],8]],'fill-extrusion-base':['interpolate',['linear'],['zoom'],15,0,15.05,['coalesce',['get','min_height'],0]],'fill-extrusion-opacity':0.88}},{id:'aui-road-labels',type:'symbol',source:'aui-vector','source-layer':'road_label',layout:{'symbol-placement':'line','text-field':['get','name'],'text-font':['Open Sans Semibold','Arial Unicode MS Regular'],'text-size':11},paint:{'text-color':'#fff','text-halo-color':'#252522','text-halo-width':1.3}},{id:'aui-place-labels',type:'symbol',source:'aui-vector','source-layer':'poi_label',layout:{'text-field':['get','name'],'text-font':['Open Sans Semibold','Arial Unicode MS Regular'],'text-size':11},paint:{'text-color':'#fff','text-halo-color':'#252522','text-halo-width':1.3}}]};}var map=new window.mapboxgl.Map({container:'map',accessToken:token,style:'mapbox://styles/mapbox/standard',center:${inlineJson(center)},zoom:16.5,pitch:45,bearing:-23,attributionControl:true});
          data.forEach(function(place){var element=document.createElement('button');element.className='pin';element.style.setProperty('--pin',place.color);element.setAttribute('aria-label',place.name+' (sample pin)');element.onclick=function(){send('select',place.id);};var marker=new window.mapboxgl.Marker({element:element}).setLngLat(place.xy).addTo(map);markers.push({marker:marker,category:place.category});});
          window.gomap={focus:function(id){var p=data.find(function(item){return item.id===id;});if(p)map.flyTo({center:p.xy,zoom:17.5,pitch:45,offset:[0,-120],duration:550});},filter:function(category){markers.forEach(function(item){item.marker.getElement().style.display=category==='All'||category===item.category?'':'none';});},reset:function(){map.flyTo({center:${inlineJson(center)},zoom:16.5,pitch:45,bearing:-23,duration:500});},tilt:function(){map.easeTo({pitch:map.getPitch()>10?0:45,duration:500});},satellite:function(){satellite=!satellite;map.setStyle(satellite?satelliteStyle():'mapbox://styles/mapbox/standard');}};
          window.addEventListener('message',function(event){var message=event.data;if(typeof message==='string'){try{message=JSON.parse(message);}catch(_){return;}}if(!message||!window.gomap)return;if(message.type==='filter')window.gomap.filter(message.value);if(message.type==='focus')window.gomap.focus(message.value);if(message.type==='reset')window.gomap.reset();if(message.type==='tilt')window.gomap.tilt();if(message.type==='satellite')window.gomap.satellite();});
          map.on('load',function(){ready=true;send('ready');});map.on('error',function(event){if(!ready)send('error',event&&event.error&&event.error.message||'Mapbox tiles could not load. Check the token and internet access.');});setTimeout(function(){if(!ready)send('error','Mapbox did not load. Check the token and internet access.');},15000);
        }catch(error){send('error',String(error));}
      })();
    </script></body></html>`;
}

export default function CampusMap({ places, category, focusPlaceId, resetToken, tiltToken, satelliteToken, onSelect, onMapError, onMapReady }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
  const html = useMemo(() => token ? htmlForPlaces(places, token) : '', [places, token]);

  useEffect(() => {
    if (!token.startsWith('pk.')) onMapError('Set EXPO_PUBLIC_MAPBOX_TOKEN to a Mapbox public token in mobile/.env.local.');
  }, [token, onMapError]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as { type: string; detail?: string };
        if (message.type === 'ready') onMapReady();
        if (message.type === 'error') onMapError(message.detail || 'Mapbox tiles could not load.');
        if (message.type === 'select' && message.detail) onSelect(message.detail);
      } catch { onMapError('Map response could not be read.'); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onMapError, onMapReady, onSelect]);

  const send = (type: string, value?: string) => frame.current?.contentWindow?.postMessage({ type, value }, '*');
  useEffect(() => { send('filter', category); }, [category, html]);
  useEffect(() => { if (focusPlaceId) send('focus', focusPlaceId); }, [focusPlaceId]);
  useEffect(() => { if (resetToken) send('reset'); }, [resetToken]);
  useEffect(() => { if (tiltToken) send('tilt'); }, [tiltToken]);
  useEffect(() => { if (satelliteToken) send('satellite'); }, [satelliteToken]);

  if (!token.startsWith('pk.')) return <View style={StyleSheet.absoluteFill} />;
  return <View style={StyleSheet.absoluteFill}>
    {createElement('iframe' as any, {
      ref: (node: HTMLIFrameElement | null) => { frame.current = node; },
      title: 'Interactive AUI campus map',
      srcDoc: html,
      sandbox: 'allow-scripts allow-same-origin',
      style: { width: '100%', height: '100%', border: 0, display: 'block' },
    })}
  </View>;
}
