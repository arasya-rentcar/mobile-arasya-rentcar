import { formatKm, formatRupiah } from './format';
import type { QueueItem, TripAction } from './queue';
import type { ReportType, Trip, TripDetail } from './types';

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
  // Older servers do not send customer_onboard_at (undefined): no "Mulai perjalanan" step.
  if (t.customer_onboard_at === null) return 'board';
  return 'finish';
}

export const ACTION_LABEL: Record<TripAction, string> = {
  accept: 'Terima tugas',
  start: 'Berangkat dari garasi',
  arrive: 'Sampai di lokasi jemput',
  board: 'Mulai perjalanan',
  finish: 'Selesai',
};

export const ACTION_DONE_TEXT: Record<TripAction, string> = {
  accept: 'Tugas diterima',
  start: 'Tercatat: berangkat dari garasi',
  arrive: 'Tercatat: sampai di lokasi jemput',
  board: 'Tercatat: perjalanan dimulai',
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
      case 'board':
        t.accepted_at ??= at;
        t.actual_start_at ??= at;
        t.customer_onboard_at ??= at;
        if (t.status !== 'DONE') t.status = 'IN_PROGRESS';
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
  ARRIVAL_PHOTO: 'Foto sampai lokasi',
};

export const COST_TYPES = ['FUEL', 'TOLL', 'PARKING', 'OTHER_COST'];

export const ODOMETER_TYPES = ['ODOMETER_START', 'ODOMETER_END'];

/** `amount` means km for odometer reports and rupiah for cost reports. */
export function formatReportAmount(type: string, amount: number | null | undefined): string | null {
  if (amount == null) return null;
  return ODOMETER_TYPES.includes(type) ? formatKm(amount) : formatRupiah(amount);
}

/** The order is not paid in full and the trip with the customer has not begun yet. */
export function unpaid(t: Trip): boolean {
  return t.payment_ready === false && !t.customer_onboard_at && t.status !== 'DONE' && t.status !== 'CANCELLED';
}

/** True when "Mulai perjalanan" must wait for the full payment (driving there is allowed). */
export function waitingForPayment(t: Trip): boolean {
  return unpaid(t) && nextAction(t) === 'board';
}

/**
 * Where one report of a kind stands: sent to the server, waiting in the queue on this phone,
 * failed (waits for "Coba lagi" / "Hapus"), or not made yet.
 */
export type ReportState = 'sent' | 'pending' | 'failed' | 'none';

export function reportState(trip: TripDetail, queue: QueueItem[], type: ReportType): ReportState {
  if (trip.reports.some((r) => r.report_type === type)) return 'sent';
  const q = queue.find((i) => i.tripId === trip.id && i.kind === 'report' && i.reportType === type);
  if (!q) return 'none';
  return q.failed ? 'failed' : 'pending';
}

/** The odometer start reading in km (sent or still queued), if known. */
export function odometerStartKm(trip: TripDetail, queue: QueueItem[]): number | null {
  const sent = trip.reports.find((r) => r.report_type === 'ODOMETER_START');
  if (sent) return sent.amount ?? null;
  const q = queue.find((i) => i.tripId === trip.id && i.kind === 'report' && i.reportType === 'ODOMETER_START');
  return q?.amount ?? null;
}

/**
 * Odometer photos go in order: one start, then one end. The start counts once it is sent or
 * waiting to be sent (the queue keeps each trip's items in order); a failed start must be
 * resent or deleted first.
 */
export function odometerButtons(trip: TripDetail, queue: QueueItem[]) {
  const start = reportState(trip, queue, 'ODOMETER_START');
  const end = reportState(trip, queue, 'ODOMETER_END');
  return {
    start,
    end,
    canStart: start === 'none',
    canEnd: (start === 'sent' || start === 'pending') && end === 'none',
  };
}

export const EXPENSE_STATUS: Record<string, { label: string; tone: 'pending' | 'running' | 'cancelled' }> = {
  PENDING: { label: 'Menunggu dicek', tone: 'pending' },
  APPROVED: { label: 'Disetujui', tone: 'running' },
  REJECTED: { label: 'Ditolak', tone: 'cancelled' },
};
