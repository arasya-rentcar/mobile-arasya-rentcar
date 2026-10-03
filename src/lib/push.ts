import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { api } from './api';
import { secureStorage } from './storage';

const PUSH_TOKEN_KEY = 'arasya.pushToken';
export const TRIPS_CHANNEL = 'trips';

export type PushData = {
  type?: 'trip_assigned' | 'trip_reminder' | 'trip_updated' | 'order_paid' | 'payable_paid' | 'expense_rejected';
  line_id?: string;
  /** The inbox row this push was stored as (marked read when the push is opened). */
  notification_id?: string;
};

const pushSupported = Platform.OS !== 'web';

if (pushSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(TRIPS_CHANNEL, {
    name: 'Tugas perjalanan',
    description: 'Tugas baru, pengingat, perubahan tugas, pelunasan order dan pembayaran fee',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
    lightColor: '#046bd2',
    sound: 'default',
  });
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? Constants.easConfig?.projectId;
}

/**
 * Asks for permission, gets the Expo push token and registers it with the backend.
 * Silently does nothing on web, emulators, or when `eas init` has not been run yet.
 */
export async function registerForPush(): Promise<string | null> {
  if (!pushSupported || !Device.isDevice) return null;
  try {
    await ensureChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const id = projectId();
    if (!id) {
      console.warn('Push notifications disabled: run `eas init` to set extra.eas.projectId in app.json');
      return null;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    await secureStorage.set(PUSH_TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.warn('Push registration failed', e);
    return null;
  }
}

/**
 * Tells the backend to stop sending pushes to this device. `afterUnauthorized` is for the 401
 * logout, where the session token is already refused: the call is still tried (without triggering
 * another logout) in case the server accepts it.
 */
export async function unregisterPush(afterUnauthorized = false) {
  const token = await secureStorage.get(PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await api.unregisterDevice(token, { skipAuthHandling: afterUnauthorized });
  } catch {}
  await secureStorage.remove(PUSH_TOKEN_KEY);
}

export function tripIdFromResponse(res: Notifications.NotificationResponse | null | undefined): string | null {
  const data = res?.notification.request.content.data as PushData | undefined;
  return typeof data?.line_id === 'string' && data.line_id ? data.line_id : null;
}

export function addPushListeners(handlers: {
  onReceive: (data: PushData) => void;
  onOpen: (tripId: string | null, data: PushData) => void;
}) {
  if (!pushSupported) return () => {};
  const a = Notifications.addNotificationReceivedListener((n) =>
    handlers.onReceive((n.request.content.data ?? {}) as PushData),
  );
  const b = Notifications.addNotificationResponseReceivedListener((res) =>
    handlers.onOpen(tripIdFromResponse(res), (res.notification.request.content.data ?? {}) as PushData),
  );
  return () => {
    a.remove();
    b.remove();
  };
}

/** The notification that launched the app (cold start), if any; cleared after reading. */
export async function takeLaunchNotification(): Promise<{ tripId: string | null; data: PushData } | null> {
  if (!pushSupported) return null;
  try {
    const res = await Notifications.getLastNotificationResponseAsync();
    if (!res) return null;
    await Notifications.clearLastNotificationResponseAsync();
    return { tripId: tripIdFromResponse(res), data: (res.notification.request.content.data ?? {}) as PushData };
  } catch {
    return null;
  }
}
