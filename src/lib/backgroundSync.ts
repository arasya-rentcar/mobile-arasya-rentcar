/**
 * Sends the offline queue while the app is closed or in the background.
 * Android runs the task roughly every 15 minutes when there is a connection
 * (WorkManager decides the exact time). It uses the same queue and the same
 * single-flight processor as the app, and every item carries its own id as an
 * idempotency key, so an item sent by both the task and the app, or resent
 * after a lost response, is still recorded only once on the server.
 */
import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { hasAuthToken, setAuthToken } from './api';
import { hydrateCache, saveCache } from './cache';
import { getQueue, hasQueueHandlers, loadQueue, processQueue, setQueueHandlers } from './queue';
import { queryClient } from './queryClient';
import { secureStorage, TOKEN_KEY } from './storage';
import { queueHandlers } from './trips';

export const QUEUE_SYNC_TASK = 'arasya-queue-sync';

// Must run at module load (also when Android starts the app headless just for
// the task), so this file is imported from the root layout.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(QUEUE_SYNC_TASK, async () => {
    try {
      await loadQueue();
      if (getQueue().length === 0) return BackgroundTask.BackgroundTaskResult.Success;
      if (!hasAuthToken()) {
        const token = await secureStorage.get(TOKEN_KEY);
        if (!token) return BackgroundTask.BackgroundTaskResult.Success; // logged out
        setAuthToken(token);
      }
      // App closed (headless start): no screen set the queue handlers, so what gets sent here would
      // be missing from the saved trip data. Opened later without signal, the app would then show
      // a sent report as not there (next "Checkpoint N" repeated on the photo, odometer buttons
      // wrong). Load the saved data, let the usual handlers record the answers, then save it.
      const headless = !hasQueueHandlers();
      if (headless) {
        await hydrateCache(queryClient);
        setQueueHandlers(queueHandlers);
      }
      await processQueue();
      if (headless) await saveCache(queryClient);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function enableBackgroundSync() {
  if (Platform.OS === 'web') return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(QUEUE_SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(QUEUE_SYNC_TASK, { minimumInterval: 15 });
    }
  } catch (e) {
    console.warn('Background sync not available', e);
  }
}

export async function disableBackgroundSync() {
  if (Platform.OS === 'web') return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(QUEUE_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(QUEUE_SYNC_TASK);
    }
  } catch {}
}
