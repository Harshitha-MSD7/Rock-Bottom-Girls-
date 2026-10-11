import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Upgrade cleanup only. Home is chosen explicitly; the caregiver phone is not
// the patient tracker and must not start background tracking on every login.
export async function stopLegacyLocationTracking() {
  if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return;
  const Location = await import('expo-location');
  const task = 'BACKGROUND_LOCATION_TRACKING';
  if (await Location.hasStartedLocationUpdatesAsync(task))
    await Location.stopLocationUpdatesAsync(task);
}
