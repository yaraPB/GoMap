import { CAMPUS_OUTLINE } from './campusOutline';

/**
 * The photorealistic 3D view: Google's photographed 3D buildings (Map Tiles API, Photorealistic
 * 3D Tiles) rendered with CesiumJS, cut to the campus outline. Based on Amine's Cesium page
 * (branch amine-prest): same tiles, daylight, ambient occlusion and sharpening.
 *
 * It is a separate view to LOOK at campus, not a second map: Mapbox stays the map for everything
 * else (routes, step-free, events, closures). Google's terms do not allow their 3D buildings on
 * top of a non-Google map, which is why this is its own page.
 *
 * Bridge (JSON strings, like the Mapbox page):
 *   in : places {list: [{id, name, coordinates, color}]} · select {id} · user {coord}
 *        route {segments: [{color, coordinates}]} (null clears) · home
 *   out: ready · select (place id) · tapMap · error (message)
 */
export function campus3dHtml(key: string) {
  const KEY = JSON.stringify(key).replace(/</g, '\\u003c');
  const OUTLINE = JSON.stringify(CAMPUS_OUTLINE);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cesium.com/downloads/cesiumjs/releases/1.147/Build/Cesium/Cesium.js"></script>
<link rel="stylesheet" href="https://cesium.com/downloads/cesiumjs/releases/1.147/Build/Cesium/Widgets/widgets.css">
<style>html,body,#map{margin:0;height:100%;width:100%;overflow:hidden;background:#14211b}.cesium-credit-logoContainer{display:inline}.cesium-viewer-bottom{bottom:4px!important}</style>
</head><body><div id="map"></div><script>
var KEY=${KEY};var OUTLINE=${OUTLINE};
function send(type,detail){var m=JSON.stringify({type:type,detail:detail===undefined?null:detail});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m);else if(window.parent!==window)window.parent.postMessage(m,'*');}
(async function(){try{
  Cesium.Ion.defaultAccessToken='';
  var v=new Cesium.Viewer('map',{baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,navigationHelpButton:false,fullscreenButton:false,
    timeline:false,animation:false,sceneModePicker:false,selectionIndicator:false,infoBox:false,terrainProvider:new Cesium.EllipsoidTerrainProvider()});
  // a fixed, bright morning: the photos are lit by daylight, so the scene is too
  v.clock.currentTime=Cesium.JulianDate.fromIso8601('2026-06-21T09:00:00Z');v.clock.shouldAnimate=false;
  if(Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(v.scene)){var ao=v.scene.postProcessStages.ambientOcclusion;ao.enabled=true;ao.uniforms.intensity=1.2;ao.uniforms.bias=.1;ao.uniforms.lengthCap=.4;ao.uniforms.stepCount=16;}
  v.scene.screenSpaceCameraController.minimumZoomDistance=25;v.scene.screenSpaceCameraController.maximumZoomDistance=5000;
  var tiles=await Cesium.Cesium3DTileset.fromUrl('https://tile.googleapis.com/v1/3dtiles/root.json?key='+encodeURIComponent(KEY),{showCreditsOnScreen:true});
  v.scene.primitives.add(tiles);v.scene.globe.show=false;
  // only campus: everything outside the outline the 2D map uses is cut away
  if(Cesium.ClippingPolygonCollection.isSupported(v.scene)){
    tiles.clippingPolygons=new Cesium.ClippingPolygonCollection({polygons:[new Cesium.ClippingPolygon({positions:Cesium.Cartesian3.fromDegreesArray([].concat.apply([],OUTLINE))})],inverse:true});
  }
  v.scene.backgroundColor=Cesium.Color.fromCssColorString('#14211b');
  v.scene.postProcessStages.fxaa.enabled=true;
  v.resolutionScale=Math.min(window.devicePixelRatio||1,1.5);
  // a light sharpen, so roofs and edges read on a phone screen (the geometry is unchanged)
  v.scene.postProcessStages.add(new Cesium.PostProcessStage({name:'gomap-crisp',fragmentShader:'uniform sampler2D colorTexture; in vec2 v_textureCoordinates; void main(){vec2 px=1.0/vec2(textureSize(colorTexture,0));vec3 c=texture(colorTexture,v_textureCoordinates).rgb;vec3 blur=(texture(colorTexture,v_textureCoordinates+vec2(px.x,0.0)).rgb+texture(colorTexture,v_textureCoordinates-vec2(px.x,0.0)).rgb+texture(colorTexture,v_textureCoordinates+vec2(0.0,px.y)).rgb+texture(colorTexture,v_textureCoordinates-vec2(0.0,px.y)).rgb)*0.25;vec3 sharp=c+(c-blur)*0.24;sharp=(sharp-0.5)*1.07+0.5;float lum=dot(sharp,vec3(0.2126,0.7152,0.0722));sharp=mix(vec3(lum),sharp,1.035);out_FragColor=vec4(clamp(sharp,0.0,1.0),1.0);}'}));

  var pins=new Map(),places=[],selected=null,user=null,routeLines=[],groundRun=0;
  var view=function(c,range){return {duration:1.1,offset:new Cesium.HeadingPitchRange(Cesium.Math.toRadians(310),Cesium.Math.toRadians(-48),range)};};
  function home(){v.camera.lookAt(Cesium.Cartesian3.fromDegrees(-5.1061,33.53945,1655),new Cesium.HeadingPitchRange(Cesium.Math.toRadians(310),Cesium.Math.toRadians(-48),v.canvas.clientHeight>v.canvas.clientWidth?740:850));v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);}
  function fly(c){v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(c[0],c[1],1655),18),view(c,150));}
  // campus spans 1,560–1,680 m: put each marker on the real roof or ground under it
  async function ground(items){var run=++groundRun;if(!v.scene.sampleHeightSupported||!items.length)return;
    var carto=items.map(function(it){return Cesium.Cartographic.fromDegrees(it.coord[0],it.coord[1]);});
    try{await v.scene.sampleHeightMostDetailed(carto,items.map(function(it){return it.entity;}));if(run!==groundRun)return;
      items.forEach(function(it,i){if(Number.isFinite(carto[i].height)){carto[i].height+=it.lift;it.entity.position=Cesium.Cartographic.toCartesian(carto[i]);}});}catch(e){}}
  function regroundAll(){var items=[];pins.forEach(function(e,id){var p=places.find(function(x){return x.id===id;});if(p)items.push({entity:e,coord:p.coordinates,lift:1.5});});
    if(user&&user.coord)items.push({entity:user.entity,coord:user.coord,lift:1});ground(items);}
  function style(){pins.forEach(function(e,id){e.point.pixelSize=id===selected?20:13;e.label.show=id===selected;});}

  function receive(event){var m;try{m=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch(e){return;}if(!m||!m.type)return;
    if(m.type==='places'){pins.forEach(function(e){v.entities.remove(e);});pins.clear();places=(m.list||[]).filter(function(p){return p.coordinates;});
      places.forEach(function(p){pins.set(p.id,v.entities.add({id:'place:'+p.id,position:Cesium.Cartesian3.fromDegrees(p.coordinates[0],p.coordinates[1],1660),
        point:{pixelSize:13,color:Cesium.Color.fromCssColorString(p.color||'#139678'),outlineColor:Cesium.Color.WHITE,outlineWidth:3,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{text:p.name,font:'bold 14px sans-serif',show:false,fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-26),disableDepthTestDistance:Number.POSITIVE_INFINITY}}));});
      style();regroundAll();}
    if(m.type==='select'){selected=m.id||null;style();var p=places.find(function(x){return x.id===selected;});if(p)fly(p.coordinates);}
    if(m.type==='user'){if(user)v.entities.remove(user.entity);user=null;
      if(m.coord){user={coord:m.coord,entity:v.entities.add({position:Cesium.Cartesian3.fromDegrees(m.coord[0],m.coord[1],1661),point:{pixelSize:15,color:Cesium.Color.DODGERBLUE,outlineColor:Cesium.Color.WHITE,outlineWidth:3,disableDepthTestDistance:Number.POSITIVE_INFINITY}})};regroundAll();}}
    if(m.type==='route'){routeLines.forEach(function(e){v.entities.remove(e);});routeLines=[];
      (m.segments||[]).forEach(function(s){if(!s.coordinates||s.coordinates.length<2)return;
        routeLines.push(v.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray([].concat.apply([],s.coordinates)),width:7,material:Cesium.Color.fromCssColorString(s.color||'#16A34A'),clampToGround:true}}));});}
    if(m.type==='home')home();
  }
  window.addEventListener('message',receive);document.addEventListener('message',receive);
  // a building's pin opens its card; anywhere else is "outside" and puts the card away
  v.screenSpaceEventHandler.setInputAction(function(e){var hit=v.scene.pick(e.position);
    if(hit&&hit.id&&String(hit.id.id).indexOf('place:')===0)send('select',String(hit.id.id).slice(6));else send('tapMap');},Cesium.ScreenSpaceEventType.LEFT_CLICK);
  home();send('ready');
}catch(e){send('error',String(e&&e.message||e));}})();
</script></body></html>`;
}
