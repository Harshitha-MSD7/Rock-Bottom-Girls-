import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { request } from './api';

const KEY = 'careq.push-registration';
type Registration = { token: string; userId: string };
const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
export function notificationUnavailableReason() {
  if (Platform.OS === 'web') return 'Push alerts require the mobile app.';
  if (Constants.appOwnership === 'expo')
    return 'Push alerts require a development build; use the Status tab while testing in Expo Go.';
  if (!projectId)
    return 'Link an EAS project and configure push credentials before enabling alerts.';
  return null;
}
async function saved(): Promise<Registration | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}
async function removeRegistration(accessToken: string, userId: string) {
  const previous = await saved();
  if (!previous) return;
  if (previous.userId !== userId)
    throw new Error(
      'Sign in to the previously registered account to remove its push alerts first.',
    );
  await request(accessToken, '/api/push-tokens', { token: previous.token }, 'DELETE');
  await AsyncStorage.removeItem(KEY);
}
async function register(accessToken: string, userId: string, ask = true) {
  const reason = notificationUnavailableReason();
  if (reason) throw new Error(reason);
  const previous = await saved();
  if (previous && previous.userId !== userId)
    throw new Error('Remove push alerts from the previous account before switching accounts.');
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('careq-alerts', {
      name: 'Watch alerts',
      importance: Notifications.AndroidImportance.HIGH,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error('Allow notifications in your phone settings to receive watch alerts.');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (previous && previous.token !== token) await removeRegistration(accessToken, userId);
  // Persist before the request so logout can remove a token even if the reply is lost.
  await AsyncStorage.setItem(KEY, JSON.stringify({ token, userId }));
  await request(accessToken, '/api/push-tokens', { token });
}
// Serialize refresh, button actions and logout so a late registration cannot
// re-enable alerts after the user has removed the token.
let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = operations.then(work, work);
  operations = next.catch(() => {});
  return next;
}
export const disablePush = (token: string, userId: string) =>
  serialized(() => removeRegistration(token, userId));
export const enablePush = (token: string, userId: string) =>
  serialized(() => register(token, userId));
export const restorePush = (token: string, userId: string) =>
  serialized(async () => {
    if (!(await saved())) return false;
    await register(token, userId, false);
    return true;
  });
