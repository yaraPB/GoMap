import { router } from 'expo-router';
import { Camera } from 'expo-camera';

/**
 * Open AR straight into the camera: the permission prompt (first time only) appears over the
 * map, so the AR screen never shows an intermediate "camera off" page.
 */
export async function openAR() {
  try {
    const p = await Camera.getCameraPermissionsAsync();
    if (!p.granted && p.canAskAgain) await Camera.requestCameraPermissionsAsync();
  } catch { /* the AR screen handles a missing camera itself */ }
  router.push('/ar');
}
