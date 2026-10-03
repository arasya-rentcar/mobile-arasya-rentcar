import { API_URL } from './config';
import type { DriverProfile, NotificationPage, Report, Trip, TripDetail, User } from './types';

/** `ApiError.status` when the request failed on the phone itself (e.g. the photo could not be read). */
export const CLIENT_ERROR = -1;

export class ApiError extends Error {
  /**
   * HTTP status; 0 when the request never reached the server (no signal, timeout);
   * CLIENT_ERROR (-1) when it could not be built or sent for a reason on the phone.
   */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/**
 * True for errors that mean "no connection": `expo/fetch` wraps every native transport failure
 * (offline, DNS, reset, abort) in a FetchError whose message starts with "fetch failed:"; React
 * Native's and the browser's fetch throw a TypeError ("Network request failed" / "Failed to
 * fetch") or an AbortError. Anything else (for example the multipart encoder refusing a part)
 * happened on the phone and must not be mistaken for missing signal.
 */
function isConnectionError(e: unknown) {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return true;
  if (/^fetch failed:/i.test(e.message)) return true;
  return e instanceof TypeError && /network request failed|failed to fetch|load failed|networkerror/i.test(e.message);
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function hasAuthToken() {
  return !!authToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  /** Do not trigger the global logout on 401 (used by the login call itself). */
  skipAuthHandling?: boolean;
};

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form as unknown as BodyInit;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if (timedOut) throw new ApiError(0, 'Server tidak menjawab (waktu habis). Sinyal mungkin lemah.');
    if (isConnectionError(e)) throw new ApiError(0, 'Tidak ada koneksi internet. Coba lagi sebentar.');
    const detail = e instanceof Error ? e.message : String(e);
    throw new ApiError(CLIENT_ERROR, `Gagal menyiapkan kiriman di HP: ${detail.slice(0, 160)}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok || json?.status === 'error') {
    if (res.status === 401 && !opts.skipAuthHandling) onUnauthorized?.();
    const message =
      (typeof json?.message === 'string' && json.message) ||
      (res.status >= 500 ? 'Server sedang bermasalah. Coba lagi nanti.' : `Permintaan gagal (${res.status}).`);
    throw new ApiError(res.status || 500, message);
  }
  return (json?.data ?? json) as T;
}

/** Phone numbers are typed with spaces, dashes, dots or brackets; emails are sent as typed. */
export function normalizeIdentifier(raw: string) {
  const id = raw.trim();
  return id.includes('@') ? id : id.replace(/[\s\-.()]/g, '');
}

export const api = {
  login: (identifier: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { identifier: normalizeIdentifier(identifier), password },
      skipAuthHandling: true,
    }),
  me: () => request<DriverProfile>('/driver/me'),
  trips: (scope: 'active' | 'history') => request<Trip[]>(`/driver/trips?scope=${scope}`),
  trip: (id: string) => request<TripDetail>(`/driver/trips/${encodeURIComponent(id)}`),
  tripAction: (id: string, action: 'accept' | 'start' | 'arrive' | 'board' | 'finish', body?: Record<string, string | number | boolean>) =>
    request<Trip>(`/driver/trips/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: body ?? {} }),
  uploadReport: (id: string, form: FormData) =>
    request<Report>(`/driver/trips/${encodeURIComponent(id)}/reports`, {
      method: 'POST',
      form,
      timeoutMs: 90000,
    }),
  notifications: (before?: string) =>
    request<NotificationPage>(`/driver/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  readNotifications: (input: { ids?: string[]; all?: boolean }) =>
    request<{ updated: number; unread: number }>('/driver/notifications/read', { method: 'POST', body: input }),
  registerDevice: (token: string, platform: 'android' | 'ios') =>
    request<void>('/devices', { method: 'POST', body: { token, platform } }),
  unregisterDevice: (token: string, opts?: { skipAuthHandling?: boolean }) =>
    request<void>('/devices', { method: 'DELETE', body: { token }, skipAuthHandling: opts?.skipAuthHandling }),
};
