import { formatKm, formatRupiah } from './format';
import type { QueueItem, TripAction } from './queue';
import type { Trip } from './types';

export function isAccepted(t: Trip) {
  return !!t.accepted_at || t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' || t.status === 'DONE';
}

export type Chip = { label: string; tone: 'new' | 'accepted' | 'running' | 'done' | 'cancelled' };

export function statusChip(t: Trip): Chip {
  if (t.status === 'CANCELLED') return { label: 'Dibatalkan', tone: 'cancelled' };
  if (t.status === 'DONE') return { label: 'Selesai', tone: 'done' };
  if (t.status === 'IN_PROGRESS' || t.actual_start_at) return { label: 'Berjalan', tone: 'running' };
  if (isAccepted(t)) return { label: 'Diterima', tone: 'accepted' };
  return { label: 'Tugas baru', tone: 'new' };
}

/** The single next action the driver should take, or null when nothing is left. */
export function nextAction(t: Trip): TripAction | null {
  if (t.status === 'DONE' || t.status === 'CANCELLED') return null;
  if (!isAccepted(t)) return 'accept';
  if (!t.actual_start_at && t.status !== 'IN_PROGRESS') return 'start';
  if (!t.actual_pickup_at) return 'arrive';
  return 'finish';
}

export const ACTION_LABEL: Record<TripAction, string> = {
  accept: 'Terima tugas',
  start: 'Berangkat dari garasi',
  arrive: 'Sampai di lokasi jemput',
  finish: 'Selesai',
};

export const ACTION_DONE_TEXT: Record<TripAction, string> = {
  accept: 'Tugas diterima',
  start: 'Tercatat: berangkat dari garasi',
  arrive: 'Tercatat: sampai di lokasi jemput',
  finish: 'Tugas selesai. Terima kasih!',
};

/** Applies actions that are still waiting in the queue so the screen shows them right away. */
export function applyPending<T extends Trip>(trip: T, queue: QueueItem[]): T {
  const pending = queue.filter((q) => q.tripId === trip.id && q.kind !== 'report');
  const pendingReports = queue.filter((q) => q.tripId === trip.id && q.kind === 'report').length;
  if (!pending.length && !pendingReports) return trip;
  const t: T = { ...trip, report_count: trip.report_count + pendingReports };
  if (t.status === 'CANCELLED') return t;
  for (const q of pending) {
    const at = q.createdAt;
    switch (q.kind) {
      case 'accept':
        t.accepted_at ??= at;
        break;
      case 'start':
        t.accepted_at ??= at;
        t.actual_start_at ??= at;
        if (t.status !== 'DONE') t.status = 'IN_PROGRESS';
        break;
      case 'arrive':
        t.accepted_at ??= at;
        t.actual_pickup_at ??= at;
        break;
      case 'finish':
        t.accepted_at ??= at;
        t.trip_finished_at ??= at;
        t.status = 'DONE';
        break;
    }
  }
  return t;
}

export const REPORT_LABEL: Record<string, string> = {
  ODOMETER_START: 'Odometer awal',
  ODOMETER_END: 'Odometer akhir',
  FUEL: 'Bensin',
  TOLL: 'Tol',
  PARKING: 'Parkir',
  OTHER_COST: 'Biaya lain',
  PHOTO: 'Foto',
  NOTE: 'Catatan',
};

export const COST_TYPES = ['FUEL', 'TOLL', 'PARKING', 'OTHER_COST'];

export const ODOMETER_TYPES = ['ODOMETER_START', 'ODOMETER_END'];

/** `amount` means km for odometer reports and rupiah for cost reports. */
export function formatReportAmount(type: string, amount: number | null | undefined): string | null {
  if (amount == null) return null;
  return ODOMETER_TYPES.includes(type) ? formatKm(amount) : formatRupiah(amount);
}
