import { API_URL } from './config';
import type { DriverProfile, Report, Trip, TripDetail, User } from './types';

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server (no signal, timeout). */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  get isNetwork() {
    return this.status === 0;
  }
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
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi internet. Coba lagi sebentar.');
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

export const api = {
  login: (identifier: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { identifier, password },
      skipAuthHandling: true,
    }),
  me: () => request<DriverProfile>('/driver/me'),
  trips: (scope: 'active' | 'history') => request<Trip[]>(`/driver/trips?scope=${scope}`),
  trip: (id: string) => request<TripDetail>(`/driver/trips/${encodeURIComponent(id)}`),
  tripAction: (id: string, action: 'accept' | 'start' | 'arrive' | 'finish', body?: { notes?: string; occurred_at?: string; client_ref?: string }) =>
    request<Trip>(`/driver/trips/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: body ?? {} }),
  uploadReport: (id: string, form: FormData) =>
    request<Report>(`/driver/trips/${encodeURIComponent(id)}/reports`, {
      method: 'POST',
      form,
      timeoutMs: 90000,
    }),
  registerDevice: (token: string, platform: 'android' | 'ios') =>
    request<void>('/devices', { method: 'POST', body: { token, platform } }),
  unregisterDevice: (token: string) => request<void>('/devices', { method: 'DELETE', body: { token } }),
};
