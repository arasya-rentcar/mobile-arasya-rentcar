/**
 * Offline queue for everything a driver sends: trip actions (accept / start / arrive / finish)
 * and reports. Items are persisted in AsyncStorage, sent in the order they were made, and retried
 * with backoff while there is no signal. Reports carry a `client_ref` (the item id) so a resend
 * after a lost response never creates a duplicate on the server.
 *
 * Safety rules that keep one bad item from hurting the rest:
 * - An item that keeps failing with a server error (5xx / 408 / 429) is retried at most
 *   MAX_ATTEMPTS times; one that fails on the phone itself (CLIENT_ERROR, e.g. the photo cannot be
 *   read) at most MAX_CLIENT_ATTEMPTS times. Then it is marked `failed`: it is kept (with its
 *   photo) so the driver can press "Coba lagi" or "Hapus", but it no longer blocks anything.
 * - No answer at all (status 0) while the phone says it is offline is not the item's fault and is
 *   not counted. While the phone says it is online it is counted separately (MAX_NET_ATTEMPTS, a
 *   looser limit) and only holds back that item's own trip, so a request that never gets through
 *   (e.g. a timeout on a weak signal) cannot stall the whole queue forever.
 * - Permanent refusals (4xx, including 413 "photo too large") are dropped with a notice.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { api, ApiError, CLIENT_ERROR } from './api';
import { getOnline } from './network';
import { appendPhoto, deletePhoto } from './photos';
import type { GpsFix, Report, ReportType, Trip } from './types';

export type TripAction = 'accept' | 'start' | 'arrive' | 'board' | 'finish';

export type QueueItem = {
  /** Unique id; doubles as the report `client_ref`. */
  id: string;
  tripId: string;
  kind: TripAction | 'report';
  createdAt: string;
  /** Server or phone-side failures (5xx / 408 / 429 / CLIENT_ERROR). */
  attempts: number;
  /** No-answer failures while the phone believed it was online (status 0). */
  netAttempts?: number;
  nextAttemptAt: number;
  lastError?: string;
  /** Gave up automatic retries; waits for the driver ("Coba lagi" / "Hapus"). */
  failed?: boolean;
  notes?: string;
  reportType?: ReportType;
  amount?: number | null;
  photoUri?: string | null;
  /** GPS fix (arrival photo and the arrive action). */
  location?: GpsFix | null;
  /** The photo already carries the time/GPS stamp (else the server adds it). */
  stamped?: boolean;
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
const NET_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
/** About 1.5 hours of retrying at the slowest backoff before an item is marked failed. */
export const MAX_ATTEMPTS = 20;
/** A failure on the phone usually repeats, so the driver is told quickly. */
export const MAX_CLIENT_ATTEMPTS = 3;
/** About 2.5 hours of "online but no answer" before an item stops holding back its trip. */
export const MAX_NET_ATTEMPTS = 30;
export const PHOTO_TOO_LARGE = 'Foto terlalu besar, coba ambil ulang';

let items: QueueItem[] = [];
let loaded = false;
let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let handlers: QueueHandlers = {};
/** Ids this JS context removed (sent, dropped, cleared). Used so a merge never resurrects them. */
const removedIds = new Set<string>();
let canSend: () => boolean = () => true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/**
 * The app and the Android background task run in separate JS contexts that each hold their own
 * copy of the queue. Writing our copy blindly would erase an item the other context enqueued in
 * the meantime (last writer wins). So before every write we re-read storage and keep any stored
 * item that we neither hold nor removed ourselves (union by id, minus our removed ids). Items
 * removed by the other context may come back once and be resent; that is harmless because every
 * item carries a client_ref and the server ignores repeats. Writes are chained so they never
 * interleave within one context.
 */
let persisting: Promise<void> = Promise.resolve();

function persist() {
  persisting = persisting.then(async () => {
    try {
      let foreign: QueueItem[] = [];
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as QueueItem[]) : [];
        const mine = new Set(items.map((i) => i.id));
        if (Array.isArray(stored)) foreign = stored.filter((i) => !mine.has(i.id) && !removedIds.has(i.id));
      } catch {}
      if (foreign.length) {
        items = [...items, ...foreign.map((i) => ({ ...i, nextAttemptAt: 0 }))].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
        emit();
      }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  });
  return persisting;
}

