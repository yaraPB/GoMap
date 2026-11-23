/**
 * The Mapbox GL JS page that runs inside the WebView (native) or an iframe (web).
 * Plain ES5 in a string on purpose: Hermes cannot serialise functions, and the WebView runs
 * whatever we give it. React Native talks to it with JSON messages (see MapCommand in MapContext).
 *
 * Look: the GoCampus map (Mapbox Standard, dusk light by day and night light after dark: dark green
 * land, navy buildings, slate paths, white-ringed category pins), enhanced with scenes, lit
 * buildings and AR. The camera never leaves Al Akhawayn; outside the campus outline is dimmed.
 */
import { categories, icons } from '../ui/theme';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MIN_ZOOM, CAMPUS_OUTLINE } from './campusOutline';

export const CAMPUS_CENTER: [number, number] = [-5.1066, 33.5393];
/** The camera stays inside this box in every view. */
export const CAMPUS_BOUNDS = CAMPUS_MAX_BOUNDS;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function mapHtml(token: string, opts: { flyIn: boolean }) {
  const cat = Object.fromEntries(categories.map(c => [c.id, { color: c.color, icon: icons[c.icon as keyof typeof icons] }]));
  const ICON = { ban: icons.ban, flag: icons.flagEnd, door: icons.door, event: icons.calendarStar };
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css" rel="stylesheet"/>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js"></script>
<style>
html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#24302A;-webkit-tap-highlight-color:transparent}
.mapboxgl-ctrl-attrib{font:10px -apple-system,Roboto,sans-serif!important;opacity:.8}
.mapboxgl-ctrl-logo{transform:scale(.8);transform-origin:left bottom}
.arriving .mapboxgl-marker{visibility:hidden}
.pin{width:34px;height:34px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 6px rgba(0,0,0,.45);cursor:pointer;padding:0;position:relative;transition:transform 220ms ease,opacity 260ms ease}
.pin svg{width:16px;height:16px}
.pin.closed{background:#6B7280!important;opacity:.72}
.pin .badge{position:absolute;right:-5px;bottom:-5px;width:17px;height:17px;border-radius:50%;background:#B5342B;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.pin .badge svg{width:9px;height:9px}
.pin.sel{transform:scale(1.28);z-index:5}
.pin.sel:before{content:'';position:absolute;inset:-26px;border-radius:50%;background:radial-gradient(circle,rgba(79,139,240,.42) 0%,rgba(79,139,240,.12) 55%,rgba(79,139,240,0) 72%);z-index:-1}
.pin.dim{opacity:.35}
.drop{animation:drop 420ms cubic-bezier(.2,.8,.3,1) backwards}
@keyframes drop{0%{opacity:0;transform:translateY(-9px) scale(.84)}62%{opacity:1;transform:translateY(0) scale(1.05)}100%{opacity:1;transform:none}}
.cluster{min-width:38px;height:38px;padding:0 6px;box-sizing:border-box;border-radius:19px;background:#15171A;color:#fff;border:3px solid #fff;font:700 13px -apple-system,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:pointer}
.label{margin-top:4px;padding:2px 6px;border-radius:6px;background:rgba(21,23,26,.82);color:#fff;font:600 11px -apple-system,Roboto,sans-serif;white-space:nowrap;pointer-events:none}
.pinwrap{display:flex;flex-direction:column;align-items:center}
.me{width:26px;height:26px;position:relative}
.me .dot{position:absolute;inset:0;border-radius:50%;background:#2563EB;border:3.5px solid #fff;box-sizing:border-box;box-shadow:0 2px 10px rgba(0,0,0,.5)}
.me .halo{position:absolute;left:-29px;top:-29px;width:84px;height:84px;border-radius:50%;background:radial-gradient(circle,rgba(37,99,235,.42) 0%,rgba(37,99,235,0) 68%);animation:halo 2.8s ease-out infinite}
.me .cone{position:absolute;left:-17px;top:-37px;width:60px;height:60px;transform-origin:30px 50px;background:conic-gradient(from -30deg at 50% 83%,rgba(37,99,235,.38) 0deg,rgba(37,99,235,0) 60deg,transparent 60deg);clip-path:polygon(50% 83%,0 0,100% 0);display:none}
@keyframes halo{0%{transform:scale(.65);opacity:.5}70%{opacity:0}100%{transform:scale(1.7);opacity:0}}
.dest{width:40px;height:40px;border-radius:50%;background:#16A34A;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;box-shadow:0 4px 10px rgba(0,0,0,.5);position:relative}
.dest:after{content:'';position:absolute;inset:-14px;border-radius:50%;border:2px solid rgba(22,163,74,.6);animation:halo 2.2s ease-out infinite}
.dest svg{width:18px;height:18px}
.closure{display:flex;align-items:center;gap:6px;padding:4px 9px 4px 4px;border-radius:999px;background:rgba(95,99,104,.95);color:#fff;font:600 11px -apple-system,Roboto,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap}
.closure i{width:20px;height:20px;border-radius:50%;background:#B5342B;display:flex;align-items:center;justify-content:center}
.closure svg{width:12px;height:12px}
.drop-pin{width:30px;height:42px}
.park-pin{width:30px;height:30px;border-radius:8px;background:#2563EB;border:2.5px solid #fff;color:#fff;font:700 16px/25px Inter,system-ui,sans-serif;text-align:center;box-sizing:border-box;box-shadow:0 3px 8px rgba(0,0,0,.45);z-index:6}
.pinwrap{transition:opacity 260ms ease,transform 260ms ease;transform:scale(var(--pin-scale,1));transform-origin:50% 0}
/* filter changes cross-fade in place: no drop, no bounce, no camera swing */
.appear{animation:appear 320ms ease-out backwards}
@keyframes appear{0%{opacity:0}100%{opacity:1}}
.out{opacity:0!important}
.label{opacity:0;max-height:0;transition:opacity 260ms ease}
body.z17 .label{opacity:1;max-height:30px}
body.nolabels .label{display:none}
body.night .pin.dark{filter:saturate(.4) brightness(.8)}
.cluster.appear{animation:appear 320ms ease-out backwards}
/* events: a calendar badge that breathes while the event is on */
.evt{display:flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:999px;background:#fff;color:#15171A;font:700 11.5px -apple-system,Roboto,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.4);white-space:nowrap;cursor:pointer;border:0;max-width:170px}
.evt i{width:26px;height:26px;border-radius:50%;background:#C026D3;display:flex;align-items:center;justify-content:center;flex:none;position:relative}
.evt i svg{width:14px;height:14px}
.evt span{overflow:hidden;text-overflow:ellipsis}
.evt.now i:after{content:'';position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(192,38,211,.6);animation:halo 2s ease-out infinite}
.evt.dim{opacity:.4}
/* evening: a golden wash over the map (a DOM layer: WebView canvases ignore CSS filters) */
#wash{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .9s ease;background:linear-gradient(180deg,rgba(255,170,80,.30) 0%,rgba(255,140,60,.16) 45%,rgba(255,120,40,.10) 100%);mix-blend-mode:multiply}
body.evening #wash{opacity:1}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style></head><body><div id="map" role="application" aria-label="Campus map"></div><div id="wash"></div>
<script>
(function(){
var CAT=${json(cat)}, ICON=${json(ICON)}, TOKEN=${json(token)}, CENTER=${json(CAMPUS_CENTER)}, BOUNDS=${json(CAMPUS_MAX_BOUNDS)}, MINZ=${json(CAMPUS_MIN_ZOOM)}, OUTLINE=${json(CAMPUS_OUTLINE)}, FLY=${json(opts.flyIn)};
function send(type,detail){var m=JSON.stringify({type:type,detail:detail===undefined?null:detail});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m);else if(window.parent!==window)window.parent.postMessage(m,'*');}
function svg(d,stroke,w){return '<svg viewBox="0 0 24 24" fill="none" stroke="'+(stroke||'#fff')+'" stroke-width="'+(w||2.4)+'" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>';}
if(!window.mapboxgl||!mapboxgl.supported()){send('error','This device couldn’t display the map. Try reopening GoMap or using another device.');return;}
mapboxgl.accessToken=TOKEN;
var state={places:[],filter:{category:'all',school:'all'},selected:null,route:null,crossings:[],walkways:null,crowding:null,closures:[],events:[],
  layers:{threeD:true,labels:true,cars:false,crowding:false,access:false},slopes:null,segments:null,park:null,style:'default',skin:'campus',buildings:null,extra:null,user:null,heading:null,follow:false,pick:false,dest:null,highlight:null,dim:false};
// One style for both looks: satellite is a photo layer under the roads and labels. No reload when switching.
var STYLES={default:'mapbox://styles/mapbox/standard',satellite:'mapbox://styles/mapbox/standard'};
var IMAGERY={mapbox:{url:'mapbox://mapbox.satellite',tileSize:256},
  // fallback when the Mapbox account refuses satellite tiles (HTTP 429/403)
  esri:{tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,
    attribution:'Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'}};
var imagery='mapbox';
function sat(){return state.style==='satellite';}
function addImagery(){
  if(map.getLayer('imagery'))map.removeLayer('imagery');
  if(map.getSource('imagery'))map.removeSource('imagery');
  map.addSource('imagery',Object.assign({type:'raster'},IMAGERY[imagery]));
  map.addLayer({id:'imagery',type:'raster',source:'imagery',slot:'bottom',layout:{visibility:sat()?'visible':'none'},paint:{'raster-fade-duration':200}});
}
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var arriving=FLY&&!reduce,arrivalTimer=null,arrivalDone=false;
document.body.classList.toggle('arriving',arriving);
var map,ready=false,markers={},clusterMarkers={},eventMarkers={},meMarker=null,destMarker=null,closureMarkers=[],pickMarker=null,dashTimer=null,firstPins=true;
try{
  map=new mapboxgl.Map({container:'map',style:STYLES.default,
    projection:'globe',center:arriving?[-18,24]:CENTER,zoom:arriving?0.65:16.4,pitch:arriving?0:55,bearing:arriving?0:-23,
    // worldview MA: borders as recognised in Morocco (no line through the Moroccan Sahara); boundaries hidden anyway
    worldview:'MA',
    attributionControl:false,config:{basemap:{showPointOfInterestLabels:false,showTransitLabels:false,showAdminBoundaries:false,lightPreset:campusLight()}}});
  map.addControl(new mapboxgl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors'}),'bottom-left');
}catch(e){send('error',String(e&&e.message||e));return;}

function finishArrival(){
  if(arrivalDone)return;
  arrivalDone=true;arriving=false;
  document.body.classList.toggle('arriving',false);
  clearTimeout(arrivalTimer);arrivalTimer=null;
  map.off('touchstart',finishArrival);map.off('mousedown',finishArrival);map.off('moveend',finishArrival);
  map.stop();map.jumpTo({center:CENTER,zoom:16.4,pitch:55,bearing:-23,padding:{top:0,bottom:0,left:0,right:0}});
  lock();send('flyInDone');
}
function flyIn(){
  if(arrivalDone)return;
  if(reduce){finishArrival();return;}
  arriving=true;
  map.on('touchstart',finishArrival);map.on('mousedown',finishArrival);
  // Let the whole planet be seen before one continuous descent into campus.
  arrivalTimer=setTimeout(function(){
    if(arrivalDone)return;
    map.once('moveend',finishArrival);
    map.flyTo({center:CENTER,zoom:16.4,pitch:55,bearing:-23,duration:5200,curve:1.35,
      easing:function(t){return t*t*(3-2*t);}});
  },850);
}
/** From here on the map is Al Akhawayn only: no panning off campus, no zooming out to the region. */
function lock(){map.setMaxBounds(BOUNDS);map.setMinZoom(MINZ);try{map.setProjection('mercator');}catch(e){}}

function emptyFC(){return {type:'FeatureCollection',features:[]};}
/**
 * Scenes. campus (default) is the GoCampus look and follows the campus clock: dusk light by day
 * (green land, plum-grey buildings), night light after dark (navy buildings). day is bright,
 * evening golden, night dark with open buildings lit. Satellite stays in daylight.
 */
function clockHour(){
  var p=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Africa/Casablanca'}).formatToParts(new Date());
  var h=0,m=0;p.forEach(function(x){if(x.type==='hour')h=Number(x.value);if(x.type==='minute')m=Number(x.value);});
  return h+m/60;
}
function dark(){var t=clockHour();return t<6.5||t>=19.5;}
function skinNow(){var k=state.skin==='auto'?'campus':state.skin;return k==='campus'?(dark()?'night':'campus'):k;}
function campusLight(){if(sat())return 'day';var k=skinNow();return k==='day'?'day':k==='night'?'night':'dusk';}
function isDark(){var k=skinNow();return k==='night'||k==='evening';}
var FOG={campus:{color:'#556B5E','high-color':'#24304A'},day:{color:'#DFE9EE','high-color':'#7399BF'},evening:{color:'#F6C38E','high-color':'#D9773F'},night:{color:'#1B2433','high-color':'#0E1827'}};
var BUILDING={day:'#C4C1BA',evening:'#E6C29A'};
var EXTRA={campus:'#9A7A7C',day:'#C4C1BA',evening:'#C9A27E',night:'#2B3150'};
var PATH={campus:'#8C95AC',day:'#5B6B60',evening:'#8A6B4E',night:'#5E6884'};
function applyLight(){
  var k=skinNow();
  config('lightPreset',campusLight());
  // only Day and Evening tint the buildings; the GoCampus and Dark scenes keep Mapbox's own colours
  if(!sat()&&BUILDING[k])config('colorBuildings',BUILDING[k]);
  try{map.setFog(Object.assign({'space-color':'#0E1827','horizon-blend':0.08,'star-intensity':k==='night'?0.35:0.1},FOG[k]));}catch(e){}
  document.body.classList.toggle('night',k==='night');
  document.body.classList.toggle('evening',k==='evening'&&!sat());
  if(map.getLayer('paths')){map.setPaintProperty('paths','line-color',sat()?'#FFFFFF':PATH[k]);map.setPaintProperty('paths','line-opacity',sat()?0.85:0.8);}
  if(map.getLayer('extra-buildings')){map.setPaintProperty('extra-buildings','fill-extrusion-color',EXTRA[k]);
    // the scene light dims custom shapes more than Mapbox's own buildings: lift them to match
    try{map.setPaintProperty('extra-buildings','fill-extrusion-emissive-strength',k==='night'?0.15:k==='day'?0.35:0.7);}catch(e){}}
  if(map.getLayer('outside'))map.setPaintProperty('outside','fill-opacity',sat()?0.5:k==='day'?0.28:0.42);
  // open buildings switch their lights on after dark: the building itself glows, no boxes
  if(map.getLayer('buildings-lit')){
    map.setLayoutProperty('buildings-lit','visibility',isDark()&&!sat()?'visible':'none');
    try{map.setPaintProperty('buildings-lit','fill-extrusion-emissive-strength',k==='night'?1:0.75);}catch(e){}
  }
  threeD();
  Object.keys(markers).forEach(function(id){var p=byId[id];var bt=markers[id].getElement().firstChild;if(!p||!bt)return;bt.classList.toggle('dark',k==='night'&&p.open!=='open');});
}
/** Satellite photos are flat: 3D buildings on top of them look wrong, so they go. */
function threeD(){
  var on=state.layers.threeD&&!sat();
  config('show3dObjects',on);
  vis('extra-buildings',on);
}
function buildingsFC(){return state.buildings||emptyFC();}
/** Pins grow gently with zoom; labels fade in past 17.2. No markers are rebuilt on zoom. */
function onZoom(){
  var z=map.getZoom();
  var root=document.documentElement;if(root&&root.style)root.style.setProperty('--pin-scale',String(Math.max(0.72,Math.min(1.12,0.72+(z-14.5)*0.16))));
  document.body.classList.toggle('z17',z>=17.2);
}
function config(key,value){try{map.setConfigProperty('basemap',key,value);}catch(e){}}
/** Everything outside the campus outline, dimmed: the map is about AUI only. */
function outsideFC(){return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]],OUTLINE.slice().reverse()]}}]};}
function addLayers(){
  config('showPlaceLabels',state.layers.labels);
  config('showRoadLabels',state.layers.labels);config('showAdminBoundaries',false);config('lightPreset',campusLight());
  try{if(map.setWorldview)map.setWorldview('MA');}catch(e){}
  try{addImagery();}catch(e){send('log','imagery: '+String(e&&e.message||e));}
  map.addSource('outside',{type:'geojson',data:outsideFC()});
  map.addLayer({id:'outside',type:'fill',source:'outside',paint:{'fill-color':'#101814','fill-opacity':0.42}});
  map.addLayer({id:'outline',type:'line',source:'outside',paint:{'line-color':'#FFFFFF','line-opacity':0.18,'line-width':1.2,'line-dasharray':[2,2]}});
  map.addSource('walkways',{type:'geojson',data:state.walkways||emptyFC()});
  map.addSource('crowding',{type:'geojson',data:state.crowding||emptyFC(),lineMetrics:true});
  map.addSource('route',{type:'geojson',data:routeFC(),lineMetrics:true});
  map.addSource('crossings',{type:'geojson',data:pointsFC(state.crossings)});
  map.addSource('places',{type:'geojson',data:placesFC(),cluster:true,clusterRadius:34,clusterMaxZoom:16});
  // buildings the basemap does not have (traced from satellite imagery, drawn in the admin)
  map.addSource('extra-buildings',{type:'geojson',data:state.extra||emptyFC()});
  map.addLayer({id:'extra-buildings',type:'fill-extrusion',source:'extra-buildings',minzoom:14.5,
    paint:{'fill-extrusion-color':EXTRA.campus,'fill-extrusion-height':['coalesce',['get','height'],8],'fill-extrusion-base':0,'fill-extrusion-opacity':0.96,'fill-extrusion-vertical-gradient':true,'fill-extrusion-emissive-strength':0.7}});
  map.addLayer({id:'roads-band',type:'line',source:'walkways',filter:['==',['get','kind'],'road'],layout:{'line-cap':'round','line-join':'round',visibility:state.layers.cars?'visible':'none'},
    paint:{'line-color':sat()?'#C9CED6':'#8E97A3','line-width':['interpolate',['linear'],['zoom'],15,3,18,11],'line-opacity':0.85}});
  map.addLayer({id:'roads-centre',type:'line',source:'walkways',filter:['==',['get','kind'],'road'],layout:{visibility:state.layers.cars?'visible':'none'},
    paint:{'line-color':'#FFFFFF','line-width':['interpolate',['linear'],['zoom'],15,0.6,18,1.6],'line-dasharray':[3,3]}});
  // footpaths: people only, dotted. Stairs: short orange rungs, so nobody pushing wheels is surprised
  map.addLayer({id:'paths',type:'line',source:'walkways',filter:['!',['in',['get','kind'],['literal',['road','stairs']]]],layout:{'line-cap':'round'},
    paint:{'line-color':PATH.campus,'line-width':['interpolate',['linear'],['zoom'],15,1.2,18,2.6],'line-dasharray':[0.3,2],'line-opacity':0.8}});
  map.addLayer({id:'stairs',type:'line',source:'walkways',filter:['==',['get','kind'],'stairs'],minzoom:15.5,
    paint:{'line-emissive-strength':1,'line-color':'#EA580C','line-width':['interpolate',['linear'],['zoom'],15.5,3,18,8],'line-dasharray':[0.25,0.35],'line-opacity':0.95}});
  // the step-free view: how hard each path is on wheels (green easy, amber ramp-like, red steeper than a ramp / stairs)
  map.addSource('slopes',{type:'geojson',data:state.slopes||emptyFC()});
  map.addLayer({id:'access',type:'line',source:'slopes',filter:['!=',['get','class'],'stairs'],layout:{'line-cap':'round','line-join':'round',visibility:state.layers.access?'visible':'none'},
    paint:{'line-emissive-strength':1,'line-color':['match',['get','class'],'gentle','#22C55E','moderate','#F59E0B','#DC2626'],'line-width':['interpolate',['linear'],['zoom'],15,2,18,6],'line-opacity':0.9}});
  map.addLayer({id:'access-stairs',type:'line',source:'slopes',filter:['==',['get','class'],'stairs'],layout:{visibility:state.layers.access?'visible':'none'},
    paint:{'line-emissive-strength':1,'line-color':'#DC2626','line-width':['interpolate',['linear'],['zoom'],15,3,18,9],'line-dasharray':[0.3,0.3]}});
  map.addLayer({id:'crowding',type:'line',source:'crowding',filter:['>=',['get','load'],0.34],layout:{'line-cap':'round','line-join':'round',visibility:state.layers.crowding?'visible':'none'},
    paint:{'line-color':['interpolate',['linear'],['get','load'],0,'rgba(253,230,138,0.15)',0.2,'#FDE68A',0.55,'#F59E0B',0.9,'#B45309'],
      'line-width':['interpolate',['linear'],['zoom'],15,3,18,10],'line-opacity':['interpolate',['linear'],['get','load'],0,0.2,0.25,0.95]}});
  // in the car: blue. On foot: green, with a grey edge where you walk along a road cars use.
  // Stairs: orange. Steeper than a ramp: amber.
  map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-emissive-strength':1,'line-color':['match',['get','kind'],'drive','#1E3A8A','road','#4B5563','#0B4D23'],'line-width':['interpolate',['linear'],['zoom'],15,6,18,13],'line-opacity':['match',['get','kind'],'road',0.8,0.55]}});
  map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-emissive-strength':1,'line-color':['case',['get','steep'],'#D97706',['match',['get','kind'],'drive','#2563EB','stairs','#EA580C','#16A34A']],'line-width':['interpolate',['linear'],['zoom'],15,4,18,9]}});
  map.addLayer({id:'route-flow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-emissive-strength':1,'line-color':'#D9FBE5','line-width':['interpolate',['linear'],['zoom'],15,1.5,18,3.5],'line-dasharray':[0,4,3]}});
  map.addLayer({id:'crossings',type:'circle',source:'crossings',paint:{'circle-emissive-strength':1,'circle-radius':7,'circle-color':'#FFFFFF','circle-stroke-color':'#15171A','circle-stroke-width':2.5}});
  map.addSource('campus-buildings',{type:'geojson',data:buildingsFC()});
  // a warm, light-emitting shell over open buildings (a hair taller than the basemap's own)
  map.addLayer({id:'buildings-lit',type:'fill-extrusion',source:'campus-buildings',filter:['==',['get','open'],true],minzoom:14.5,
    layout:{visibility:isDark()?'visible':'none'},
    paint:{'fill-extrusion-color':['interpolate',['linear'],['zoom'],15,'#FFD58A',18,'#FFE2A8'],'fill-extrusion-height':['+',['get','height'],0.4],
      'fill-extrusion-base':0,'fill-extrusion-opacity':0.92,'fill-extrusion-emissive-strength':1,'fill-extrusion-vertical-gradient':true,
      'fill-extrusion-flood-light-color':'#FFC46B','fill-extrusion-flood-light-intensity':0.55,'fill-extrusion-flood-light-ground-radius':6}});
  map.addLayer({id:'places-hit',type:'circle',source:'places',paint:{'circle-radius':1,'circle-opacity':0}});
  threeD();
  if(state.route)animateDash();
}
// route-flow: a dash travelling along the route in the direction of travel
var DASH=[[0,4,3],[0.5,4,2.5],[1,4,2],[1.5,4,1.5],[2,4,1],[2.5,4,0.5],[3,4,0],[0,0.5,3,3.5],[0,1,3,3],[0,1.5,3,2.5],[0,2,3,2],[0,2.5,3,1.5],[0,3,3,1],[0,3.5,3,0.5]];
function animateDash(){
  if(dashTimer||reduce)return;var step=0;
  dashTimer=setInterval(function(){if(!map.getLayer('route-flow'))return;step=(step+1)%DASH.length;map.setPaintProperty('route-flow','line-dasharray',DASH[step]);},80);
}
function stopDash(){if(dashTimer){clearInterval(dashTimer);dashTimer=null;}}
/** The route in stretches (car / footpath / road shared with cars / stairs, steep marked), each drawn in its own colour. */
function routeFC(){if(!state.route)return emptyFC();
  if(!state.segments||!state.segments.length)return {type:'FeatureCollection',features:[{type:'Feature',properties:{kind:'path',steep:false},geometry:state.route}]};
  return {type:'FeatureCollection',features:state.segments.map(function(s){return {type:'Feature',properties:{kind:s.kind,steep:!!s.steep},geometry:{type:'LineString',coordinates:s.coordinates}};})};}
var parkMarker=null;
function setPark(c){if(parkMarker){parkMarker.remove();parkMarker=null;}if(!c)return;
  var el=document.createElement('div');el.className='park-pin';el.textContent='P';el.setAttribute('aria-label','Car park');
  parkMarker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat(c).addTo(map);}
function pointsFC(list){return {type:'FeatureCollection',features:(list||[]).map(function(c){return {type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}};})};}
function visiblePlaces(){var f=state.filter;if(f.category==='events')return [];return state.places.filter(function(p){
  if(f.category!=='all'&&p.category!==f.category)return false;
  if(f.category==='academic'&&f.school!=='all'&&(p.schools||[]).indexOf(f.school)<0)return false;return true;});}
function placesFC(){return {type:'FeatureCollection',features:visiblePlaces().map(function(p){return {type:'Feature',properties:{id:p.id},geometry:{type:'Point',coordinates:p.coordinates}};})};}

function pinEl(p,i){
  var c=CAT[p.category]||CAT.all;var wrap=document.createElement('div');wrap.className='pinwrap';
  var b=document.createElement('button');b.className='pin'+(p.status==='closed'?' closed':'')+(firstPins?' drop':'');
  b.style.background=c.color;b.style.animationDelay=firstPins?Math.min(i*32,640)+'ms':'0ms';
  b.setAttribute('aria-label',p.name+(p.status==='closed'?', closed':''));b.innerHTML=svg(c.icon);
  if(p.status==='closed'){var bad=document.createElement('span');bad.className='badge';bad.innerHTML=svg(ICON.ban,'#fff',3);b.appendChild(bad);}
  b.onclick=function(e){e.stopPropagation();send('select',p.id);};
  if(skinNow()==='night'&&p.open!=='open')b.classList.add('dark');
  if(!firstPins)wrap.classList.add('appear');
  wrap.appendChild(b);
  if(p.number){var l=document.createElement('div');l.className='label';l.textContent=p.number.length<4?'B'+p.number:p.name;wrap.appendChild(l);}
  return wrap;
}
var byId={};
function renderPins(){
  if(!ready||!map.getSource('places'))return;
  var feats=map.querySourceFeatures('places');var keep={},keepC={},i=0;
  feats.forEach(function(f){
    var pr=f.properties;
    if(pr.cluster){var cid='c'+pr.cluster_id;if(keepC[cid])return;keepC[cid]=1;
      if(!clusterMarkers[cid]){var el=document.createElement('button');el.className='cluster '+(firstPins?'drop':'appear');el.textContent=pr.point_count;el.setAttribute('aria-label',pr.point_count+' places, tap to open');
        var coords=f.geometry.coordinates;el.onclick=function(e){e.stopPropagation();map.getSource('places').getClusterExpansionZoom(pr.cluster_id).then(function(z){map.easeTo({center:coords,zoom:z+0.3,duration:reduce?0:600});}).catch(function(){});};
        clusterMarkers[cid]=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map);}
      return;}
    var id=pr.id;if(keep[id])return;keep[id]=1;var p=byId[id];if(!p)return;
    if(!markers[id]){markers[id]=new mapboxgl.Marker({element:pinEl(p,i++),anchor:'top',offset:[0,-17]}).setLngLat(p.coordinates).addTo(map);}
    var btn=markers[id].getElement().firstChild;btn.classList.toggle('sel',state.selected===id);btn.classList.toggle('dim',state.dim&&state.selected!==id&&state.highlight!==id);
  });
  Object.keys(markers).forEach(function(id){if(!keep[id]){fadeOut(markers[id]);delete markers[id];}});
  Object.keys(clusterMarkers).forEach(function(id){if(!keepC[id]){fadeOut(clusterMarkers[id]);delete clusterMarkers[id];}});
  if(feats.length)firstPins=false;
}
function fadeOut(m){var el=m.getElement();if(reduce||!el||!el.classList){m.remove();return;}el.classList.add('out');setTimeout(function(){m.remove();},260);}
function resetPins(){Object.keys(markers).forEach(function(id){markers[id].remove();});markers={};Object.keys(clusterMarkers).forEach(function(id){clusterMarkers[id].remove();});clusterMarkers={};}
/** New data: pins that stay, stay put; the others fade out, new ones fade in. */
function setPlacesData(){if(!map.getSource('places'))return;map.getSource('places').setData(placesFC());}

/** Events: one calendar badge per event with a place. */
function setEvents(){
  var keep={};var only=state.filter.category==='events';
  (state.events||[]).forEach(function(ev){
    if(!ev.coordinates)return;keep[ev.id]=1;
    var m=eventMarkers[ev.id];
    if(!m){var el=document.createElement('button');el.className='evt appear'+(ev.state==='now'?' now':'');
      el.innerHTML='<i>'+svg(ICON.event)+'</i>';var t=document.createElement('span');t.textContent=ev.title;el.appendChild(t);
      el.setAttribute('aria-label','Event: '+ev.title);el.onclick=function(e){e.stopPropagation();send('selectEvent',ev.id);};
      m=eventMarkers[ev.id]=new mapboxgl.Marker({element:el,anchor:'bottom',offset:[0,-22]}).setLngLat(ev.coordinates).addTo(map);}
    var e2=m.getElement();if(e2&&e2.classList)e2.classList.toggle('dim',!only&&state.filter.category!=='all');
  });
  Object.keys(eventMarkers).forEach(function(id){if(!keep[id]){fadeOut(eventMarkers[id]);delete eventMarkers[id];}});
}

function fit(coords,pad){
  if(!coords.length)return;var b=new mapboxgl.LngLatBounds(coords[0],coords[0]);coords.forEach(function(c){b.extend(c);});
  map.fitBounds(b,{padding:pad||{top:170,bottom:220,left:50,right:50},maxZoom:17.6,duration:reduce?0:650,pitch:45});
}
/**
 * Chip filters: the camera only moves when most of the results are off screen, and then it glides
 * slowly to them keeping its tilt and heading (no swing, no zoom pump: those caused motion sickness).
 */
function gentleFit(coords){
  if(!coords.length)return;
  var inView=0;try{var vb=map.getBounds();coords.forEach(function(c){if(vb.contains(c))inView++;});}catch(e){return;}
  if(inView>=coords.length*0.6)return;
  var b=new mapboxgl.LngLatBounds(coords[0],coords[0]);coords.forEach(function(c){b.extend(c);});
  try{var cam=map.cameraForBounds(b,{padding:{top:170,bottom:240,left:50,right:50},maxZoom:17.2,bearing:map.getBearing(),pitch:map.getPitch()});
    if(!cam)return;map.easeTo({center:cam.center,zoom:Math.max(map.getZoom()-1.2,Math.min(cam.zoom,map.getZoom()+1)),duration:reduce?0:1100,easing:function(t){return 1-Math.pow(1-t,3);}});
  }catch(e){}
}
function setMe(){
  if(!state.user){if(meMarker){meMarker.remove();meMarker=null;}return;}
  if(!meMarker){var el=document.createElement('div');el.className='me';el.setAttribute('aria-label','You are here');el.innerHTML='<div class="halo"></div><div class="cone"></div><div class="dot"></div>';
    meMarker=new mapboxgl.Marker({element:el,rotationAlignment:'map',pitchAlignment:'map'}).setLngLat(state.user).addTo(map);}
  meMarker.setLngLat(state.user);var cone=meMarker.getElement().querySelector('.cone');
  if(state.heading!=null){cone.style.display='block';cone.style.transform='rotate('+state.heading+'deg)';}else cone.style.display='none';
  if(state.follow)map.easeTo({center:state.user,bearing:state.heading!=null?state.heading:map.getBearing(),zoom:18.4,pitch:60,duration:900,padding:{top:180,bottom:260,left:0,right:0}});
}
function setDest(c){
  if(destMarker){destMarker.remove();destMarker=null;}if(!c)return;
  var el=document.createElement('div');el.className='dest';el.setAttribute('aria-label','Destination entrance');el.innerHTML=svg(ICON.door);
  destMarker=new mapboxgl.Marker({element:el}).setLngLat(c).addTo(map);
}
function setClosures(){
  closureMarkers.forEach(function(m){m.remove();});closureMarkers=[];
  state.closures.forEach(function(c){var el=document.createElement('div');el.className='closure';el.innerHTML='<i>'+svg(ICON.ban,'#fff',3)+'</i>';
    var t=document.createElement('span');t.textContent=c.reason;el.appendChild(t);el.setAttribute('aria-label','Closed: '+c.reason);
    closureMarkers.push(new mapboxgl.Marker({element:el}).setLngLat(c.coordinates).addTo(map));});
}
function vis(id,on){if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}

var handlers={
  places:function(d){state.places=d.places;byId={};d.places.forEach(function(p){byId[p.id]=p;});resetPins();setPlacesData();},
  buildings:function(d){state.buildings=d.data;if(map.getSource('campus-buildings'))map.getSource('campus-buildings').setData(d.data);},
  extraBuildings:function(d){state.extra=d.data;if(map.getSource('extra-buildings'))map.getSource('extra-buildings').setData(d.data);},
  events:function(d){state.events=d.list||[];if(ready)setEvents();},
  skin:function(d){state.skin=d.skin||'campus';if(ready)applyLight();},
  filter:function(d){state.filter={category:d.category,school:d.school};setPlacesData();setEvents();
    if(arriving||!d.fit)return;
    var v=d.category==='events'?(state.events||[]).filter(function(e){return e.coordinates;}).map(function(e){return e.coordinates;}):visiblePlaces().map(function(p){return p.coordinates;});
    if(d.fit==='gentle'){if(d.category!=='all')gentleFit(v);return;}
    if(v.length&&d.category!=='all')fit(v,d.padding);},
  select:function(d){state.selected=d.id;state.dim=!!d.dim;renderPins();var p=byId[d.id];
    if(p&&d.fly!==false)map.flyTo({center:p.coordinates,zoom:Math.max(map.getZoom(),17.4),pitch:50,padding:{top:60,bottom:d.bottom||420,left:0,right:0},duration:reduce?0:650});},
  route:function(d){state.route=d.geometry;state.segments=d.segments||null;state.crossings=d.crossings||[];
    if(map.getSource('route')){map.getSource('route').setData(routeFC());map.getSource('crossings').setData(pointsFC(state.crossings));}
    setDest(d.dest||null);setPark(d.park||null);if(d.geometry){animateDash();if(d.fit!==false)fit(d.geometry.coordinates,d.padding);}else stopDash();},
  clearRoute:function(){state.route=null;state.segments=null;state.crossings=[];if(map.getSource('route')){map.getSource('route').setData(emptyFC());map.getSource('crossings').setData(emptyFC());}setDest(null);setPark(null);stopDash();},
  slopes:function(d){state.slopes=d.data;if(map.getSource('slopes'))map.getSource('slopes').setData(d.data);},
  user:function(d){state.user=d.coord;state.heading=d.heading;setMe();},
  follow:function(d){state.follow=!!d.on;if(arriving)return;if(!d.on)map.easeTo({pitch:50,padding:{top:0,bottom:0,left:0,right:0},duration:reduce?0:500});else setMe();},
  locate:function(){if(state.user)map.flyTo({center:state.user,zoom:17.6,duration:reduce?0:700});},
  reset:function(){map.flyTo({center:CENTER,zoom:16.4,pitch:55,bearing:-23,padding:{top:0,bottom:0,left:0,right:0},duration:reduce?0:700});},
  walkways:function(d){state.walkways=d.data;if(map.getSource('walkways'))map.getSource('walkways').setData(d.data);},
  crowding:function(d){state.crowding=d.data;if(map.getSource('crowding'))map.getSource('crowding').setData(d.data);if(d.fit&&d.data.features.length){
    fit([[-5.1085,33.5378],[-5.1052,33.5402]],{top:200,bottom:300,left:30,right:30});}},
  closures:function(d){state.closures=d.list||[];setClosures();},
  layers:function(d){var o=state.layers;state.layers=Object.assign({},o,d.layers);
    vis('roads-band',state.layers.cars);vis('roads-centre',state.layers.cars);vis('crowding',state.layers.crowding);
    vis('access',state.layers.access);vis('access-stairs',state.layers.access);
    threeD();config('showPlaceLabels',state.layers.labels);config('showRoadLabels',state.layers.labels);
    document.body.classList.toggle('nolabels',!state.layers.labels);},
  // satellite is a photo layer in the same style: no reload, nothing to rebuild
  style:function(d){var s=d.style==='satellite'?'satellite':'default';if(s===state.style)return;state.style=s;vis('imagery',sat());if(ready)applyLight();},
  pick:function(d){state.pick=!!d.on;if(!d.on&&pickMarker){pickMarker.remove();pickMarker=null;}},
  flyIn:function(){flyIn();},
  skipIntro:function(){finishArrival();},
  camera:function(d){map.easeTo(Object.assign({duration:reduce?0:600},d));}
};
function onMessage(ev){var m=ev.data;if(typeof m==='string'){try{m=JSON.parse(m);}catch(e){return;}}if(!m||!m.type||!handlers[m.type])return;
  try{handlers[m.type](m);}catch(e){send('log',String(e&&e.message||e));}}
window.addEventListener('message',onMessage);document.addEventListener('message',onMessage);

map.on('style.load',function(){
  try{addLayers();}catch(e){send('log','layers: '+String(e&&e.message||e));}
  ready=true;applyLight();onZoom();setPlacesData();setClosures();setEvents();setMe();send('ready');
});
setInterval(function(){if(ready)applyLight();},60000);
map.on('zoom',onZoom);
map.on('render',function(){if(ready)renderPins();});

map.on('click',function(e){
  if(state.pick){var c=[e.lngLat.lng,e.lngLat.lat];if(!pickMarker){var el=document.createElement('div');el.className='drop-pin';
    el.innerHTML='<svg viewBox="0 0 30 42"><path d="M15 41s13-13.6 13-25A13 13 0 002 16c0 11.4 13 25 13 25z" fill="#B5342B" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="16" r="5" fill="#fff"/></svg>';
    pickMarker=new mapboxgl.Marker({element:el,anchor:'bottom'}).setLngLat(c).addTo(map);}else pickMarker.setLngLat(c);send('picked',c);return;}
  send('tapMap',[e.lngLat.lng,e.lngLat.lat]);});
map.on('dragstart',function(){if(state.follow){state.follow=false;send('followOff');}});
map.on('error',function(e){
  // satellite tiles refused by the Mapbox account: use Esri World Imagery instead
  var st=e&&e.error&&e.error.status;
  if(imagery==='mapbox'&&(e.sourceId==='imagery'||/mapbox\\.satellite/.test(String(e&&e.error&&e.error.url||'')))&&(st===429||st===403||st===401)){
    imagery='esri';try{addImagery();}catch(x){}send('log','satellite: switched to Esri imagery ('+st+')');return;
  }
  if(!ready)send('error','The map could not load. Check your connection and reopen GoMap.');});
map.once('load',function(){if(FLY)flyIn();else finishArrival();});
setTimeout(function(){if(!ready)send('error','The map is taking a little longer. Check your connection and reopen GoMap.');},20000);
})();
</script></body></html>`;
}
