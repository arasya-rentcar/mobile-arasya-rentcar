/**
 * Offline queue for everything a driver sends: trip actions (accept / start / arrive / finish)
 * and reports. Items are persisted in AsyncStorage, sent in the order they were made, and retried
 * with backoff while there is no signal. Reports carry a `client_ref` (the item id) so a resend
 * after a lost response never creates a duplicate on the server.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { api, ApiError } from './api';
import { appendPhoto, deletePhoto } from './photos';
import type { Report, ReportType, Trip } from './types';

export type TripAction = 'accept' | 'start' | 'arrive' | 'finish';

export type QueueItem = {
  /** Unique id; doubles as the report `client_ref`. */
  id: string;
  tripId: string;
  kind: TripAction | 'report';
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  notes?: string;
  reportType?: ReportType;
  amount?: number | null;
  photoUri?: string | null;
};

export type QueueHandlers = {
  onActionDone?: (item: QueueItem, trip: Trip) => void;
  onReportDone?: (item: QueueItem, report: Report) => void;
  /** 404: the trip is no longer assigned to this driver. */
  onTripGone?: (tripId: string, droppedItems: QueueItem[]) => void;
  /** Server refused the item for good (e.g. 409 trip cancelled). */
  onRejected?: (item: QueueItem, message: string) => void;
};

const STORAGE_KEY = 'arasya.queue.v1';
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

let items: QueueItem[] = [];
let loaded = false;
let processing = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let handlers: QueueHandlers = {};
let canSend: () => boolean = () => true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

function setItems(next: QueueItem[]) {
  items = next;
  emit();
  void persist();
}

export async function loadQueue() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    // Anything loaded from disk may be retried right away.
    items = Array.isArray(parsed) ? parsed.map((i) => ({ ...i, nextAttemptAt: 0 })) : [];
  } catch {
    items = [];
  }
  loaded = true;
  emit();
}

export function setQueueHandlers(h: QueueHandlers) {
  handlers = h;
}

/** Gate used by the processor (logged in + online). */
export function setQueueGate(fn: () => boolean) {
  canSend = fn;
}

export function getQueue() {
  return items;
}

export function useQueue(): QueueItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}

export function newId() {
  return Crypto.randomUUID();
}

export function enqueue(input: Omit<QueueItem, 'id' | 'createdAt' | 'attempts' | 'nextAttemptAt'> & { id?: string }) {
  const item: QueueItem = {
    ...input,
    id: input.id ?? newId(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
  };
  setItems([...items, item]);
  void processQueue();
  return item;
}

export function dropTripItems(tripId: string): QueueItem[] {
  const dropped = items.filter((i) => i.tripId === tripId);
  if (dropped.length) {
    dropped.forEach((i) => deletePhoto(i.photoUri));
    setItems(items.filter((i) => i.tripId !== tripId));
  }
  return dropped;
}

export async function clearQueue() {
  items.forEach((i) => deletePhoto(i.photoUri));
  items = [];
  emit();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Make every waiting item eligible now (e.g. the driver pulled to refresh or signal came back). */
export function retryNow() {
  if (items.some((i) => i.nextAttemptAt > Date.now())) {
    setItems(items.map((i) => ({ ...i, nextAttemptAt: 0 })));
  }
  void processQueue();
}

function remove(id: string) {
  const it = items.find((i) => i.id === id);
  setItems(items.filter((i) => i.id !== id));
  return it;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!items.length) return;
  const next = Math.min(...items.map((i) => i.nextAttemptAt));
  const wait = Math.max(1000, next - Date.now());
  timer = setTimeout(() => void processQueue(), wait);
}

async function send(item: QueueItem) {
  if (item.kind === 'report') {
    const form = new FormData();
    form.append('report_type', item.reportType ?? 'NOTE');
    form.append('client_ref', item.id);
    // When it was recorded on the phone (it may be sent much later).
    form.append('occurred_at', item.createdAt);
    if (item.notes) form.append('notes', item.notes);
    if (item.amount != null) form.append('amount', String(item.amount));
    if (item.photoUri) await appendPhoto(form, item.photoUri, `${item.id}.jpg`);
    const report = await api.uploadReport(item.tripId, form);
    handlers.onReportDone?.(item, report);
    deletePhoto(item.photoUri);
  } else {
    // occurred_at keeps the real time of the tap when it was queued offline.
    const body: { notes?: string; occurred_at?: string } = { occurred_at: item.createdAt };
    if (item.kind === 'finish' && item.notes) body.notes = item.notes;
    const trip = await api.tripAction(item.tripId, item.kind, body);
    handlers.onActionDone?.(item, trip);
  }
}

export async function processQueue(): Promise<void> {
  if (!loaded) return;
  if (processing) {
    rerun = true;
    return;
  }
  processing = true;
  try {
    do {
      rerun = false;
      const blockedTrips = new Set<string>();
      for (const snapshot of [...items]) {
        if (!canSend()) break;
        const item = items.find((i) => i.id === snapshot.id);
        if (!item) continue; // removed meanwhile (e.g. trip dropped)
        if (blockedTrips.has(item.tripId)) continue; // keep per-trip order
        if (item.nextAttemptAt > Date.now()) {
          blockedTrips.add(item.tripId);
          continue;
        }
        try {
          await send(item);
          remove(item.id);
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(0, String((e as Error)?.message ?? e));
          if (err.status === 404) {
            const dropped = dropTripItems(item.tripId);
            handlers.onTripGone?.(item.tripId, dropped);
          } else if (err.status === 401) {
            return; // session handler logs the driver out; keep the queue
          } else if (err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500) {
            const attempts = item.attempts + 1;
            const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
            setItems(
              items.map((i) =>
                i.id === item.id ? { ...i, attempts, nextAttemptAt: Date.now() + delay, lastError: err.message } : i,
              ),
            );
            if (err.status === 0) break; // no signal: stop for now, timer retries later
            blockedTrips.add(item.tripId);
          } else {
            const gone = remove(item.id);
            deletePhoto(gone?.photoUri);
            handlers.onRejected?.(item, err.message);
          }
        }
      }
    } while (rerun);
  } finally {
    processing = false;
    schedule();
  }
}
