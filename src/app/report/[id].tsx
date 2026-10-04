import { useCallback, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PlaceLine } from '@/components/PlaceLine';
import { StampCamera, type GpsProblem, type StampedPhoto } from '@/components/StampCamera';
import { Banner, Button } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatKm, formatThousands, parseRupiah } from '@/lib/format';
import { useOnline } from '@/lib/network';
import { showNotice } from '@/lib/notices';
import { keepPhoto, pickFromGallery, takePhoto, type PickResult } from '@/lib/photos';
import { enqueue, newId, useQueue } from '@/lib/queue';
import { COST_TYPES, nextCheckpointNumber, odometerButtons, odometerStartKm, REPORT_LABEL } from '@/lib/tripState';
import { useMe, useTrip } from '@/lib/trips';
import type { ReportType } from '@/lib/types';

const TITLES: Record<string, string> = {
  ODOMETER_START: 'Odometer awal',
  ODOMETER_END: 'Odometer akhir',
  FUEL: 'Bensin',
  TOLL: 'Tol',
  PARKING: 'Parkir',
  OTHER_COST: 'Biaya lain',
  PHOTO: 'Foto / Catatan',
  NOTE: 'Foto / Catatan',
};

// Web only: the browser focus ring clashes with our own borders.
const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

// ARRIVAL_PHOTO has its own screen (arrive/[id]) with the GPS fix.
const VALID: ReportType[] = ['ODOMETER_START', 'ODOMETER_END', 'FUEL', 'TOLL', 'PARKING', 'OTHER_COST', 'PHOTO', 'NOTE'];

