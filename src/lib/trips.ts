import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { api, ApiError } from './api';
import { showNotice } from './notices';
import { dropTripItems, enqueue, sendNow, useQueue, type QueueItem, type TripAction } from './queue';
import { queryClient } from './queryClient';
import { applyPending } from './tripState';
import type { GpsFix, NotificationPage, Trip, TripDetail } from './types';

export const keys = {
  me: ['me'] as const,
  notifications: ['notifications'] as const,
  trips: (scope: 'active' | 'history') => ['trips', scope] as const,
  trip: (id: string) => ['trip', id] as const,
};

export function useMe(enabled = true) {
  return useQuery({ queryKey: keys.me, queryFn: api.me, enabled });
}

/** The inbox (newest 50) and the unread count for the bell badge. */
export function useNotifications(enabled = true) {
  return useQuery<NotificationPage>({ queryKey: keys.notifications, queryFn: () => api.notifications(), enabled });
}

/** Marks notifications read on the server; the badge updates right away. */
export async function markNotificationsRead(input: { ids?: string[]; all?: boolean }) {
  queryClient.setQueryData<NotificationPage>(keys.notifications, (old) => {
    if (!old) return old;
    const hit = (id: string) => input.all || input.ids?.includes(id);
    const items = old.items.map((n) => (hit(n.id) ? { ...n, read: true } : n));
    const newlyRead = old.items.filter((n) => !n.read && hit(n.id)).length;
    return { items, unread: input.all ? 0 : Math.max(0, old.unread - newlyRead) };
  });
  try {
    const r = await api.readNotifications(input);
    queryClient.setQueryData<NotificationPage>(keys.notifications, (old) => (old ? { ...old, unread: r.unread } : old));
  } catch {
    // Offline: shown as read here; the server catches up on the next refresh.
  }
}

export function useTrips(scope: 'active' | 'history') {
  const query = useQuery({ queryKey: keys.trips(scope), queryFn: () => api.trips(scope) });
  const queue = useQueue();
  // A trip finished offline stays in "Tugas" until the server confirms it.
  const trips = useMemo(() => (query.data ?? []).map((t) => applyPending(t, queue)), [query.data, queue]);
  return { ...query, trips };
}

export function useTrip(id: string) {
  const query = useQuery({
    queryKey: keys.trip(id),
    queryFn: async () => {
      try {
        return await api.trip(id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) tripGone(queryClient, id, dropTripItems(id));
        throw e;
      }
    },
    // Show what the list already knows while the detail loads.
    placeholderData: () => findTripInLists(id),
  });
  const queue = useQueue();
  const trip = useMemo(() => (query.data ? applyPending(query.data, queue) : undefined), [query.data, queue]);
  return { ...query, trip };
}

function findTripInLists(id: string): TripDetail | undefined {
  for (const scope of ['active', 'history'] as const) {
    const t = queryClient.getQueryData<Trip[]>(keys.trips(scope))?.find((x) => x.id === id);
    if (t) return { ...t, reports: [], expenses: [] };
  }
  return undefined;
}

function patchTripEverywhere(qc: QueryClient, trip: Trip) {
  qc.setQueryData<TripDetail>(keys.trip(trip.id), (old) => (old ? { ...old, ...trip } : old));
  for (const scope of ['active', 'history'] as const) {
    qc.setQueryData<Trip[]>(keys.trips(scope), (old) => old?.map((t) => (t.id === trip.id ? { ...t, ...trip } : t)));
  }
}

export function tripGone(qc: QueryClient, id: string, dropped: QueueItem[]) {
  const known = findTripInLists(id) ?? qc.getQueryData<TripDetail>(keys.trip(id));
  qc.removeQueries({ queryKey: keys.trip(id) });
  for (const scope of ['active', 'history'] as const) {
    qc.setQueryData<Trip[]>(keys.trips(scope), (old) => old?.filter((t) => t.id !== id));
  }
  const where = known ? ` (${known.pickup_location} → ${known.dropoff_location})` : '';
  const extra = dropped.length ? ` ${dropped.length} data yang belum terkirim untuk tugas ini dibatalkan.` : '';
  showNotice(`Tugas${where} sudah tidak ditugaskan ke Anda.${extra}`, 'error', 8000);
}

/** Handlers the offline queue calls after the server answered. */
export const queueHandlers = {
  onActionDone(item: QueueItem, trip: Trip) {
    patchTripEverywhere(queryClient, trip);
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
    if (item.kind === 'finish') void queryClient.invalidateQueries({ queryKey: keys.trip(item.tripId) });
  },
  onReportDone(item: QueueItem) {
    void queryClient.invalidateQueries({ queryKey: keys.trip(item.tripId) });
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  },
  onTripGone(tripId: string, dropped: QueueItem[]) {
    tripGone(queryClient, tripId, dropped);
  },
  onRejected(item: QueueItem, message: string) {
    const what = item.kind === 'report' ? 'Laporan' : 'Perubahan status';
    showNotice(`${what} tidak bisa dikirim: ${message}`, 'error', 8000);
    void queryClient.invalidateQueries({ queryKey: keys.trip(item.tripId) });
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  },
};

export function doTripAction(tripId: string, kind: TripAction, notes?: string, location?: GpsFix | null) {
  return enqueue({ tripId, kind, notes: notes?.trim() || undefined, location: location ?? undefined });
}

let sendingNow = false;
const sendingListeners = new Set<() => void>();
function setSendingNow(v: boolean) {
  sendingNow = v;
  sendingListeners.forEach((l) => l());
}

/** True while a "Kirim sekarang" tap is being worked on (to show a spinner). */
export function useSendingNow() {
  return useSyncExternalStore(
    (l) => {
      sendingListeners.add(l);
      return () => sendingListeners.delete(l);
    },
    () => sendingNow,
    () => sendingNow,
  );
}

/** "Kirim sekarang" / "ketuk untuk kirim": sends everything and says what happened. */
export async function sendQueueNow() {
  if (sendingNow) return;
  setSendingNow(true);
  showNotice('Mengirim data...', 'info', 2500);
  try {
    const r = await sendNow();
    if (!r.before) showNotice('Tidak ada data yang menunggu dikirim.', 'info');
    else if (!r.left) showNotice('Semua data sudah terkirim.', 'success');
    else showNotice(`${r.left} data belum terkirim.${r.lastError ? ` Penyebab: ${r.lastError}` : ''}`, 'error', 10000);
  } finally {
    setSendingNow(false);
  }
}
