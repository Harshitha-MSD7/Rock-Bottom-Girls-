import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

export const LOCATION_TASK_NAME = 'BACKGROUND_LOCATION_TRACKING';

// Define the background task at the top level of the file
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {

  if (error) {
    console.error('Background location error:', error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    const location = locations[0];

    if (location) {
      const { latitude, longitude, accuracy } = location.coords;
      const timestamp = new Date(location.timestamp).toISOString();


      /*

      TODO: Uncomment this once your backend server is ready

      try {
        // Read token directly from SecureStore since task runs outside React
        const token = await SecureStore.getItemAsync('auth_token');

        if (!token) {
          // User is logged out; quietly skip posting location data in the background
          return;
        }

        const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com';

        if (token) {
          await axios.post(
            `${apiUrl}/locations`,
            { latitude, longitude, accuracy, timestamp },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
      } catch (err: any) {
        console.error('Failed to post background location:', err.message);
      }
      */
    }
  }
});

export async function startBackgroundLocation() {
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();

  if (foregroundStatus !== 'granted') {
    throw new Error('Foreground location permission not granted');
  }

  const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();

  if (backgroundStatus !== 'granted') {
    throw new Error('Background location permission not granted (Allow all the time required)');
  }

  // TEMPORARY DEBUG: prove foreground location works at all
  const pos = await Location.getCurrentPositionAsync({});

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10000, // Every 10 seconds
    distanceInterval: 1, // Or 1 meter
    foregroundService: {
      notificationTitle: 'Caretaker App Active',
      notificationBody: 'Tracking location in background for safety monitoring.',
      notificationColor: '#2563EB',
    },
  });

  // TEMPORARY DEBUG: confirm the task actually started
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
}