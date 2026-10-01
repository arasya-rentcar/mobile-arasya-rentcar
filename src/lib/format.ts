import type { Trip } from './types';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_LONG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** A Date whose UTC fields hold the wall-clock time in Asia/Jakarta (UTC+7, no DST). */
function wib(iso: string): Date | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + WIB_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" in WIB. Accepts a plain date ("2026-10-02") or an ISO timestamp. */
export function wibDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = wib(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function todayKey(offsetDays = 0): string {
  return new Date(Date.now() + WIB_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** "08.30" (WIB wall clock). */
export function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = wib(iso);
  return d ? `${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}` : null;
}

function keyToDate(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Kamis, 2 Okt 2026" */
export function formatDateKey(key: string, long = false): string {
  const d = keyToDate(key);
  const month = long ? MONTHS_LONG[d.getUTCMonth()] : MONTHS[d.getUTCMonth()];
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** "Sen 5 Okt" */
export function formatShortDate(key: string): string {
  const d = keyToDate(key);
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Section label: "Hari ini", "Besok", "Kemarin" or a date. */
export function dayLabel(key: string | null): string {
  if (!key) return 'Tanpa tanggal';
  if (key === todayKey()) return 'Hari ini';
  if (key === todayKey(1)) return 'Besok';
  if (key === todayKey(-1)) return 'Kemarin';
  return formatDateKey(key);
}

/** "Kamis, 2 Okt 2026 · 14.05" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const key = wibDateKey(iso);
  const time = formatTime(iso);
  return key ? `${formatDateKey(key)} · ${time} WIB` : '-';
}

export function tripDateKey(trip: Trip): string | null {
  return wibDateKey(trip.start_at) ?? wibDateKey(trip.service_date);
}

/** Time range text for a trip, e.g. "08.00 – 20.00 WIB" or "08.00 WIB s/d Sab, 4 Okt". */
export function tripTimeText(trip: Trip): string {
  const start = formatTime(trip.start_at);
  const end = formatTime(trip.end_at);
  const startKey = tripDateKey(trip);
  const endKey = wibDateKey(trip.end_at);
  if (!start) return 'Jam belum ditentukan';
  if (end && endKey && startKey && endKey !== startKey) {
    return `${start} WIB s/d ${formatShortDate(endKey)}, ${end}`;
  }
  return end ? `${start} – ${end} WIB` : `${start} WIB`;
}

/** Number of calendar days a trip spans (WIB), at least 1. */
export function tripDays(trip: Trip): number {
  const a = tripDateKey(trip);
  const b = wibDateKey(trip.end_at);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / 86400000) + 1);
}

/** 45210 → "45.210" */
export function formatThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatRupiah(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '-';
  return `Rp ${formatThousands(amount)}`;
}

/** Odometer reading: "45.210 km" */
export function formatKm(km: number | null | undefined): string {
  if (km == null || Number.isNaN(km)) return '-';
  return `${formatThousands(km)} km`;
}

/** Digits only → integer (rupiah or km), or null when empty. */
export function parseRupiah(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : null;
}

/** Normalise an Indonesian phone number for wa.me: 0812… → 62812… */
export function waNumber(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return d;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
