import { AppState, Platform } from 'react-native';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';
import { subscribeOnline } from './network';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      staleTime: 15_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (count, err) => {
        if (err instanceof ApiError && err.status > 0 && err.status < 500) return false;
        return count < 2;
      },
    },
  },
});

onlineManager.setEventListener((setOnline) => subscribeOnline(setOnline));

if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s) => handleFocus(s === 'active'));
    return () => sub.remove();
  });
}
