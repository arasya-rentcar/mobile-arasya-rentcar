import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { StampCamera, type GpsProblem, type StampedPhoto } from '@/components/StampCamera';
import { Banner, Button, Card } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatFix } from '@/lib/location';
import { useOnline } from '@/lib/network';
import { showNotice } from '@/lib/notices';
import { keepPhoto } from '@/lib/photos';
import { enqueue, newId } from '@/lib/queue';
import { useSession } from '@/lib/session';
import { ACTION_DONE_TEXT, nextAction } from '@/lib/tripState';
import { doTripAction, useMe, useTrip } from '@/lib/trips';
import type { GpsFix } from '@/lib/types';

export default function ArriveScreen() {
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (session.status !== 'signedIn' || !id) return null;
  return <ArriveView tripId={String(id)} />;
}

/**
 * "Sampai di lokasi jemput": the driver takes a photo at the pickup point with the GPS camera
 * (live stamp of time, name, GPS and place, like the "time mark" camera apps). The stamped photo
 * and the GPS fix go out with the arrive step so the office can check the driver was really there.
 */
function ArriveView({ tripId }: { tripId: string }) {
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const me = useMe();
  const { trip } = useTrip(tripId);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photo, setPhoto] = useState<StampedPhoto | null>(null);
  const [gpsProblem, setGpsProblem] = useState<GpsProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef(false);

  // Straight into the camera, like a time-mark app.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    setCameraOpen(true);
  }, []);

  const alreadyArrived = trip ? nextAction(trip) !== 'arrive' : false;
  const onGpsProblem = useCallback((p: GpsProblem) => setGpsProblem(p), []);

  const finish = (location: GpsFix | null) => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/trip/[id]', params: { id: tripId } });
    const note = online ? '' : ' (dikirim saat ada sinyal)';
    showNotice(`${ACTION_DONE_TEXT.arrive}${location ? '' : ' tanpa foto lokasi'}${note}`, 'success');
  };

  const submit = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      const id = newId();
      const photoUri = await keepPhoto(photo.uri, id);
      // The step first (small, goes out fast), then the photo; both carry the same fix.
      doTripAction(tripId, 'arrive', undefined, photo.fix);
      enqueue({
        id,
        tripId,
        kind: 'report',
        reportType: 'ARRIVAL_PHOTO',
        photoUri,
        location: photo.fix,
        stamped: photo.stamped,
      });
      finish(photo.fix);
    } finally {
      setBusy(false);
    }
  };

  // Last resort when the phone cannot get any position: the step is still recorded (the office
  // sees it has no photo/GPS and can call the driver).
  const submitWithoutLocation = () => {
    doTripAction(tripId, 'arrive');
    finish(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Sampai di lokasi jemput' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {alreadyArrived ? (
          <Banner tone="success" icon="checkmark-circle">
            Sampai di lokasi jemput sudah tercatat untuk tugas ini.
          </Banner>
        ) : null}

        <Card style={{ gap: 12 }}>
          <Text style={styles.title}>Foto di lokasi jemput</Text>
          {photo ? (
            <>
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="Foto lokasi dengan cap waktu dan GPS" />
              <View style={styles.fixRow}>
                <Ionicons name="location" size={20} color={photo.fix.mocked ? colors.danger : colors.success} />
                <Text style={styles.fixText}>
                  {`${formatFix(photo.fix)}${photo.fix.accuracy != null ? ` · akurasi ${photo.fix.accuracy} m` : ''}`}
                </Text>
              </View>
              {photo.fix.mocked ? (
                <Banner tone="error" icon="warning">
                  HP memakai lokasi palsu (aplikasi mock location). Foto ini akan ditandai untuk dicek admin.
                </Banner>
              ) : null}
              <Button title="Foto ulang" icon="camera-reverse-outline" variant="outline" onPress={() => setCameraOpen(true)} />
            </>
          ) : (
            <Pressable
              testID="arrive-photo"
              onPress={() => setCameraOpen(true)}
              style={({ pressed }) => [styles.photoBox, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel="Buka kamera GPS">
              <Ionicons name="camera" size={48} color={colors.primary} />
              <Text style={styles.photoBoxText}>Buka kamera GPS</Text>
              <Text style={styles.photoBoxHint}>
                Foto mobil di lokasi jemput dengan patokan (gedung, gerbang, papan nama). Waktu, nama Anda, dan titik GPS
                langsung tercetak di foto.
              </Text>
            </Pressable>
          )}
        </Card>

        {gpsProblem && !photo ? (
          <Banner tone="warning" icon="location-outline">
            {gpsProblem.error}
          </Banner>
        ) : null}
        {!online ? (
          <Banner tone="warning" icon="cloud-offline">
            Tidak ada sinyal. Foto dan lokasi disimpan dan dikirim otomatis nanti.
          </Banner>
        ) : null}

        <Button
          testID="submit-arrive"
          title="Kirim & tandai sampai"
          icon="location"
          big
          onPress={submit}
          loading={busy}
          disabled={!photo || alreadyArrived}
        />
        {gpsProblem?.noFix && !photo && !alreadyArrived ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>
              GPS tetap tidak dapat lokasi? Tandai sampai tanpa foto lokasi. Admin akan melihat bahwa lokasinya kosong.
            </Text>
            <Button title="Tandai sampai tanpa lokasi" variant="ghost" onPress={submitWithoutLocation} />
          </View>
        ) : null}
        <Button title="Batal" variant="ghost" onPress={() => router.back()} />
      </ScrollView>

      <StampCamera
        visible={cameraOpen}
        info={{
          title: 'SAMPAI DI LOKASI JEMPUT',
          orderCode: trip?.order_code ?? null,
          driverName: me.data?.name ?? 'Driver',
          place: trip?.pickup_location ?? '-',
        }}
        onClose={() => setCameraOpen(false)}
        onGpsProblem={onGpsProblem}
        onCaptured={(p) => {
          setPhoto(p);
          setGpsProblem(null);
          setCameraOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: font.large, fontWeight: '900', color: colors.navy },
  muted: { fontSize: font.small, color: colors.textMuted },
  fixRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixText: { fontSize: font.small, color: colors.text, fontWeight: '700', flexShrink: 1 },
  photoBox: {
    minHeight: 200,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  photoBoxText: { fontSize: font.title, fontWeight: '900', color: colors.primary },
  photoBoxHint: { fontSize: font.small, color: colors.textMuted, textAlign: 'center' },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, backgroundColor: '#000' },
});
