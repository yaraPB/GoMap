import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
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

const center: [number, number] = [-5.1059, 33.5396];
const campusBounds: [[number, number], [number, number]] = [[-5.1092, 33.5381], [-5.1013, 33.5421]];
const mapTilerKey = process.env.EXPO_PUBLIC_MAPTILER_KEY;
const colors: Record<string, string> = {
  'Dining Services': '#db686b', Residential: '#dc8500', Facilities: '#6c7a8c',
  'Campus Services': '#119d97', Academic: '#3269d5', Administrative: '#6650dd',
  'Athletics & Recreation': '#1da853',
};

export default function CampusWebMap({ places, category, focusPlaceId, resetToken, tiltToken, onSelect, onMapError, onMapReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Array<{ marker: maplibregl.Marker; category: string }>>([]);
  const select = useRef(onSelect);
  const ready = useRef(onMapReady);
  const fail = useRef(onMapError);
  select.current = onSelect;
  ready.current = onMapReady;
  fail.current = onMapError;

  useEffect(() => {
    if (!host.current) return;
    let loaded = false;
    const instance = new maplibregl.Map({
      container: host.current,
      center,
      zoom: 17.5,
      pitch: 48,
      bearing: -20,
      maxPitch: 64,
      maxBounds: campusBounds,
      minZoom: 16.5,
      maxZoom: 19.5,
      style: mapTilerKey
        ? `https://api.maptiler.com/maps/hybrid-v4/style.json?key=${mapTilerKey}`
        : {
          version: 8,
          sources: {
            satellite: {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            },
            labels: {
              type: 'raster',
              tiles: ['https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: 'Labels © OpenStreetMap contributors, CARTO',
            },
          },
          layers: [
            { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 1 } },
            { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
          ],
        },
      attributionControl: { compact: false },
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    instance.on('load', () => {
      loaded = true;
      if (mapTilerKey) {
        instance.addSource('aui-terrain', {
          type: 'raster-dem',
          url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${mapTilerKey}`,
          tileSize: 512,
          maxzoom: 14,
        });
        instance.setTerrain({ source: 'aui-terrain', exaggeration: 1.15 });
        if (!instance.getLayer('aui-3d-buildings')) {
          const firstLabelLayer = instance.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
          instance.addLayer({
            id: 'aui-building-edges',
            source: 'maptiler_planet',
            'source-layer': 'building',
            type: 'line',
            minzoom: 15,
            paint: {
              'line-color': '#24323b',
              'line-opacity': 0.34,
              'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 18, 0.8],
            },
          }, firstLabelLayer);
          instance.addLayer({
            id: 'aui-3d-buildings',
            source: 'maptiler_planet',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 15,
            paint: {
              'fill-extrusion-color': ['interpolate', ['linear'], ['zoom'], 15, '#626d78', 17, '#9ca8b1', 19, '#c7d0d4'],
              'fill-extrusion-height': ['max', 4, ['to-number', ['get', 'height'], 6]],
              'fill-extrusion-base': ['to-number', ['get', 'height_min'], 0],
              'fill-extrusion-opacity': 0.88,
              'fill-extrusion-vertical-gradient': true,
            },
          }, firstLabelLayer);
        }
      }
      ready.current();
      instance.fitBounds(campusBounds, { padding: { top: 112, right: 60, bottom: 112, left: 60 }, pitch: 48, bearing: -20, duration: 700 });
    });
    instance.on('error', event => {
      if (!loaded) fail.current(event.error?.message || 'The 3D campus map could not load.');
    });
    return () => {
      markers.current.forEach(({ marker }) => marker.remove());
      markers.current = [];
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markers.current.forEach(({ marker }) => marker.remove());
    markers.current = [];
    const entries = places.flatMap(place => {
      const building = [{ id: place.id, placeId: place.id, name: place.name, category: place.category, lat: place.latitude, lon: place.longitude, entrance: false }];
      const entrances = (place.entrances || []).filter(e => e.mapVisible && Number.isFinite(e.latitude) && Number.isFinite(e.longitude)).map(e => ({ id: e.id, placeId: place.id, name: `${place.name} — ${e.name}`, category: place.category, lat: e.latitude as number, lon: e.longitude as number, entrance: true }));
      return [...building, ...entrances];
    });
    entries.forEach(entry => {
      const el = document.createElement('button');
      el.type = 'button';
      el.title = entry.entrance ? `Verified entrance: ${entry.name}` : `${entry.name} (sample building pin)`;
      el.setAttribute('aria-label', el.title);
      el.className = entry.entrance ? 'gomap-marker gomap-entrance' : 'gomap-marker gomap-place';
      el.style.setProperty('--marker-color', entry.entrance ? '#ffbd55' : (colors[entry.category] || '#138c67'));
      const icon = document.createElement('span');
      icon.className = 'gomap-marker-icon';
      icon.textContent = entry.entrance ? 'E' : '⌖';
      const label = document.createElement('span');
      label.className = 'gomap-marker-label';
      label.textContent = entry.name;
      el.append(icon, label);
      el.onclick = () => select.current(entry.placeId);
      const marker = new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([entry.lon, entry.lat]).addTo(instance);
      markers.current.push({ marker, category: entry.category });
    });
  }, [places]);

  useEffect(() => {
    markers.current.forEach(({ marker, category: pinCategory }) => {
      marker.getElement().style.display = category === 'All' || category === pinCategory ? '' : 'none';
    });
  }, [category, places]);

  useEffect(() => {
    if (!focusPlaceId) return;
    const place = places.find(p => p.id === focusPlaceId);
    if (place) map.current?.flyTo({ center: [place.longitude, place.latitude], zoom: 18.6, pitch: 48, bearing: -20, duration: 800 });
  }, [focusPlaceId, places]);

  useEffect(() => {
    if (resetToken) map.current?.fitBounds(campusBounds, { padding: { top: 112, right: 60, bottom: 112, left: 60 }, pitch: 48, bearing: -20, duration: 700 });
  }, [resetToken]);

  useEffect(() => {
    if (tiltToken) map.current?.easeTo({ pitch: (map.current.getPitch() > 10 ? 0 : 48), duration: 500 });
  }, [tiltToken]);

  return <div className="gomap-map-shell" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#202a31' }}>
    <style>{`
      .gomap-map-shell .maplibregl-map{font:13px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .gomap-map-shell .maplibregl-ctrl-group{border:1px solid #ffffffaa;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px #14222e40}
      .gomap-map-shell .maplibregl-ctrl-attrib{background:#f7f8faeF;border-radius:10px 0 0 0;font-size:10px}
      .gomap-marker{position:relative;display:flex;align-items:center;justify-content:flex-start;width:36px;height:42px;padding:0;border:0;background:transparent;cursor:pointer;filter:drop-shadow(0 3px 5px #10182170);transition:filter .16s}
      .gomap-marker:hover{filter:drop-shadow(0 5px 8px #10182199);z-index:5}
      .gomap-marker-icon{display:grid;place-items:center;flex:none;width:34px;height:34px;border:2px solid #fff;border-radius:50% 50% 50% 7px;transform:rotate(-45deg);background:var(--marker-color);color:#fff;font-size:17px;font-weight:800;box-shadow:0 0 0 1px #10202c26}
      .gomap-entrance .gomap-marker-icon{width:28px;height:28px;border-radius:8px;background:#ffbd55;color:#202936;font-size:12px}
      .gomap-marker-label{position:absolute;left:40px;top:50%;transform:translateY(-50%) translateX(-3px);max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 9px;border:1px solid #ffffffb5;border-radius:9px;background:#142331eb;color:white;font-size:11px;font-weight:650;letter-spacing:.05px;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
      .gomap-marker:hover .gomap-marker-label,.gomap-marker:focus-visible .gomap-marker-label{opacity:1;transform:translateY(-50%) translateX(0)}
      .gomap-map-shell .maplibregl-ctrl-top-right{top:76px;right:14px}
    `}</style>
    <div ref={host} role="img" aria-label="Interactive 3D satellite map of Al Akhawayn University campus only" style={{ position: 'absolute', inset: 0 }} />
  </div>;
}
