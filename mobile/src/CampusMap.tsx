import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Place } from './api';

type Props = {
  places: Place[];
  category: string;
  focusPlaceId: string | null;
  resetToken: number;
  tiltToken: number;
  onSelect: (id: string) => void;
  onMapError: (message: string) => void;
  onMapReady: () => void;
};

const center = [-5.1059, 33.5396];
const colors: Record<string, string> = {
  'Dining Services': '#db686b', Residential: '#dc8500', Facilities: '#6c7a8c',
  'Campus Services': '#119d97', Academic: '#3269d5', Administrative: '#6650dd',
  'Athletics & Recreation': '#1da853',
};

function markerData(places: Place[]) {
  // Encode data for an inline script. In particular, never allow a name to close the script tag.
  return JSON.stringify(places.map(p => ({
    id: p.id, name: p.name, category: p.category,
    xy: [p.longitude, p.latitude], color: colors[p.category] || '#138c67',
  }))).replace(/</g, '\\u003c');
}

export function htmlForPlaces(places: Place[], mode: 'vector' | 'raster' = 'vector') {
  return mode === 'raster' ? rasterHtmlForPlaces(places) : vectorHtmlForPlaces(places);
}

function vectorHtmlForPlaces(places: Place[]) {
  const markers = markerData(places);

  return `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css" />
    <style>
      html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#484354}
      .pin{width:33px;height:33px;border:3px solid #fff;border-radius:50%;background:var(--pin);box-shadow:0 2px 9px #0009;cursor:pointer;display:grid;place-items:center;padding:0}
      .pin:after{content:'';width:8px;height:8px;background:#fff;border-radius:50%}
      .maplibregl-ctrl-attrib{font:10px Arial,sans-serif!important}
    </style>
    <script src="https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js"></script>
    </head><body><div id="map" role="img" aria-label="Interactive map of Al Akhawayn University"></div>
    <script>
      (function(){
        var send=function(type,detail){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:type,detail:detail||''}));}};
        if(!window.maplibregl){send('error','MapLibre could not load. Check internet access.');return;}
        var data=${markers}; var pins=[]; var ready=false;
        try {
          var map=new window.maplibregl.Map({container:'map',center:${JSON.stringify(center)},zoom:16.5,pitch:53,bearing:-23,
            style:{version:8,sources:{campus:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:'OpenFreeMap © OpenStreetMap'}},layers:[
              {id:'ground',type:'background',paint:{'background-color':'#484354'}},
              {id:'land',type:'fill',source:'campus','source-layer':'landcover',paint:{'fill-color':'#425c50','fill-opacity':0.85}},
              {id:'landuse',type:'fill',source:'campus','source-layer':'landuse',paint:{'fill-color':['match',['get','class'],'residential','#4b4a51','education','#505057','grass','#4c6354','park','#4c6354','#4a5750']}},
              {id:'water',type:'fill',source:'campus','source-layer':'water',paint:{'fill-color':'#536b7b'}},
              {id:'roadsedge',type:'line',source:'campus','source-layer':'transportation',paint:{'line-color':'#30343f','line-width':['interpolate',['linear'],['zoom'],14,2,18,16]}},
              {id:'roads',type:'line',source:'campus','source-layer':'transportation',paint:{'line-color':'#828399','line-width':['interpolate',['linear'],['zoom'],14,1,18,11]}},
              {id:'buildings',type:'fill-extrusion',source:'campus','source-layer':'building',paint:{'fill-extrusion-color':'#4c4554','fill-extrusion-height':['coalesce',['get','render_height'],7],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':1}}
            ]},attributionControl:{compact:true}});
          data.forEach(function(p){
            var el=document.createElement('button');el.className='pin';el.style.setProperty('--pin',p.color);
            el.setAttribute('aria-label',p.name+' (sample pin)');
            el.onclick=function(){send('select',p.id);};
            var pin=new window.maplibregl.Marker({element:el}).setLngLat(p.xy).addTo(map);
            pins.push({pin:pin,category:p.category});
          });
          window.gomap={
            focus:function(id){var p=data.find(function(item){return item.id===id;});if(p){map.flyTo({center:p.xy,zoom:17.5,pitch:52,offset:[0,-120],duration:550});}},
            filter:function(category){pins.forEach(function(item){item.pin.getElement().style.display=category==='All'||category===item.category?'':'none';});},
            reset:function(){map.flyTo({center:${JSON.stringify(center)},zoom:16.5,pitch:53,bearing:-23,duration:500});},
            tilt:function(){map.easeTo({pitch:map.getPitch()>10?0:53,duration:500});}
          };
          map.on('load',function(){ready=true;send('ready');});
          map.on('error',function(e){if(!ready){send('error',(e&&e.error&&e.error.message)||'Map tiles could not load.');}});
          setTimeout(function(){if(!ready)send('error','Map tiles did not load. Check internet access.');},15000);
        }catch(e){send('error',String(e));}
      })();
    </script></body></html>`;
}

