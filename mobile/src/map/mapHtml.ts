/**
 * The Mapbox GL JS page that runs inside the WebView (native) or an iframe (web).
 * Plain ES5 in a string on purpose: Hermes cannot serialise functions, and the WebView runs
 * whatever we give it. React Native talks to it with JSON messages (see MapCommand in bridge.ts).
 */
import { categories, icons } from '../ui/theme';

export const CAMPUS_CENTER: [number, number] = [-5.1066, 33.5393];
export const CAMPUS_BOUNDS: [[number, number], [number, number]] = [[-5.124, 33.526], [-5.089, 33.552]];

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function mapHtml(token: string, opts: { flyIn: boolean }) {
  const cat = Object.fromEntries(categories.map(c => [c.id, { color: c.color, icon: icons[c.icon] }]));
  const ICON = { ban: icons.ban, flag: icons.flagEnd, door: icons.door };
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.css" rel="stylesheet"/>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js"></script>
<style>
html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#0E1827;-webkit-tap-highlight-color:transparent}
.mapboxgl-ctrl-attrib{font:10px -apple-system,Roboto,sans-serif!important;opacity:.8}
.mapboxgl-ctrl-logo{transform:scale(.8);transform-origin:left bottom}
.arriving .mapboxgl-marker{visibility:hidden}
.pin{width:34px;height:34px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 6px rgba(0,0,0,.45);cursor:pointer;padding:0;position:relative;transition:transform 160ms ease,opacity 180ms ease}
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
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style></head><body><div id="map" role="application" aria-label="Campus map"></div>
<script>
(function(){
var CAT=${json(cat)}, ICON=${json(ICON)}, TOKEN=${json(token)}, CENTER=${json(CAMPUS_CENTER)}, BOUNDS=${json(CAMPUS_BOUNDS)}, FLY=${json(opts.flyIn)};
function send(type,detail){var m=JSON.stringify({type:type,detail:detail===undefined?null:detail});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m);else if(window.parent!==window)window.parent.postMessage(m,'*');}
function svg(d,stroke,w){return '<svg viewBox="0 0 24 24" fill="none" stroke="'+(stroke||'#fff')+'" stroke-width="'+(w||2.4)+'" stroke-linecap="round" stroke-linejoin="round"><path d="'+d+'"/></svg>';}
if(!window.mapboxgl||!mapboxgl.supported()){send('error','This device couldn’t display the map. Try reopening GoMap or using another device.');return;}
mapboxgl.accessToken=TOKEN;
var state={places:[],filter:{category:'all',school:'all'},selected:null,route:null,routeMode:'walk',crossings:[],walkways:null,crowding:null,closures:[],
  layers:{threeD:true,labels:true,cars:false,crowding:false},style:'default',user:null,heading:null,follow:false,pick:false,dest:null,highlight:null,dim:false};
var STYLES={default:'mapbox://styles/mapbox/standard',satellite:'mapbox://styles/mapbox/standard-satellite',contrast:'mapbox://styles/mapbox/standard'};
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var arriving=FLY&&!reduce,arrivalTimer=null,arrivalDone=false;
document.body.classList.toggle('arriving',arriving);
var map,ready=false,markers={},clusterMarkers={},meMarker=null,destMarker=null,closureMarkers=[],pickMarker=null,dashTimer=null,firstPins=true;
try{
  map=new mapboxgl.Map({container:'map',style:STYLES.default,
    projection:'globe',center:arriving?[-18,24]:CENTER,zoom:arriving?0.65:16.4,pitch:arriving?0:55,bearing:arriving?0:-23,
    attributionControl:false,config:{basemap:{showPointOfInterestLabels:false,showTransitLabels:false,showAdminBoundaries:false,colorBuildings:'#C4C1BA',lightPreset:campusLight()}}});
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
function lock(){map.setMaxBounds(BOUNDS);map.setMinZoom(14.2);}

function emptyFC(){return {type:'FeatureCollection',features:[]};}
function campusLight(){var h=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:'Africa/Casablanca'}).format(new Date()));return h>=18||h<6?'night':'day';}
function config(key,value){try{map.setConfigProperty('basemap',key,value);}catch(e){}}
function addLayers(){
  var light=state.style!=='satellite';
  var pathColor=light?'#5B6B60':'#FFFFFF';
  config('show3dObjects',state.layers.threeD);config('showPlaceLabels',state.layers.labels);
  config('showRoadLabels',state.layers.labels);config('showAdminBoundaries',false);config('lightPreset',campusLight());
  if(light)config('colorBuildings','#C4C1BA');
  if(state.style==='contrast')config('theme','monochrome');
  map.addSource('walkways',{type:'geojson',data:state.walkways||emptyFC()});
  map.addSource('crowding',{type:'geojson',data:state.crowding||emptyFC(),lineMetrics:true});
  map.addSource('route',{type:'geojson',data:routeFC(),lineMetrics:true});
  map.addSource('crossings',{type:'geojson',data:pointsFC(state.crossings)});
  map.addSource('places',{type:'geojson',data:placesFC(),cluster:true,clusterRadius:34,clusterMaxZoom:16});
  map.addLayer({id:'roads-band',type:'line',source:'walkways',filter:['==',['get','kind'],'road'],layout:{'line-cap':'round','line-join':'round',visibility:state.layers.cars?'visible':'none'},
    paint:{'line-color':light?'#8E97A3':'#C9CED6','line-width':['interpolate',['linear'],['zoom'],15,3,18,11],'line-opacity':0.85}});
  map.addLayer({id:'roads-centre',type:'line',source:'walkways',filter:['==',['get','kind'],'road'],layout:{visibility:state.layers.cars?'visible':'none'},
    paint:{'line-color':'#FFFFFF','line-width':['interpolate',['linear'],['zoom'],15,0.6,18,1.6],'line-dasharray':[3,3]}});
  map.addLayer({id:'paths',type:'line',source:'walkways',filter:['!=',['get','kind'],'road'],layout:{'line-cap':'round'},
    paint:{'line-color':pathColor,'line-width':['interpolate',['linear'],['zoom'],15,1.2,18,2.6],'line-dasharray':[0.3,2],'line-opacity':0.75}});
  map.addLayer({id:'crowding',type:'line',source:'crowding',layout:{'line-cap':'round','line-join':'round',visibility:state.layers.crowding?'visible':'none'},
    paint:{'line-color':['interpolate',['linear'],['get','load'],0,'rgba(253,230,138,0.15)',0.2,'#FDE68A',0.55,'#F59E0B',0.9,'#B45309'],
      'line-width':['interpolate',['linear'],['zoom'],15,3,18,10],'line-opacity':['interpolate',['linear'],['get','load'],0,0.2,0.25,0.95]}});
  map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0B4D23','line-width':['interpolate',['linear'],['zoom'],15,6,18,13],'line-opacity':0.55}});
  map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#16A34A','line-width':['interpolate',['linear'],['zoom'],15,4,18,9]}});
  map.addLayer({id:'route-flow',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#D9FBE5','line-width':['interpolate',['linear'],['zoom'],15,1.5,18,3.5],'line-dasharray':[0,4,3]}});
  map.addLayer({id:'crossings',type:'circle',source:'crossings',paint:{'circle-radius':7,'circle-color':'#FFFFFF','circle-stroke-color':'#15171A','circle-stroke-width':2.5}});
  map.addLayer({id:'places-hit',type:'circle',source:'places',paint:{'circle-radius':1,'circle-opacity':0}});
  if(state.route)animateDash();
}
// route-flow: a dash travelling along the route in the direction of travel
var DASH=[[0,4,3],[0.5,4,2.5],[1,4,2],[1.5,4,1.5],[2,4,1],[2.5,4,0.5],[3,4,0],[0,0.5,3,3.5],[0,1,3,3],[0,1.5,3,2.5],[0,2,3,2],[0,2.5,3,1.5],[0,3,3,1],[0,3.5,3,0.5]];
function animateDash(){
  if(dashTimer||reduce)return;var step=0;
  dashTimer=setInterval(function(){if(!map.getLayer('route-flow'))return;step=(step+1)%DASH.length;map.setPaintProperty('route-flow','line-dasharray',DASH[step]);},80);
}
function stopDash(){if(dashTimer){clearInterval(dashTimer);dashTimer=null;}}
function routeFC(){return state.route?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:state.route}]}:emptyFC();}
function pointsFC(list){return {type:'FeatureCollection',features:(list||[]).map(function(c){return {type:'Feature',properties:{},geometry:{type:'Point',coordinates:c}};})};}
function visiblePlaces(){var f=state.filter;return state.places.filter(function(p){
  if(f.category!=='all'&&p.category!==f.category)return false;
  if(f.category==='academic'&&f.school!=='all'&&(p.schools||[]).indexOf(f.school)<0)return false;return true;});}
