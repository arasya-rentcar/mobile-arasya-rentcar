/**
 * Tiny persistence for the last-known trip data so the driver still sees their trips after
 * reopening the app without signal. Only successful driver queries are stored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const STORAGE_KEY = 'arasya.cache.v1';
const PERSISTED_ROOTS = new Set(['me', 'trips', 'trip', 'notifications', 'requests']);

type Saved = { key: QueryKey; data: unknown; updatedAt: number }[];

export async function hydrateCache(qc: QueryClient) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    for (const entry of saved) {
      if (qc.getQueryData(entry.key) === undefined) {
        qc.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
      }
    }
  } catch {}
}

/** Writes the driver's queries now (also used by the background task, which has no screen). */
export async function saveCache(qc: QueryClient) {
  const saved: Saved = qc
    .getQueryCache()
    .getAll()
    .filter((q) => PERSISTED_ROOTS.has(String(q.queryKey[0])) && q.state.data !== undefined)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .slice(0, 40)
    .map((q) => ({ key: q.queryKey, data: q.state.data, updatedAt: q.state.dataUpdatedAt }));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {}
}

export function persistCache(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    void saveCache(qc);
  };
  const unsub = qc.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' || event.type === 'removed') {
      if (!timer) timer = setTimeout(write, 1000);
    }
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}

export async function clearCache(qc: QueryClient) {
  qc.clear();
  try {
    // Also the inbox "read" marks not sent yet (they belong to this driver).
    await AsyncStorage.multiRemove([STORAGE_KEY, 'arasya.pendingReads.v1']);
  } catch {}
}
