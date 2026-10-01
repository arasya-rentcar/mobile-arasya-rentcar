import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { clearCache, hydrateCache } from './cache';
import { clearQueue, loadQueue } from './queue';
import { queryClient } from './queryClient';
import { registerForPush, unregisterPush } from './push';
import { secureStorage, TOKEN_KEY } from './storage';
import { disableBackgroundSync, enableBackgroundSync } from './backgroundSync';
import { showNotice } from './notices';
import type { User } from './types';

const USER_KEY = 'arasya.user';
const QUEUE_OWNER_KEY = 'arasya.queueOwner';

type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: User };

type SessionContextValue = SessionState & {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  // Restore the saved session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, userRaw] = await Promise.all([secureStorage.get(TOKEN_KEY), secureStorage.get(USER_KEY)]);
      await loadQueue();
      let user: User | null = null;
      try {
        user = userRaw ? (JSON.parse(userRaw) as User) : null;
      } catch {}
      if (cancelled) return;
      if (token && user) {
        setAuthToken(token);
        await hydrateCache(queryClient);
        setState({ status: 'signedIn', user });
        if (user.role === 'DRIVER') {
          void registerForPush();
          void enableBackgroundSync();
        }
      } else {
        setState({ status: 'signedOut', user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearLocal = useCallback(async () => {
    setAuthToken(null);
    await Promise.all([secureStorage.remove(TOKEN_KEY), secureStorage.remove(USER_KEY)]);
    await clearCache(queryClient);
    setState({ status: 'signedOut', user: null });
  }, []);

  // 401 anywhere: the token is no longer valid. Keep queued reports so they can still be sent
  // after the same driver logs in again.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      showNotice('Sesi Anda sudah berakhir. Silakan masuk lagi.', 'error');
      void clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const login = useCallback(async (identifier: string, password: string) => {
    const { token, user } = await api.login(identifier.trim(), password);
    setAuthToken(token);
    // Never send one driver's unsent reports with another driver's account.
    const owner = await secureStorage.get(QUEUE_OWNER_KEY);
    if (owner && owner !== user.id) await clearQueue();
    await Promise.all([
      secureStorage.set(TOKEN_KEY, token),
      secureStorage.set(USER_KEY, JSON.stringify(user)),
      secureStorage.set(QUEUE_OWNER_KEY, user.id),
    ]);
    setState({ status: 'signedIn', user });
    if (user.role === 'DRIVER') {
      void registerForPush();
      void enableBackgroundSync();
    }
  }, []);

  const logout = useCallback(async () => {
    await disableBackgroundSync();
    await unregisterPush();
    await clearQueue();
    await secureStorage.remove(QUEUE_OWNER_KEY);
    await clearLocal();
  }, [clearLocal]);

  const value = useMemo(() => ({ ...state, login, logout }) as SessionContextValue, [state, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
