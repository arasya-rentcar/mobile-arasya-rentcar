import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@/lib/config';
import { formatFix, watchFix } from '@/lib/location';
import { shrinkUri } from '@/lib/photos';
import type { GpsFix } from '@/lib/types';
import { Button } from './ui';

/** Long side of the saved photo (same as the other report photos). */
const OUT_LONG_SIDE = 1600;

export type StampInfo = {
  /** First line, e.g. "SAMPAI DI LOKASI JEMPUT". */
  title: string;
  orderCode: string | null;
  driverName: string;
  place: string;
};

export type StampedPhoto = {
  uri: string;
  fix: GpsFix;
  /** The stamp is burned into the picture on the phone (else the server adds it). */
  stamped: boolean;
};

export type GpsProblem = { error: string; needsSettings?: boolean; noFix?: boolean };

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Wall clock in WIB (UTC+7), whatever the phone's time zone. */
function wibParts(d: Date) {
  const w = new Date(d.getTime() + 7 * 3600_000);
  return {
    time: `${pad(w.getUTCHours())}.${pad(w.getUTCMinutes())}`,
    date: `${DAYS[w.getUTCDay()]}, ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}`,
  };
}

/**
 * The stamp drawn over the photo, like the "time mark" camera apps: big time, date, what and
 * who, GPS and place. Sized from the width of the picture it sits on, so the live preview and
 * the saved photo look the same.
 */
export function StampOverlay({ info, fix, at, width }: { info: StampInfo; fix: GpsFix | null; at: Date; width: number }) {
  const u = width / 100; // 1% of the picture width
  const { time, date } = wibParts(at);
  const gps = fix
    ? `GPS ${formatFix(fix)}${fix.accuracy != null ? ` (±${fix.accuracy} m)` : ''}`
    : 'GPS: mencari lokasi…';
  return (
    <View style={[styles.stamp, { padding: u * 3, gap: u * 0.8 }]} pointerEvents="none">
      <View style={[styles.timeRow, { gap: u * 2.5 }]}>
        <Text style={[styles.time, { fontSize: u * 11, lineHeight: u * 12 }]}>{time}</Text>
        <View style={[styles.bar, { width: u * 0.8, height: u * 9 }]} />
        <View>
          <Text style={[styles.date, { fontSize: u * 3.8 }]}>{date}</Text>
          <Text style={[styles.date, { fontSize: u * 3.8 }]}>WIB</Text>
        </View>
      </View>
      <Text style={[styles.line, styles.lineStrong, { fontSize: u * 3.6 }]} numberOfLines={1}>
        {`${info.title}${info.orderCode ? ` · ${info.orderCode}` : ''}`}
      </Text>
      <Text style={[styles.line, { fontSize: u * 3.6 }]} numberOfLines={1}>{`Driver: ${info.driverName}`}</Text>
      <Text style={[styles.line, { fontSize: u * 3.6 }, !fix && { color: '#ffd27a' }]} numberOfLines={1}>
        {gps}
      </Text>
      <Text style={[styles.line, { fontSize: u * 3.4 }]} numberOfLines={2}>{`Jemput: ${info.place}`}</Text>
      <Text style={[styles.brand, { fontSize: u * 3 }]}>Arasya Rent Car</Text>
    </View>
  );
}

type Shot = { uri: string; width: number; height: number; fix: GpsFix; at: Date };

/**
 * Full-screen camera with a live stamp (time, driver, GPS, place). The shutter waits for a GPS
 * fix. After the shot the photo is drawn with the same stamp and saved as one JPEG on the phone,
 * so the stamp is part of the picture even before it is uploaded. If that fails the plain photo
 * is returned (resized) and the server burns the stamp in instead.
 */