function rasterHtmlForPlaces(places: Place[]) {
  const markers = markerData(places);
  return `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#484354}
      .leaflet-tile-pane{filter:grayscale(1) invert(.88) hue-rotate(180deg) brightness(.58) contrast(1.18)}
      .leaflet-control-attribution{font:10px Arial,sans-serif!important}
      .pin{display:block;width:29px;height:29px;border:3px solid #fff;border-radius:50%;background:var(--pin);box-shadow:0 2px 9px #0009;position:relative}
      .pin:after{content:'';position:absolute;width:8px;height:8px;background:#fff;border-radius:50%;left:10px;top:10px}
    </style>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    </head><body><div id="map" role="img" aria-label="Interactive map of Al Akhawayn University"></div>
    <script>
      (function(){
        var send=function(type,detail){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:type,detail:detail||''}));}};
        if(!window.L){send('error','Map library could not load. Check internet access.');return;}
        var data=${markers}; var pins=[]; var ready=false; var tileErrors=0;
        try {
          var map=window.L.map('map',{zoomControl:false,attributionControl:true}).setView([33.5396,-5.1059],17);
          var tiles=window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
            maxZoom:19,attribution:'&copy; OpenStreetMap contributors'
          });
          tiles.on('tileload',function(){if(!ready){ready=true;send('ready');}});
          tiles.on('tileerror',function(){tileErrors++;if(!ready&&tileErrors>=3)send('error','Map tiles could not load. Check internet access.');});
          tiles.addTo(map);
          data.forEach(function(p){
            var icon=window.L.divIcon({className:'',html:'<span class="pin" style="--pin:'+p.color+'"></span>',iconSize:[35,35],iconAnchor:[17,17]});
            var pin=window.L.marker([p.xy[1],p.xy[0]],{icon:icon,title:p.name+' (sample pin)'}).addTo(map);
            pin.on('click',function(){send('select',p.id);});
            pins.push({pin:pin,category:p.category});
          });
          window.gomap={
            focus:function(id){var p=data.find(function(item){return item.id===id;});if(p)map.flyTo([p.xy[1],p.xy[0]],18,{duration:.5});},
            filter:function(category){pins.forEach(function(item){var show=category==='All'||category===item.category;if(show&&!map.hasLayer(item.pin))item.pin.addTo(map);if(!show&&map.hasLayer(item.pin))map.removeLayer(item.pin);});},
            reset:function(){map.flyTo([33.5396,-5.1059],17,{duration:.5});},
            tilt:function(){}
          };
          setTimeout(function(){if(!ready)send('error','Map tiles did not load. Check internet access.');},15000);
        }catch(e){send('error',String(e));}
      })();
    </script></body></html>`;
}

export default function CampusMap({ places, category, focusPlaceId, resetToken, tiltToken, onSelect, onMapError, onMapReady }: Props) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => htmlForPlaces(places, Platform.OS === 'android' ? 'raster' : 'vector'), [places]);
  const run = (script: string) => web.current?.injectJavaScript(`${script}; true;`);

  useEffect(() => { setReady(false); }, [html]);
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
    <WebView ref={web} style={styles.web} originWhitelist={['*']} source={{ html, baseUrl: 'https://tiles.openfreemap.org/' }}
      javaScriptEnabled domStorageEnabled onMessage={handleMessage}
      androidLayerType={Platform.OS === 'android' ? 'software' : undefined}
      onError={() => onMapError('Map view could not load.')}
      onRenderProcessGone={() => onMapError('Map view stopped. Try reloading.')}
      scrollEnabled={false} overScrollMode="never" />
  </View>;
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: '#484354' } });
