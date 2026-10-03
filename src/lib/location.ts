import { Platform } from 'react-native';
import * as Location from 'expo-location';

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
        error: 'Izin lokasi belum diberikan. Lokasi dipakai untuk mencatat bahwa Anda sudah di lokasi jemput.',
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
export function formatFix(fix: GpsFix): string {
  return `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`;
}