function setItems(next: QueueItem[]) {
  next.forEach((i) => removedIds.delete(i.id));
  items.forEach((i) => {
    if (!next.some((n) => n.id === i.id)) removedIds.add(i.id);
  });
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
  items.forEach((i) => {
    deletePhoto(i.photoUri);
    removedIds.add(i.id);
  });
  items = [];
  emit();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Make every waiting item eligible now (e.g. the driver pulled to refresh or signal came back). */
export function retryNow() {
  if (items.some((i) => !i.failed && i.nextAttemptAt > Date.now())) {
    setItems(items.map((i) => (i.failed ? i : { ...i, nextAttemptAt: 0 })));
  }
  void processQueue();
}

/** "Coba lagi" for failed items (one id, or all when omitted): start over with fresh attempts. */
export function retryFailed(id?: string) {
  if (!items.some((i) => i.failed && (!id || i.id === id))) return;
  setItems(items.map((i) => (i.failed && (!id || i.id === id) ? fresh(i) : i)));
  void processQueue();
}

function fresh(i: QueueItem): QueueItem {
  return { ...i, failed: false, attempts: 0, netAttempts: 0, nextAttemptAt: 0, lastError: undefined };
}

export type SendResult = {
  /** Items in the queue when the driver tapped. */
  before: number;
  /** Items still waiting or failed afterwards. */
  left: number;
  /** Why the first remaining item did not go out. */
  lastError?: string;
};

/**
 * "Kirim sekarang": the driver asked to send everything now, so failed items get fresh attempts
 * too. Resolves when the queue has been worked through, so the screen can say what happened.
 */
export async function sendNow(): Promise<SendResult> {
  const before = items.length;
  if (before) setItems(items.map((i) => (i.failed ? fresh(i) : { ...i, nextAttemptAt: 0 })));
  await processQueue();
  const left = items.length;
  return { before, left, lastError: items.find((i) => i.lastError)?.lastError };
}

/** "Hapus": the driver gives up on an item (its photo is deleted too). */
export function discardItem(id: string) {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  deletePhoto(it.photoUri);
  setItems(items.filter((i) => i.id !== id));
}

function remove(id: string) {
  const it = items.find((i) => i.id === id);
  setItems(items.filter((i) => i.id !== id));
  return it;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  const waiting = items.filter((i) => !i.failed);
  if (!waiting.length) return;
  const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
  const wait = Math.max(1000, next - Date.now());
  timer = setTimeout(() => void processQueue(), wait);
}

/** The API's names for a GPS fix (empty when there is none). */
function locationFields(fix: GpsFix | null | undefined): Record<string, string | number | boolean> {
  if (!fix) return {};
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    ...(fix.accuracy != null ? { location_accuracy_m: Math.round(fix.accuracy) } : {}),
    location_at: fix.at,
    ...(fix.mocked != null ? { location_mocked: fix.mocked } : {}),
  };
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
    for (const [k, v] of Object.entries(locationFields(item.location))) form.append(k, String(v));
    if (item.stamped) form.append('stamped', 'true');
    if (item.photoUri) await appendPhoto(form, item.photoUri, `${item.id}.jpg`);
    const report = await api.uploadReport(item.tripId, form);
    handlers.onReportDone?.(item, report);
    deletePhoto(item.photoUri);
  } else {
    // occurred_at keeps the real time of the tap when it was queued offline.
    // client_ref makes a resent action a no-op on the server (exactly once).
    const body: Record<string, string | number | boolean> = {
      occurred_at: item.createdAt,
      client_ref: item.id,
      ...locationFields(item.location),
    };
    if (item.kind === 'finish' && item.notes) body.notes = item.notes;
    const trip = await api.tripAction(item.tripId, item.kind, body);
    handlers.onActionDone?.(item, trip);
  }
}

/**
 * Works through the queue once (single flight). A call made while a run is going on asks for one
 * more pass and returns the running promise, so callers can always await the outcome.
 */
export function processQueue(): Promise<void> {
  if (!loaded) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = run().finally(() => {
    running = null;
    schedule();
  });
  return running;
}

function update(id: string, patch: Partial<QueueItem>) {
  setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

const GAVE_UP = 'gagal terkirim berkali-kali. Ketuk "Coba lagi" atau "Hapus" di tugas ini.';

async function run(): Promise<void> {
  do {
    rerun = false;
    const blockedTrips = new Set<string>();
    for (const snapshot of [...items]) {
      if (!canSend()) break;
      const item = items.find((i) => i.id === snapshot.id);
      if (!item) continue; // removed meanwhile (e.g. trip dropped)
      if (item.failed) continue; // waits for the driver; does not block the trip
      if (blockedTrips.has(item.tripId)) continue; // keep per-trip order
      if (item.nextAttemptAt > Date.now()) {
        blockedTrips.add(item.tripId);
        continue;
      }
      try {
        await send(item);
        remove(item.id);
      } catch (e) {
        // appendPhoto and other preparation can throw plain errors: those happened on the phone.
        const err = e instanceof ApiError ? e : new ApiError(CLIENT_ERROR, String((e as Error)?.message ?? e));
        if (err.status === 404) {
          const dropped = dropTripItems(item.tripId);
          handlers.onTripGone?.(item.tripId, dropped);
        } else if (err.status === 401) {
          return; // session handler logs the driver out; keep the queue
        } else if (err.status === 0) {
          if (!getOnline()) {
            // Offline: nothing can go out and it is not the item's fault. Not counted; the
            // reconnect event (or the timer) tries again.
            update(item.id, { nextAttemptAt: Date.now() + 30_000, lastError: err.message });
            break;
          }
          const netAttempts = (item.netAttempts ?? 0) + 1;
          const failed = netAttempts >= MAX_NET_ATTEMPTS;
          const delay = NET_BACKOFF_MS[Math.min(netAttempts - 1, NET_BACKOFF_MS.length - 1)];
          update(item.id, { netAttempts, failed, nextAttemptAt: Date.now() + delay, lastError: err.message });
          if (failed) handlers.onRejected?.(item, GAVE_UP);
          else blockedTrips.add(item.tripId); // other trips may still get through
        } else if (err.status === CLIENT_ERROR || err.status === 408 || err.status === 429 || err.status >= 500) {
          const attempts = item.attempts + 1;
          const failed = attempts >= (err.status === CLIENT_ERROR ? MAX_CLIENT_ATTEMPTS : MAX_ATTEMPTS);
          const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          update(item.id, { attempts, failed, nextAttemptAt: Date.now() + delay, lastError: err.message });
          if (failed) handlers.onRejected?.(item, `${GAVE_UP} (${err.message})`);
          else blockedTrips.add(item.tripId);
        } else {
          const gone = remove(item.id);
          deletePhoto(gone?.photoUri);
          handlers.onRejected?.(item, err.status === 413 ? PHOTO_TOO_LARGE : err.message);
        }
      }
    }
  } while (rerun);
}
