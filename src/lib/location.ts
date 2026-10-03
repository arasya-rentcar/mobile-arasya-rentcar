import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

import { getOnline } from './network';
import type { GpsFix } from './types';

export type FixResult =
  | { fix: GpsFix }
  | {
      error: string;
      /** Permission was refused for good: only the phone settings can turn it back on. */
      needsSettings?: boolean;
      /** The phone tried but found no position (GPS weak, indoors). */
      noFix?: boolean;
    };

/** How long to wait for a fresh fix before falling back to the last known one. */
const FIX_TIMEOUT_MS = 25_000;
/** A last known fix older than this, or less precise, is not used. */
const LAST_KNOWN_MAX_AGE_MS = 3 * 60_000;
const LAST_KNOWN_MIN_ACCURACY_M = 200;

function toFix(pos: Location.LocationObject): GpsFix {
  return {
    latitude: Number(pos.coords.latitude.toFixed(6)),
    longitude: Number(pos.coords.longitude.toFixed(6)),
    accuracy: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
    at: new Date(pos.timestamp || Date.now()).toISOString(),
    ...(pos.mocked != null ? { mocked: pos.mocked } : {}),
  };
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type Problem = Extract<FixResult, { error: string }>;

/** Permission granted and location switched on (Android shows its own prompt), or why not. */
async function ensureLocation(): Promise<Problem | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return {
        error: 'Izin lokasi belum diberikan. Lokasi dipakai untuk mencatat di mana foto diambil (lokasi jemput, checkpoint).',
        needsSettings: !perm.canAskAgain,
      };
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      if (Platform.OS === 'android') {
        try {
          await Location.enableNetworkProviderAsync();
        } catch {}
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        return { error: 'Lokasi (GPS) di HP mati. Nyalakan Lokasi dari panel atas layar, lalu coba lagi.' };
      }
    }
    return null;
  } catch {
    return { error: 'Lokasi tidak bisa dibaca di HP ini.', noFix: true };
  }
}

/**
 * Live position for the camera overlay: a recent last-known fix right away, then every update
 * from the GPS. `onProblem` is called when permission is missing, location is off, or no fix
 * came within FIX_TIMEOUT_MS. Returns a function that stops watching.
 */
export function watchFix(onFix: (fix: GpsFix) => void, onProblem: (p: Problem) => void): () => void {
  let stopped = false;
  let sub: Location.LocationSubscription | null = null;
  let got = false;
  const timer = setTimeout(() => {
    if (!got && !stopped) {
      onProblem({ error: 'GPS belum dapat lokasi. Coba di tempat terbuka, atau tunggu sebentar.', noFix: true });
    }
  }, FIX_TIMEOUT_MS);
  const deliver = (pos: Location.LocationObject) => {
    if (stopped) return;
    got = true;
    onFix(toFix(pos));
  };
  void (async () => {
    const problem = await ensureLocation();
    if (stopped) return;
    if (problem) {
      clearTimeout(timer);
      onProblem(problem);
      return;
    }
    // A recent last-known fix shows right away; one fresh fix follows (this also covers the web
    // build, where expo-location's watch never calls back); then live updates from the watch.
    Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS, requiredAccuracy: LAST_KNOWN_MIN_ACCURACY_M })
      .then((last) => last && !got && deliver(last))
      .catch(() => {});
    timeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), FIX_TIMEOUT_MS)
      .then(deliver)
      .catch(() => {});
    try {
      const s = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 },
        deliver,
      );
      if (stopped) s.remove();
      else sub = s;
    } catch {
      if (!stopped) onProblem({ error: 'Lokasi tidak bisa dibaca di HP ini.', noFix: true });
    }
  })();
  return () => {
    stopped = true;
    clearTimeout(timer);
    sub?.remove();
  };
}

/**
 * The phone's current position for the arrival photo: asks for permission, makes sure location
 * is switched on (Android shows its own "turn on location" prompt), then waits for a fresh
 * high-accuracy fix. A recent last-known fix is used when no fresh one comes in time.
 */