export function StampCamera({
  visible,
  info,
  onClose,
  onCaptured,
  onGpsProblem,
}: {
  visible: boolean;
  info: StampInfo;
  onClose: () => void;
  onCaptured: (photo: StampedPhoto) => void;
  /** GPS could not be used (reported to the screen so it can offer a way out). */
  onGpsProblem?: (p: GpsProblem) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const compose = useRef<View>(null);
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsProblem, setGpsProblem] = useState<GpsProblem | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live clock + GPS while the camera is open. The callback is read through a ref so a new
  // function from the parent does not restart the GPS watch.
  const problemCb = useRef(onGpsProblem);
  useEffect(() => {
    problemCb.current = onGpsProblem;
  });
  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    setGpsProblem(null);
    const stop = watchFix(
      (f) => {
        setFix(f);
        setGpsProblem(null);
      },
      (p) => {
        setGpsProblem(p);
        problemCb.current?.(p);
      },
    );
    return () => {
      clearInterval(tick);
      stop();
    };
  }, [visible]);

  useEffect(() => {
    if (visible && perm && !perm.granted && perm.canAskAgain) void requestPerm();
  }, [visible, perm, requestPerm]);

  useEffect(() => {
    if (!visible) {
      setShot(null);
      setReady(false);
      setError(null);
    }
  }, [visible]);

  const take = async () => {
    if (!cam.current || !fix || shot) return;
    setError(null);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.85 });
      if (!pic?.uri) throw new Error('no picture');
      setShot({ uri: pic.uri, width: pic.width || 3, height: pic.height || 4, fix, at: new Date() });
    } catch {
      setError('Kamera gagal mengambil foto. Coba lagi.');
    }
  };

  // Output size: the photo's aspect, long side OUT_LONG_SIDE px. The view is laid out at that
  // size in dp/PixelRatio so the capture needs no upscaling.
  const portrait = shot ? shot.height >= shot.width : true;
  const outW = shot ? Math.round(portrait ? (OUT_LONG_SIDE * shot.width) / shot.height : OUT_LONG_SIDE) : 0;
  const outH = shot ? Math.round(portrait ? OUT_LONG_SIDE : (OUT_LONG_SIDE * shot.height) / shot.width) : 0;
  const ratio = PixelRatio.get() || 1;
  const viewW = outW / ratio;
  const viewH = outH / ratio;

  const composeLoaded = async () => {
    if (!shot) return;
    // Let the stamp render on top of the image before taking the snapshot.
    await new Promise((r) => setTimeout(r, 120));
    let uri: string | null = null;
    try {
      uri = await captureRef(compose, { format: 'jpg', quality: 0.82, result: 'tmpfile', width: outW, height: outH });
    } catch {}
    if (uri) {
      onCaptured({ uri, fix: shot.fix, stamped: true });
      return;
    }
    try {
      onCaptured({ uri: await shrinkUri(shot.uri, shot.width, shot.height), fix: shot.fix, stamped: false });
    } catch {
      setShot(null);
      setError('Foto tidak bisa diproses. Coba ambil ulang.');
    }
  };

  const granted = !!perm?.granted;
  const mocked = !!fix?.mocked;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        {shot ? (
          // Drawn at the output size, captured, then handed back. Hidden behind the cover below.
          <View ref={compose} collapsable={false} style={{ position: 'absolute', top: 0, left: 0, width: viewW, height: viewH }}>
            <Image source={{ uri: shot.uri }} style={{ width: viewW, height: viewH }} onLoadEnd={composeLoaded} resizeMode="cover" />
            <StampOverlay info={info} fix={shot.fix} at={shot.at} width={viewW} />
          </View>
        ) : null}

        {granted ? (
          <View style={StyleSheet.absoluteFill}>
            <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
            <View style={styles.liveStampWrap}>
              <StampOverlay info={info} fix={fix} at={now} width={screenW} />
            </View>
          </View>
        ) : (
          <View style={[styles.center, { padding: 24, gap: 14 }]}>
            <Ionicons name="camera-outline" size={56} color={colors.white} />
            <Text style={styles.permText}>Izinkan kamera untuk mengambil foto di lokasi jemput.</Text>
            {perm && !perm.canAskAgain ? (
              <Button title="Buka Pengaturan" icon="settings-outline" onPress={() => Linking.openSettings().catch(() => {})} />
            ) : (
              <Button title="Izinkan kamera" icon="camera" onPress={() => void requestPerm()} />
            )}
          </View>
        )}

        {/* Top bar: close + GPS state */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Tutup kamera">
            <Ionicons name="close" size={30} color={colors.white} />
          </Pressable>
          <View style={[styles.gpsChip, { backgroundColor: mocked ? colors.danger : fix ? colors.success : '#b45309' }]}>
            <Ionicons name={fix ? 'location' : 'location-outline'} size={18} color={colors.white} />
            <Text style={styles.gpsChipText}>
              {mocked ? 'Lokasi palsu terdeteksi' : fix ? `GPS siap${fix.accuracy != null ? ` ±${fix.accuracy} m` : ''}` : 'Mencari GPS…'}
            </Text>
          </View>
        </View>

        {gpsProblem && !fix ? (
          <View style={[styles.problem, { top: insets.top + 64 }]}>
            <Text style={styles.problemText}>{gpsProblem.error}</Text>
            {gpsProblem.needsSettings ? (
              <Button title="Buka Pengaturan" icon="settings-outline" variant="secondary" onPress={() => Linking.openSettings().catch(() => {})} />
            ) : null}
          </View>
        ) : null}
        {error ? (
          <View style={[styles.problem, { top: insets.top + 64 }]}>
            <Text style={styles.problemText}>{error}</Text>
          </View>
        ) : null}

        {/* Shutter */}
        {granted ? (
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              testID="stamp-shutter"
              onPress={take}
              disabled={!fix || !ready || !!shot}
              accessibilityRole="button"
              accessibilityLabel={fix ? 'Ambil foto' : 'Menunggu GPS'}
              style={({ pressed }) => [styles.shutter, (!fix || !ready) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.94 }] }]}>
              <View style={styles.shutterInner} />
            </Pressable>
            <Text style={styles.shutterHint}>{fix ? 'Ketuk untuk foto' : 'Tunggu GPS siap…'}</Text>
          </View>
        ) : null}

        {shot ? (
          <View style={[StyleSheet.absoluteFill, styles.center, styles.cover]}>
            <ActivityIndicator color={colors.white} size="large" />
            <Text style={styles.permText}>Memberi cap waktu & lokasi…</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cover: { backgroundColor: '#000', gap: 12 },
  permText: { color: colors.white, fontSize: 17, textAlign: 'center', fontWeight: '700' },
  liveStampWrap: { position: 'absolute', left: 0, right: 0, bottom: 150 },
  stamp: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  time: { color: colors.white, fontWeight: '900' },
  bar: { backgroundColor: '#f6c343', borderRadius: 2 },
  date: { color: colors.white, fontWeight: '800' },
  line: { color: colors.white, fontWeight: '600' },
  lineStrong: { color: '#f6c343', fontWeight: '900' },
  brand: { color: 'rgba(255,255,255,0.75)', fontWeight: '800', alignSelf: 'flex-end' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  close: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  gpsChipText: { color: colors.white, fontWeight: '800', fontSize: 15 },
  problem: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  problemText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 6, paddingTop: 12 },
  shutter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.white },
  shutterHint: { color: colors.white, fontWeight: '800', fontSize: 15 },
});