export default function ReportFormScreen() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const tripId = String(params.id);
  const initial = VALID.includes(params.type as ReportType) ? (params.type as ReportType) : 'PHOTO';
  const insets = useSafeAreaInsets();
  const online = useOnline();

  // The type is fixed by the button the driver pressed (odometer start and end each have their own).
  const type: ReportType = initial === 'NOTE' ? 'PHOTO' : initial;
  const { trip } = useTrip(tripId);
  const me = useMe();
  const queue = useQueue();
  // Odometer photo (system camera), or a receipt picked from the gallery.
  const [photo, setPhoto] = useState<string | null>(null);
  // Checkpoint and receipt photos from the GPS camera (stamped like the arrival photo).
  const [shot, setShot] = useState<StampedPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [gpsProblem, setGpsProblem] = useState<GpsProblem | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const onGpsProblem = useCallback((p: GpsProblem) => setGpsProblem(p), []);
  const onCameraProblem = useCallback((m: string) => setCameraProblem(m), []);
  const [amountText, setAmountText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOdo = type === 'ODOMETER_START' || type === 'ODOMETER_END';
  const isCost = COST_TYPES.includes(type);
  const isCheckpoint = type === 'PHOTO';
  // Checkpoints only come from the GPS camera; receipts too, with the gallery as a way out.
  const gpsCamera = isCheckpoint || isCost;
  // The checkpoint photo's title is the catatan, so it is written before the photo and locked after.
  const stampTitle = notes.trim().replace(/\s+/g, ' ');
  const needsTitle = isCheckpoint && !stampTitle;
  const titleLocked = isCheckpoint && !!shot;
  // "Checkpoint N": this trip's checkpoint photos sent or waiting to be sent, plus one.
  const checkpointNo = trip ? nextCheckpointNumber(trip, queue) : 1;
  const amount = parseRupiah(amountText);
  // Odometer order: start once, then end once (also checked by the server).
  const odo = trip ? odometerButtons(trip, queue) : null;
  const odoBlocked =
    odo && type === 'ODOMETER_START' && !odo.canStart
      ? 'Foto odometer awal sudah dikirim untuk tugas ini.'
      : odo && type === 'ODOMETER_END' && !odo.canEnd
        ? odo.end !== 'none'
          ? 'Foto odometer akhir sudah dikirim untuk tugas ini.'
          : 'Kirim foto odometer awal dulu, baru odometer akhir.'
        : null;
  const startKm = trip && type === 'ODOMETER_END' ? odometerStartKm(trip, queue) : null;

  const handlePick = (res: PickResult) => {
    if (!res) return;
    if ('error' in res) setError(res.error);
    else {
      setError(null);
      setShot(null);
      setPhoto(res.uri);
    }
  };

  const submit = async () => {
    if (odoBlocked) return setError(odoBlocked);
    if (isOdo && !photo) return setError('Ambil foto odometer dulu, ya.');
    if (isOdo && (amount == null || amount <= 0)) return setError('Isi angka odometer (km) sesuai foto.');
    if (startKm != null && amount != null && amount < startKm)
      return setError(`Angka akhir lebih kecil dari odometer awal (${formatKm(startKm)}). Cek lagi angkanya.`);
    if (isCost && (!amount || amount <= 0)) return setError('Isi jumlah biaya (Rp) dulu.');
    if (type === 'OTHER_COST' && !notes.trim()) return setError('Tulis biaya untuk apa di kolom catatan.');
    if (isCheckpoint && !shot && !notes.trim()) return setError('Ambil foto atau tulis catatan dulu.');
    setError(null);
    setBusy(true);
    try {
      const id = newId();
      const source = shot?.uri ?? photo;
      const photoUri = source ? await keepPhoto(source, id) : null;
      const reportType: ReportType = isCheckpoint && !shot ? 'NOTE' : type;
      enqueue({
        id,
        tripId,
        kind: 'report',
        reportType,
        // Odometer reports send the reading in km as `amount`; cost reports send rupiah.
        amount: isCost || isOdo ? amount : null,
        notes: notes.trim() || undefined,
        photoUri,
        // GPS camera photo: GPS fix (with the place name) and the stamp is already on the picture.
        ...(shot ? { location: shot.fix, stamped: shot.stamped } : {}),
      });
      const label = isCheckpoint && shot ? `Checkpoint ${checkpointNo}` : REPORT_LABEL[reportType];
      showNotice(online ? `${label} sedang dikirim…` : `${label} disimpan. Dikirim otomatis saat ada sinyal.`, 'success');
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]', params: { id: tripId } });
    } finally {
      setBusy(false);
    }
  };

  const notesField = (
    <>
      <Text style={styles.label}>
        {type === 'OTHER_COST' ? 'Biaya untuk apa?' : isCheckpoint ? 'Judul foto / catatan' : 'Catatan (boleh dikosongkan)'}
      </Text>
      <TextInput
        testID="notes-input"
        value={notes}
        onChangeText={setNotes}
        editable={!titleLocked}
        placeholder={
          type === 'FUEL'
            ? 'Contoh: Pertamax 30 liter, SPBU Cibubur'
            : type === 'OTHER_COST'
              ? 'Contoh: cuci mobil, makan driver'
              : isCheckpoint
                ? 'Contoh: Istirahat di rest area KM 57'
                : 'Tulis keterangan singkat'
        }
        placeholderTextColor="#8593a3"
        multiline
        style={[styles.notes, titleLocked && styles.notesLocked]}
      />
      {titleLocked ? <Text style={styles.photoBoxHint}>Judul ini sudah tercetak di foto. Hapus foto dulu untuk menggantinya.</Text> : null}
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: TITLES[type] ?? 'Kirim laporan' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled">
          {odoBlocked ? (
            <Banner tone="warning" icon="lock-closed-outline">
              {odoBlocked}
            </Banner>
          ) : null}
          {startKm != null ? <Text style={styles.hintText}>{`Odometer awal: ${formatKm(startKm)}`}</Text> : null}

          {isCheckpoint ? notesField : null}

          {gpsCamera ? (
            <>
              <Text style={styles.label}>
                {isCheckpoint ? `Foto checkpoint ${checkpointNo} (boleh tidak ada)` : 'Foto struk (disarankan)'}
              </Text>
              {shot ? (
                <View style={{ gap: 10 }}>
                  <Image
                    source={{ uri: shot.uri }}
                    style={styles.stampPreview}
                    resizeMode="contain"
                    accessibilityLabel={isCheckpoint ? `Foto checkpoint ${checkpointNo} dengan cap waktu dan lokasi` : 'Foto struk dengan cap waktu dan lokasi'}
                  />
                  <PlaceLine
                    name={shot.fix.name}
                    latitude={shot.fix.latitude}
                    longitude={shot.fix.longitude}
                    accuracy={shot.fix.accuracy}
                    mocked={shot.fix.mocked}
                  />
                  {shot.fix.mocked ? (
                    <Banner tone="error" icon="warning">
                      HP memakai lokasi palsu (aplikasi mock location). Foto ini akan ditandai untuk dicek admin.
                    </Banner>
                  ) : null}
                  <View style={styles.row}>
                    <Button title="Foto ulang" icon="camera-reverse-outline" variant="outline" style={{ flex: 1 }} onPress={() => setCameraOpen(true)} />
                    <Button title="Hapus" icon="trash-outline" variant="danger" style={{ flex: 1 }} onPress={() => setShot(null)} />
                  </View>
                </View>
              ) : photo ? (
                // Receipt picked from the gallery (no stamp).
                <View style={{ gap: 10 }}>
                  <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" accessibilityLabel="Foto terpilih" />
                  <View style={styles.row}>
                    <Button title="Foto ulang" icon="camera-reverse-outline" variant="outline" style={{ flex: 1 }} onPress={() => setCameraOpen(true)} />
                    <Button title="Hapus" icon="trash-outline" variant="danger" style={{ flex: 1 }} onPress={() => setPhoto(null)} />
                  </View>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <Pressable
                    testID="take-photo"
                    onPress={() => setCameraOpen(true)}
                    disabled={needsTitle}
                    style={({ pressed }) => [styles.photoBox, needsTitle && styles.photoBoxOff, pressed && { opacity: 0.8 }]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: needsTitle }}
                    accessibilityLabel="Buka kamera GPS">
                    <Ionicons name="camera" size={48} color={needsTitle ? colors.textMuted : colors.primary} />
                    <Text style={[styles.photoBoxText, needsTitle && { color: colors.textMuted }]}>Buka kamera GPS</Text>
                    <Text style={styles.photoBoxHint}>
                      {needsTitle
                        ? 'Isi judul foto / catatan di atas dulu. Tulisan itu jadi judul di foto.'
                        : isCheckpoint
                          ? `Foto lokasi Anda sekarang (Checkpoint ${checkpointNo}). Judul, waktu, nama Anda, dan lokasi langsung tercetak di foto.`
                          : 'Pastikan tulisan di struk terbaca. Waktu, nama Anda, dan lokasi langsung tercetak di foto.'}
                    </Text>
                  </Pressable>
                  {isCost ? (
                    <Button title="Pilih dari galeri" icon="images-outline" variant="outline" onPress={async () => handlePick(await pickFromGallery())} />
                  ) : null}
                </View>
              )}
              {(gpsProblem || cameraProblem) && !shot && !photo ? (
                <Banner tone="warning" icon={cameraProblem ? 'camera-outline' : 'location-outline'}>
                  {`${cameraProblem ?? gpsProblem?.error} ${isCheckpoint ? 'Anda tetap bisa kirim catatan saja.' : 'Anda tetap bisa pilih foto dari galeri.'}`}
                </Banner>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.label}>Foto odometer</Text>
              {photo ? (
                <View style={{ gap: 10 }}>
                  <Image source={{ uri: photo }} style={styles.preview} resizeMode="cover" accessibilityLabel="Foto terpilih" />
                  <View style={styles.row}>
                    <Button title="Foto ulang" icon="camera-reverse-outline" variant="outline" style={{ flex: 1 }} onPress={async () => handlePick(await takePhoto())} />
                    <Button title="Hapus" icon="trash-outline" variant="danger" style={{ flex: 1 }} onPress={() => setPhoto(null)} />
                  </View>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <Pressable
                    testID="take-photo"
                    onPress={async () => handlePick(await takePhoto())}
                    style={({ pressed }) => [styles.photoBox, pressed && { opacity: 0.8 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Ambil foto dengan kamera">
                    <Ionicons name="camera" size={48} color={colors.primary} />
                    <Text style={styles.photoBoxText}>Ambil foto</Text>
                    <Text style={styles.photoBoxHint}>Pastikan angka kilometer terbaca jelas</Text>
                  </Pressable>
                  <Button title="Pilih dari galeri" icon="images-outline" variant="outline" onPress={async () => handlePick(await pickFromGallery())} />
                </View>
              )}
            </>
          )}

          {isCost || isOdo ? (
            <>
              <Text style={styles.label}>{isOdo ? 'Angka odometer (km)' : 'Jumlah biaya'}</Text>
              <View style={styles.amountRow}>
                {isCost ? <Text style={styles.unit}>Rp</Text> : null}
                <TextInput
                  testID="amount-input"
                  value={amount != null ? formatThousands(amount) : ''}
                  // Cost: 8 digits, the server refuses more than Rp 100.000.000 (report and photo would be lost).
                  onChangeText={(t) => setAmountText(t.replace(/\D/g, '').slice(0, isOdo ? 7 : 8))}
                  keyboardType="number-pad"
                  placeholder={isOdo ? 'Contoh: 45.210' : '0'}
                  placeholderTextColor="#8593a3"
                  style={styles.amountInput}
                  accessibilityLabel={isOdo ? 'Angka odometer dalam kilometer' : 'Jumlah biaya dalam rupiah'}
                />
                {isOdo ? <Text style={styles.unit}>km</Text> : null}
              </View>
            </>
          ) : null}

          {isCheckpoint ? null : notesField}

          {error ? (
            <Banner tone="error" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          {!online ? (
            <Banner tone="warning" icon="cloud-offline">
              Tidak ada sinyal. Laporan akan disimpan dan dikirim otomatis nanti.
            </Banner>
          ) : null}

          <Button
            title="Kirim laporan"
            icon="send"
            big
            onPress={submit}
            loading={busy}
            disabled={!!odoBlocked}
            testID="submit-report"
          />
          <Button title="Batal" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>

      {gpsCamera ? (
        <StampCamera
          visible={cameraOpen}
          info={{
            // Checkpoint: the driver's own title (catatan); receipts: what was paid.
            title: isCheckpoint ? stampTitle : (TITLES[type] ?? '').toUpperCase(),
            orderCode: trip?.order_code ?? null,
            driverName: me.data?.name ?? 'Driver',
          }}
          onClose={() => setCameraOpen(false)}
          onGpsProblem={onGpsProblem}
          onCameraProblem={onCameraProblem}
          onCaptured={(p) => {
            setShot(p);
            setPhoto(null);
            setError(null);
            setGpsProblem(null);
            setCameraProblem(null);
            setCameraOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: { fontSize: font.body, fontWeight: '800', color: colors.navy, marginTop: 6 },
  hintText: { fontSize: font.body, color: colors.textMuted, fontWeight: '700' },
  photoBox: {
    minHeight: 180,
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
  photoBoxOff: { borderColor: colors.border, backgroundColor: colors.surface },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16, backgroundColor: colors.surface },
  stampPreview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, backgroundColor: '#000' },
  row: { flexDirection: 'row', gap: 10 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 64,
    gap: 10,
  },
  unit: { fontSize: font.title, fontWeight: '800', color: colors.textMuted },
  amountInput: { flex: 1, minWidth: 0, fontSize: 28, fontWeight: '900', color: colors.navy, minHeight: 60, ...noOutline },
  notes: {
    minHeight: 96,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    fontSize: font.body,
    color: colors.text,
    textAlignVertical: 'top',
    ...noOutline,
  },
  notesLocked: { backgroundColor: colors.surface, color: colors.textMuted },
});