export async function getFix(): Promise<FixResult> {
  const problem = await ensureLocation();
  if (problem) return problem;
  try {
    const pos = await timeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), FIX_TIMEOUT_MS);
    return { fix: toFix(pos) };
  } catch {
    try {
      const last = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_MIN_ACCURACY_M,
      });
      if (last) return { fix: toFix(last) };
    } catch {}
    return {
      error: 'Lokasi belum didapat. Pastikan GPS menyala, coba di tempat terbuka, lalu ketuk "Cari lagi".',
      noFix: true,
    };
  }
}

/** "−6.595120, 106.799120" */
export function formatFix(fix: Pick<GpsFix, 'latitude' | 'longitude'>): string {
  return `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`;
}

// ---- Place name (reverse geocoding) ----

/** The phone's geocoder gets this long; after that the photo goes out with coordinates only. */
const NAME_TIMEOUT_MS = 3000;
/** A name found for a point this close is reused instead of asking the geocoder again. */
const NAME_REUSE_M = 30;
/** "No address here" answers are trusted this long (failures and timeouts are not remembered). */
const EMPTY_TTL_MS = 5 * 60_000;
const NAME_CACHE_MAX = 100;
/** Contract limit for `location_name`; the stamp needs far less. */
const NAME_MAX_LEN = 120;

type Point = Pick<GpsFix, 'latitude' | 'longitude'>;
type CachedName = { name: string | null; at: number; lat: number; lng: number };

const nameCache = new Map<string, CachedName>();
const nameInflight = new Map<string, Promise<string | null>>();

/** ~11 m grid. */
const nameKey = (p: Point) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