function placesFC(){return {type:'FeatureCollection',features:visiblePlaces().map(function(p){return {type:'Feature',properties:{id:p.id},geometry:{type:'Point',coordinates:p.coordinates}};})};}

function pinEl(p,i){
  var c=CAT[p.category]||CAT.all;var wrap=document.createElement('div');wrap.className='pinwrap';
  var b=document.createElement('button');b.className='pin'+(p.status==='closed'?' closed':'')+(firstPins||state.animatePins?' drop':'');
  b.style.background=c.color;b.style.animationDelay=Math.min(i*32,640)+'ms';
  b.setAttribute('aria-label',p.name+(p.status==='closed'?', closed':''));b.innerHTML=svg(c.icon);
  if(p.status==='closed'){var bad=document.createElement('span');bad.className='badge';bad.innerHTML=svg(ICON.ban,'#fff',3);b.appendChild(bad);}
  b.onclick=function(e){e.stopPropagation();send('select',p.id);};
  wrap.appendChild(b);
  if(state.layers.labels&&map.getZoom()>=17.2&&p.number){var l=document.createElement('div');l.className='label';l.textContent=p.number.length<4?'B'+p.number:p.name;wrap.appendChild(l);}
  return wrap;
}
var byId={};
function renderPins(){
  if(!ready||!map.getSource('places'))return;
  var feats=map.querySourceFeatures('places');var keep={},keepC={},i=0;
  feats.forEach(function(f){
    var pr=f.properties;
    if(pr.cluster){var cid='c'+pr.cluster_id;if(keepC[cid])return;keepC[cid]=1;
      if(!clusterMarkers[cid]){var el=document.createElement('button');el.className='cluster drop';el.textContent=pr.point_count;el.setAttribute('aria-label',pr.point_count+' places, tap to open');
        var coords=f.geometry.coordinates;el.onclick=function(e){e.stopPropagation();map.getSource('places').getClusterExpansionZoom(pr.cluster_id).then(function(z){map.easeTo({center:coords,zoom:z+0.3,duration:450});}).catch(function(){});};
        clusterMarkers[cid]=new mapboxgl.Marker({element:el}).setLngLat(coords).addTo(map);}
      return;}
    var id=pr.id;if(keep[id])return;keep[id]=1;var p=byId[id];if(!p)return;
    if(!markers[id]){markers[id]=new mapboxgl.Marker({element:pinEl(p,i++),anchor:'top',offset:[0,-17]}).setLngLat(p.coordinates).addTo(map);}
    var btn=markers[id].getElement().firstChild;btn.classList.toggle('sel',state.selected===id);btn.classList.toggle('dim',state.dim&&state.selected!==id&&state.highlight!==id);
  });
  Object.keys(markers).forEach(function(id){if(!keep[id]){markers[id].remove();delete markers[id];}});
  Object.keys(clusterMarkers).forEach(function(id){if(!keepC[id]){clusterMarkers[id].remove();delete clusterMarkers[id];}});
  if(feats.length)firstPins=false;state.animatePins=false;
}
function resetPins(animate){Object.keys(markers).forEach(function(id){markers[id].remove();});markers={};Object.keys(clusterMarkers).forEach(function(id){clusterMarkers[id].remove();});clusterMarkers={};state.animatePins=!!animate;}
function setPlacesData(animate){if(!map.getSource('places'))return;resetPins(animate);map.getSource('places').setData(placesFC());}

