import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

const isWeb = Platform.OS === 'web';

export function isOnlineState(s: NetInfoState) {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

/**
 * Subscribes to connectivity changes. Native: NetInfo. Web: the browser's online/offline events
 * (NetInfo's web reachability probe pings a third-party URL that is often blocked).
 */
export function subscribeOnline(fn: (online: boolean) => void): () => void {
  if (isWeb) {
    if (typeof window === 'undefined') return () => {};
    const on = () => fn(true);
    const off = () => fn(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    fn(navigator.onLine !== false);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }
  return NetInfo.addEventListener((s) => fn(isOnlineState(s)));
}

let online = true;
export const getOnline = () => online;

export function useOnline() {
  const [value, setValue] = useState(online);
  useEffect(
    () =>
      subscribeOnline((v) => {
        online = v;
        setValue(v);
      }),
    [],
  );
  return value;
}

/** Calls `fn` whenever the connection comes back. */
export function onReconnect(fn: () => void) {
  let was = online;
  return subscribeOnline((now) => {
    online = now;
    if (now && !was) fn();
    was = now;
  });
}