/** Metres between two nearby points (equirectangular; plenty for tens of metres). */
export function distanceM(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const x = (b.longitude - a.longitude) * rad * Math.cos(((a.latitude + b.latitude) / 2) * rad);
  const y = (b.latitude - a.latitude) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function cachedName(p: Point): CachedName | undefined {
  const exact = nameCache.get(nameKey(p));
  if (exact && (exact.name || Date.now() - exact.at < EMPTY_TTL_MS)) return exact;
  for (const c of nameCache.values()) {
    if (c.name && distanceM(p, { latitude: c.lat, longitude: c.lng }) <= NAME_REUSE_M) return c;
  }
  return undefined;
}

function rememberName(p: Point, name: string | null) {
  const key = nameKey(p);
  nameCache.delete(key);
  nameCache.set(key, { name, at: Date.now(), lat: p.latitude, lng: p.longitude });
  if (nameCache.size > NAME_CACHE_MAX) nameCache.delete(nameCache.keys().next().value!);
}

type DevGeocoder = (p: Point) => Promise<Location.LocationGeocodedAddress[]>;

async function geocode(p: Point): Promise<Location.LocationGeocodedAddress[]> {
  if (Platform.OS === 'web') {
    // Browsers have no geocoder (expo-location returns nothing there). Web previews may plug one
    // in on `window.__arasyaDevGeocoder`; without it there is simply no name. Never set in the app.
    const dev = (globalThis as { __arasyaDevGeocoder?: DevGeocoder }).__arasyaDevGeocoder;
    return typeof dev === 'function' ? dev(p) : [];
  }
  return Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const shorten = (s: string) =>
  s
    .replace(/^jalan\s+/i, 'Jl. ')
    .replace(/^kelurahan\s+/i, 'Kel. ')
    .replace(/^kecamatan\s+/i, 'Kec. ');
/** Google "plus codes" ("PXRW+3G") and bare house numbers are not names. */
const notAName = (s: string) => /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}/i.test(s) || /^[\d\s./-]+$/.test(s);

/**
 * Short, readable place: street, kelurahan/kecamatan, city ("Jl. Pajajaran, Baranangsiang, Kota
 * Bogor"). Parts the geocoder repeats are left out. Null when nothing useful came back.
 */
export function shortAddress(a: Location.LocationGeocodedAddress): string | null {
  const street = clean(a.street);
  const name = clean(a.name);
  const first = street && !notAName(street) ? street : name && !notAName(name) ? name : '';
  const parts: string[] = [];
  for (const raw of [first, clean(a.district), clean(a.city) || clean(a.subregion)]) {
    const part = shorten(raw);
    if (!part) continue;
    const low = part.toLowerCase();
    if (parts.some((q) => q.toLowerCase().includes(low) || low.includes(q.toLowerCase()))) continue;
    parts.push(part);
  }
  let text = parts.join(', ');
  if (!text) {
    // Only a one-line address (Android): keep its first three pieces (no postcode, no country).
    text = clean(a.formattedAddress).split(',').map(clean).filter(Boolean).slice(0, 3).join(', ');
  }
  if (!text) return null;
  return text.length > NAME_MAX_LEN ? `${text.slice(0, NAME_MAX_LEN - 1).trimEnd()}…` : text;
}

/**
 * The place name for a GPS point, from the phone's reverse geocoder: cached by rounded
 * coordinates (and reused within NAME_REUSE_M), at most NAME_TIMEOUT_MS, null when offline, on
 * any failure, or when the geocoder knows nothing there. Coordinates always stay the fallback.
 */
export function placeName(p: Point): Promise<string | null> {
  const hit = cachedName(p);
  if (hit) return Promise.resolve(hit.name);
  if (!getOnline()) return Promise.resolve(null);
  const key = nameKey(p);
  const running = nameInflight.get(key);
  if (running) return running;
  const job = timeout(geocode(p), NAME_TIMEOUT_MS)
    .then((list) => {
      const name = (Array.isArray(list) ? list : []).map(shortAddress).find((n): n is string => !!n) ?? null;
      rememberName(p, name);
      return name;
    })
    .catch(() => null)
    .finally(() => nameInflight.delete(key));
  nameInflight.set(key, job);
  return job;
}

/** How far the driver may move before an old name is no longer shown for the new position. */
const NAME_KEEP_M = 100;
/** After a lookup gave no name, the same spot is not asked again for this long. */
const NAME_RETRY_MS = 15_000;

/**
 * Live place name for a moving fix (the camera stamp). One lookup at a time; when the driver
 * moved on during a lookup, the newest point is looked up next. A name stays while the position
 * is close to where it was found, and is dropped when the driver moved away and no new name came.
 */
export function usePlaceName(fix: Point | null): string | null {
  const [found, setFound] = useState<{ name: string; at: Point } | null>(null);
  const busy = useRef(false);
  const latest = useRef<Point | null>(null);
  const missed = useRef<{ at: Point; time: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const lat = fix?.latitude;
  const lng = fix?.longitude;
  useEffect(() => {
    if (lat == null || lng == null) {
      latest.current = null;
      setFound(null);
      return;
    }
    latest.current = { latitude: lat, longitude: lng };
    const lookUp = (at: Point) => {
      const m = missed.current;
      if (m && Date.now() - m.time < NAME_RETRY_MS && distanceM(m.at, at) <= NAME_REUSE_M) return;
      busy.current = true;
      void placeName(at).then((name) => {
        busy.current = false;
        if (!mounted.current) return;
        missed.current = name ? null : { at, time: Date.now() };
        if (name) setFound({ name, at });
        else setFound((old) => (old && distanceM(old.at, at) <= NAME_KEEP_M ? old : null));
        const now = latest.current;
        if (now && distanceM(now, at) > NAME_REUSE_M) lookUp(now);
      });
    };
    if (!busy.current) lookUp(latest.current);
  }, [lat, lng]);

  if (!found || lat == null || lng == null) return null;
  return distanceM(found.at, { latitude: lat, longitude: lng }) <= NAME_KEEP_M ? found.name : null;
}
