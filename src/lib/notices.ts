import { useSyncExternalStore } from 'react';

export type Notice = { id: number; text: string; tone: 'info' | 'success' | 'error' };

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a short message at the top of the screen (works the same on device and web). */
export function showNotice(text: string, tone: Notice['tone'] = 'info', durationMs = 3500) {
  const notice = { id: nextId++, text, tone };
  notices = [...notices.slice(-1), notice];
  emit();
  setTimeout(() => dismissNotice(notice.id), durationMs);
}

export function dismissNotice(id: number) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function useNotices() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notices,
    () => notices,
  );
}
