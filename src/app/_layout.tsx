import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NoticeHost } from '@/components/NoticeHost';
import '@/lib/backgroundSync'; // registers the background queue task (also for headless starts)
import { persistCache } from '@/lib/cache';
import { colors } from '@/lib/config';
import { onReconnect } from '@/lib/network';
import { addPushListeners, takeLaunchNotification, type PushData } from '@/lib/push';
import { processQueue, retryNow, setQueueGate, setQueueHandlers } from '@/lib/queue';
import { queryClient } from '@/lib/queryClient';
import { SessionProvider, useSession } from '@/lib/session';
import { keys, markNotificationsRead, queueHandlers } from '@/lib/trips';

if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useEffect(() => persistCache(queryClient), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <AppNavigator />
          <NoticeHost />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppNavigator() {
  const session = useSession();
  const segments = useSegments();
  const role = session.user?.role;
  const isDriver = session.status === 'signedIn' && role === 'DRIVER';

  // Route guard.
  useEffect(() => {
    if (session.status === 'loading') return;
    if (Platform.OS !== 'web') void SplashScreen.hideAsync().catch(() => {});
    const first = segments[0] as string | undefined;
    if (session.status === 'signedOut') {
      if (first !== 'login') router.replace('/login');
    } else if (role === 'ADMIN') {
      if (first !== 'admin') router.replace('/admin');
    } else if (first === 'login' || first === 'admin') {
      router.replace('/');
    }
  }, [session.status, role, segments]);

  // Offline queue: sends while logged in as a driver. It does not trust the connectivity flag
  // alone (it can be wrong on flaky networks): failed sends simply back off and retry, and a
  // reconnect event makes everything due immediately.
  useEffect(() => {
    setQueueHandlers(queueHandlers);
    setQueueGate(() => isDriver);
    if (isDriver) void processQueue();
    return onReconnect(() => {
      retryNow();
      void queryClient.invalidateQueries();
    });
  }, [isDriver]);

  // Push: refresh on arrival; on tap open the trip, or the inbox for pushes about money (also
  // when the tap started the app). The tapped notification is marked read in the inbox.
  const launchHandled = useRef(false);
  useEffect(() => {
    if (!isDriver) return;
    const openFromPush = (id: string | null, data: PushData) => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      if (data.notification_id) void markNotificationsRead({ ids: [data.notification_id] });
      if (id && data.type !== 'trip_updated') {
        void queryClient.invalidateQueries({ queryKey: keys.trip(id) });
        router.push({ pathname: '/trip/[id]', params: { id } });
      } else {
        router.push('/notifications');
      }
    };
    if (!launchHandled.current) {
      launchHandled.current = true;
      void takeLaunchNotification().then((n) => n && setTimeout(() => openFromPush(n.tripId, n.data), 300));
    }
    return addPushListeners({
      onReceive: (data) => {
        void queryClient.invalidateQueries({ queryKey: ['trips'] });
        void queryClient.invalidateQueries({ queryKey: keys.notifications });
        if (data.line_id) void queryClient.invalidateQueries({ queryKey: keys.trip(data.line_id) });
      },
      onOpen: (id, data) => openFromPush(id, data),
    });
  }, [isDriver]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTintColor: colors.navy,
          headerTitleStyle: { fontWeight: '800', fontSize: 20, color: colors.navy },
          headerShadowVisible: true,
          contentStyle: { backgroundColor: colors.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="admin" options={{ title: 'Arasya Driver' }} />
        <Stack.Screen name="trip/[id]" options={{ title: 'Detail tugas' }} />
        <Stack.Screen name="report/[id]" options={{ title: 'Kirim laporan', presentation: 'modal' }} />
        <Stack.Screen name="arrive/[id]" options={{ title: 'Sampai di lokasi jemput', presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifikasi' }} />
        <Stack.Screen name="profile" options={{ title: 'Profil' }} />
      </Stack>
      {session.status === 'loading' ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <ActivityIndicator color={colors.white} size="large" />
        </View>
      ) : null}
    </View>
  );
}
