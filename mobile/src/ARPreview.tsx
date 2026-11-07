import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import type { Place } from './api';

type Props = { place: Place; onClose: () => void };
type Position = { latitude: number; longitude: number; accuracy: number | null };

export function distanceAndBearing(from: Position, to: Place) {
  const radians = Math.PI / 180;
  const latitude1 = from.latitude * radians;
  const latitude2 = to.latitude * radians;
  const deltaLatitude = (to.latitude - from.latitude) * radians;
  const deltaLongitude = (to.longitude - from.longitude) * radians;
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const bearing = (Math.atan2(
    Math.sin(deltaLongitude) * Math.cos(latitude2),
    Math.cos(latitude1) * Math.sin(latitude2) - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude),
  ) / radians + 360) % 360;
  return { distance, bearing };
}

export default function ARPreview({ place, onClose }: Props) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [position, setPosition] = useState<Position | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [locationError, setLocationError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);

  useEffect(() => {
    let active = true;
    let positionWatch: Location.LocationSubscription | undefined;
    let headingWatch: Location.LocationSubscription | undefined;
    (async () => {
      try {
        const grant = await Location.requestForegroundPermissionsAsync();
        if (grant.status !== 'granted') { if (active) setLocationError('Allow location to see a direction cue.'); return; }
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) setPosition(first.coords);
        positionWatch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 3 }, update => {
          if (active) setPosition(update.coords);
        });
        headingWatch = await Location.watchHeadingAsync(update => {
          if (active) setHeading(update.trueHeading >= 0 ? update.trueHeading : update.magHeading);
        });
        if (!active) { positionWatch.remove(); headingWatch.remove(); }
      } catch { if (active) setLocationError('Location or compass unavailable. You can still capture a photo.'); }
    })();
    return () => { active = false; positionWatch?.remove(); headingWatch?.remove(); };
  }, []);

  const capture = async () => {
    if (!camera.current || taking) return;
    setTaking(true);
    try {
      const result = await camera.current.takePictureAsync({ quality: 0.75 });
      if (result?.uri) setPhoto(result.uri);
    } catch {
      Alert.alert('Photo unavailable', 'The camera could not capture a photo. Please try again.');
    } finally { setTaking(false); }
  };
  const cue = position ? distanceAndBearing(position, place) : null;
  const turn = cue && heading !== null ? ((cue.bearing - heading + 540) % 360) - 180 : null;
  const direction = turn === null ? 'Waiting for compass' : Math.abs(turn) < 20 ? 'Ahead' : turn > 0 ? 'Turn right' : 'Turn left';

  return <View style={styles.root}>
    {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> :
      permission?.granted ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" /> :
      <View style={styles.permission}><Text style={styles.white}>Camera permission is needed for the live view.</Text>
        <Pressable style={styles.button} onPress={requestPermission}><Text style={styles.buttonText}>Allow camera</Text></Pressable></View>}
    <View pointerEvents="none" style={styles.top}><Text style={styles.title}>{place.name}</Text>
      <Text style={styles.note}>Sample destination pin · verify on campus</Text></View>
    {!photo && permission?.granted && <View pointerEvents="none" style={styles.center}>
      <Text style={[styles.arrow, { transform: [{ rotate: `${Math.max(-90, Math.min(90, turn || 0))}deg` }] }]}>↑</Text>
      <Text style={styles.direction}>{direction}</Text>
      <Text style={styles.white}>{cue ? `About ${Math.round(cue.distance)} m straight-line distance` : 'Finding your location…'}</Text>
      {position?.accuracy != null && position.accuracy > 30 && <Text style={styles.warning}>GPS accuracy is about {Math.round(position.accuracy)} m</Text>}
      {!!locationError && <Text style={styles.warning}>{locationError}</Text>}
    </View>}
    <View style={styles.bottom}>
      <Text style={styles.note}>Camera guide only. No verified walking route or photo upload.</Text>
      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Back to map</Text></Pressable>
        {photo ? <Pressable style={styles.button} onPress={() => setPhoto(null)}><Text style={styles.buttonText}>Retake</Text></Pressable> :
          permission?.granted && <Pressable style={styles.button} onPress={capture} disabled={taking}>
            {taking ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Capture photo</Text>}
          </Pressable>}
      </View>
      {photo && <Text style={styles.note}>Photo stored in the app cache; the system may remove it.</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#152b29' },
  permission: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 30 },
  top: { position: 'absolute', top: 18, left: 18, right: 18, padding: 15, borderRadius: 12, backgroundColor: '#152b29dd' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  note: { color: '#e0e9e5', fontSize: 12, marginTop: 5 },
  center: { position: 'absolute', top: '33%', left: 20, right: 20, alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: '#152b29bb' },
  arrow: { color: '#fff', fontSize: 74, lineHeight: 82 },
  direction: { color: '#fff', fontSize: 23, fontWeight: '700', marginBottom: 8 },
  white: { color: '#fff', textAlign: 'center' },
  warning: { color: '#ffe19a', marginTop: 8, textAlign: 'center' },
  bottom: { position: 'absolute', bottom: 15, left: 18, right: 18, backgroundColor: '#152b29dd', padding: 14, borderRadius: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: { flex: 1, backgroundColor: '#138c67', minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', padding: 8 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