function fit(coords,pad){
  if(!coords.length)return;var b=new mapboxgl.LngLatBounds(coords[0],coords[0]);coords.forEach(function(c){b.extend(c);});
  map.fitBounds(b,{padding:pad||{top:170,bottom:220,left:50,right:50},maxZoom:17.6,duration:reduce?0:650,pitch:45});
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
  places:function(d){state.places=d.places;byId={};d.places.forEach(function(p){byId[p.id]=p;});setPlacesData(true);},
  filter:function(d){state.filter={category:d.category,school:d.school};setPlacesData(true);
    var v=visiblePlaces();if(!arriving&&d.fit&&v.length&&d.category!=='all')fit(v.map(function(p){return p.coordinates;}),d.padding);},
  select:function(d){state.selected=d.id;state.dim=!!d.dim;renderPins();var p=byId[d.id];
    if(p&&d.fly!==false)map.flyTo({center:p.coordinates,zoom:Math.max(map.getZoom(),17.4),pitch:50,padding:{top:60,bottom:d.bottom||420,left:0,right:0},duration:reduce?0:650});},
  route:function(d){state.route=d.geometry;state.crossings=d.crossings||[];
    if(map.getSource('route')){map.getSource('route').setData(routeFC());map.getSource('crossings').setData(pointsFC(state.crossings));}
    setDest(d.dest||null);if(d.geometry){animateDash();if(d.fit!==false)fit(d.geometry.coordinates,d.padding);}else stopDash();},
  clearRoute:function(){state.route=null;state.crossings=[];if(map.getSource('route')){map.getSource('route').setData(emptyFC());map.getSource('crossings').setData(emptyFC());}setDest(null);stopDash();},
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
    try{map.setConfigProperty('basemap','show3dObjects',state.layers.threeD);map.setConfigProperty('basemap','showPlaceLabels',state.layers.labels);map.setConfigProperty('basemap','showRoadLabels',state.layers.labels);}catch(e){}
    if(o.labels!==state.layers.labels)resetPins(false),renderPins();},
  style:function(d){if(d.style===state.style||!STYLES[d.style])return;state.style=d.style;ready=false;resetPins(false);map.setStyle(STYLES[d.style]);},
  pick:function(d){state.pick=!!d.on;if(!d.on&&pickMarker){pickMarker.remove();pickMarker=null;}},
  flyIn:function(){flyIn();},
  skipIntro:function(){finishArrival();},
  camera:function(d){map.easeTo(Object.assign({duration:reduce?0:600},d));}
};
function onMessage(ev){var m=ev.data;if(typeof m==='string'){try{m=JSON.parse(m);}catch(e){return;}}if(!m||!m.type||!handlers[m.type])return;
  try{handlers[m.type](m);}catch(e){send('log',String(e&&e.message||e));}}
