import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClosures, usePlaces, useWalkways } from '../src/api/hooks';
import CampusMap from '../src/map/CampusMap';
import { useMap, useMapEvent } from '../src/map/MapContext';
import { useApp, useLocation } from '../src/state/app';
import { useNav } from '../src/state/navigation';
import { usePanels } from '../src/state/panels';
import Assistant from '../src/panels/Assistant';
import Crowding from '../src/panels/Crowding';
import Help from '../src/panels/Help';
import Home from '../src/panels/Home';
import Layers from '../src/panels/Layers';
import Offices from '../src/panels/Offices';
import People from '../src/panels/People';
import PersonPanel from '../src/panels/Person';
import PlaceSheet from '../src/panels/PlaceSheet';
import Report from '../src/panels/Report';
import { Arrived, RoutePreview, TurnByTurn } from '../src/panels/Route';
import Search from '../src/panels/Search';
import Voice from '../src/panels/Voice';
import { Btn, Notice, T } from '../src/ui/kit';
import { color, font } from '../src/ui/theme';

/** Keeps the map in step with app state: places, walkways, closures, you, and the route. */
function MapSync() {
  const map = useMap();
  const places = usePlaces();
  const walkways = useWalkways();
  const closures = useClosures();
  const loc = useLocation();
  const nav = useNav();
  const { top, push } = usePanels();
  const last = useRef('');

  useEffect(() => { if (places.data) map.send({ type: 'places', places: places.data }); }, [places.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (walkways.data) map.send({ type: 'walkways', data: walkways.data }); }, [walkways.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (closures.data) map.send({ type: 'closures', list: closures.data }); }, [closures.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = loc.coord ? `${loc.coord[0].toFixed(6)},${loc.coord[1].toFixed(6)},${Math.round(loc.heading ?? -1)}` : 'none';
    if (key === last.current) return;
    last.current = key;
    map.send({ type: 'user', coord: loc.coord, heading: loc.heading });
  }, [loc.coord, loc.heading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nav.route && ['preview', 'active', 'arrived', 'loading'].includes(nav.status)) {
      map.send({ type: 'route', geometry: nav.route.geometry, crossings: nav.route.crossings, dest: nav.route.geometry.coordinates.at(-1) ?? null, fit: nav.status !== 'active', padding: { top: 210, bottom: 380, left: 40, right: 40 } });
    } else map.send({ type: 'clearRoute' });
  }, [nav.route, nav.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { map.send({ type: 'follow', on: nav.status === 'active' && top.name === 'go' }); }, [nav.status, top.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useMapEvent(e => {
    if (e.type === 'select' && ['home', 'search', 'place', 'layers'].includes(top.name)) push({ name: 'place', id: e.detail });
    if (e.type === 'followOff' && nav.status === 'active') { /* the user dragged the map: stop following until they recentre */ }
  });
  return null;
}

function Panels() {
  const { top } = usePanels();
  switch (top.name) {
    case 'search': return <Search initial={top.query} />;
    case 'place': return <PlaceSheet key={top.id} id={top.id} />;
    case 'offices': return <Offices placeId={top.placeId} department={top.department} />;
    case 'person': return <PersonPanel key={top.id} id={top.id} />;
    case 'people': return <People />;
    case 'assistant': return <Assistant ask={top.ask} />;
    case 'voice': return <Voice />;
    case 'route': return <RoutePreview said={top.said} reply={top.reply} />;
    case 'go': return <TurnByTurn />;
    case 'arrived': return <Arrived />;
    case 'crowding': return <Crowding />;
    case 'layers': return <Layers />;
    case 'report': return <Report at={top.at} />;
    case 'help': return <Help step={top.step} />;
    default: return null;
  }
}

/** Board 01: the wordmark over the opening fly-in, world → Morocco → AUI. */
function Launch({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 900); return () => clearTimeout(t); }, [onDone]);
  return (
    <Animated.View exiting={FadeOut.duration(500)} style={[StyleSheet.absoluteFill, styles.launch]} pointerEvents="none">
      <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: 'center', gap: 8 }}>
        <T style={{ fontFamily: font.display, fontSize: 44, color: '#fff', letterSpacing: -1 }}>GoMap</T>
        <T style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 }}>AL AKHAWAYN UNIVERSITY · IFRANE</T>
      </Animated.View>
    </Animated.View>
  );
}

export default function MapShell() {
  const insets = useSafeAreaInsets();
  const { top, stack, push } = usePanels();
  const map = useMap();
  const { reduceMotion, firstSession, finishOnboarding, user } = useApp();
  const [launching, setLaunching] = useState(true);
  const [offer, setOffer] = useState(false);
  useMapEvent(e => { if (e.type === 'flyInDone' && firstSession && user.role !== 'guest') setTimeout(() => setOffer(true), 900); });
  const showHome = stack.length === 1 || ['place', 'layers', 'help'].includes(top.name);

  return (
    <View style={{ flex: 1, backgroundColor: color.map }}>
      <CampusMap flyIn={!reduceMotion} />
      <MapSync />
      {showHome && top.name !== 'help' && <Home chipsDelay={launching ? 1600 : 0} />}
      <Panels />
      {map.error && (
        <View style={[styles.error, { top: insets.top + 70 }]}>
          <Notice tone="missing" icon="map" text={map.error} />
        </View>
      )}
      {offer && top.name === 'home' && (
        <Animated.View entering={FadeInDown.duration(320)} exiting={FadeOut} style={[styles.offer, { bottom: insets.bottom + 92 }]}>
          <T weight="bold" style={{ fontSize: 16 }}>New to GoMap?</T>
          <T style={{ fontSize: 13.5, color: color.muted, marginTop: 2 }}>A four-step tour of the map, the offices and the assistant.</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Btn title="Show me" small style={{ flex: 1 }} onPress={() => { setOffer(false); push({ name: 'help', step: 0 }); }} />
            <Pressable accessibilityRole="button" onPress={() => { setOffer(false); finishOnboarding(); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T weight="semibold" style={{ color: color.muted }}>Not now</T></Pressable>
          </View>
        </Animated.View>
      )}
      {launching && <Launch onDone={() => setLaunching(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  launch: { backgroundColor: color.night, alignItems: 'center', justifyContent: 'center' },
  error: { position: 'absolute', left: 14, right: 14 },
  offer: { position: 'absolute', left: 12, right: 12, padding: 16, borderRadius: 18, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
});