window.addEventListener('message',onMessage);document.addEventListener('message',onMessage);

map.on('style.load',function(){
  map.setFog({color:'#DFE9EE','high-color':'#7399BF','space-color':'#0E1827','horizon-blend':0.08,'star-intensity':0.15});
  addLayers();ready=true;setPlacesData(false);setClosures();setMe();send('ready');
});
setInterval(function(){if(ready)config('lightPreset',campusLight());},60000);
map.on('render',function(){if(ready)renderPins();});
map.on('zoomend',function(){if(state.layers.labels){resetPins(false);renderPins();}});
map.on('click',function(e){
  if(state.pick){var c=[e.lngLat.lng,e.lngLat.lat];if(!pickMarker){var el=document.createElement('div');el.className='drop-pin';
    el.innerHTML='<svg viewBox="0 0 30 42"><path d="M15 41s13-13.6 13-25A13 13 0 002 16c0 11.4 13 25 13 25z" fill="#B5342B" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="16" r="5" fill="#fff"/></svg>';
    pickMarker=new mapboxgl.Marker({element:el,anchor:'bottom'}).setLngLat(c).addTo(map);}else pickMarker.setLngLat(c);send('picked',c);return;}
  send('tapMap',[e.lngLat.lng,e.lngLat.lat]);});
map.on('dragstart',function(){if(state.follow){state.follow=false;send('followOff');}});
map.on('error',function(e){if(!ready)send('error','The map could not load. Check your connection and reopen GoMap.');});
map.once('load',function(){if(FLY)flyIn();else finishArrival();});
setTimeout(function(){if(!ready)send('error','The map is taking a little longer. Check your connection and reopen GoMap.');},20000);
})();
</script></body></html>`;
}
