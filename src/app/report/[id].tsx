import { useState } from 'react';
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

import { Banner, Button } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatThousands, parseRupiah } from '@/lib/format';
import { useOnline } from '@/lib/network';
import { showNotice } from '@/lib/notices';
import { keepPhoto, pickFromGallery, takePhoto, type PickResult } from '@/lib/photos';
import { enqueue, newId } from '@/lib/queue';
import { COST_TYPES, REPORT_LABEL } from '@/lib/tripState';
import type { ReportType } from '@/lib/types';

const TITLES: Record<string, string> = {
  ODOMETER_START: 'Foto odometer',
  ODOMETER_END: 'Foto odometer',
  FUEL: 'Bensin',
  TOLL: 'Tol',
  PARKING: 'Parkir',
  OTHER_COST: 'Biaya lain',
  PHOTO: 'Foto / Catatan',
  NOTE: 'Foto / Catatan',
};

// Web only: the browser focus ring clashes with our own borders.
const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

const VALID: ReportType[] = ['ODOMETER_START', 'ODOMETER_END', 'FUEL', 'TOLL', 'PARKING', 'OTHER_COST', 'PHOTO', 'NOTE'];

export default function ReportFormScreen() {
  const params = useLocalSearchParams<{ id: string; type?: string }>();
  const tripId = String(params.id);
  const initial = VALID.includes(params.type as ReportType) ? (params.type as ReportType) : 'PHOTO';
  const insets = useSafeAreaInsets();
  const online = useOnline();

  const [type, setType] = useState<ReportType>(initial === 'NOTE' ? 'PHOTO' : initial);
  const [photo, setPhoto] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOdo = type === 'ODOMETER_START' || type === 'ODOMETER_END';
  const isCost = COST_TYPES.includes(type);
  const amount = parseRupiah(amountText);

  const handlePick = (res: PickResult) => {
    if (!res) return;
    if ('error' in res) setError(res.error);
    else {
      setError(null);
      setPhoto(res.uri);
    }
  };

  const submit = async () => {
    if (isOdo && !photo) return setError('Ambil foto odometer dulu, ya.');
    if (isOdo && amount == null) return setError('Isi angka odometer (km) sesuai foto.');
    if (isCost && (!amount || amount <= 0)) return setError('Isi jumlah biaya (Rp) dulu.');
    if (type === 'OTHER_COST' && !notes.trim()) return setError('Tulis biaya untuk apa di kolom catatan.');
    if (type === 'PHOTO' && !photo && !notes.trim()) return setError('Ambil foto atau tulis catatan dulu.');
    setError(null);
    setBusy(true);
    try {
      const id = newId();
      const photoUri = photo ? await keepPhoto(photo, id) : null;
      const reportType: ReportType = type === 'PHOTO' && !photo ? 'NOTE' : type;
      enqueue({
        id,
        tripId,
        kind: 'report',
        reportType,
        // Odometer reports send the reading in km as `amount`; cost reports send rupiah.
        amount: isCost || isOdo ? amount : null,
        notes: notes.trim() || undefined,
        photoUri,
      });
      showNotice(
        online ? `${REPORT_LABEL[reportType]} sedang dikirim…` : `${REPORT_LABEL[reportType]} disimpan. Dikirim otomatis saat ada sinyal.`,
        'success',
      );
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/trip/[id]', params: { id: tripId } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: TITLES[type] ?? 'Kirim laporan' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled">
          {isOdo ? (
            <View style={styles.segment}>
              {(['ODOMETER_START', 'ODOMETER_END'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: type === t }}
                  style={[styles.segmentBtn, type === t && styles.segmentOn]}>
                  <Text style={[styles.segmentText, type === t && styles.segmentTextOn]}>
                    {t === 'ODOMETER_START' ? 'Awal (berangkat)' : 'Akhir (selesai)'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.label}>
            {isOdo ? 'Foto odometer' : isCost ? 'Foto struk (disarankan)' : 'Foto (boleh tidak ada)'}
          </Text>
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
                <Text style={styles.photoBoxHint}>
                  {isOdo ? 'Pastikan angka kilometer terbaca jelas' : 'Pastikan tulisan di struk terbaca'}
                </Text>
              </Pressable>
              <Button title="Pilih dari galeri" icon="images-outline" variant="outline" onPress={async () => handlePick(await pickFromGallery())} />
            </View>
          )}

          {isCost || isOdo ? (
            <>
              <Text style={styles.label}>{isOdo ? 'Angka odometer (km)' : 'Jumlah biaya'}</Text>
              <View style={styles.amountRow}>
                {isCost ? <Text style={styles.unit}>Rp</Text> : null}
                <TextInput
                  testID="amount-input"
                  value={amount != null ? formatThousands(amount) : ''}
                  onChangeText={(t) => setAmountText(t.replace(/\D/g, '').slice(0, isOdo ? 7 : 10))}
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

          <Text style={styles.label}>{type === 'OTHER_COST' ? 'Biaya untuk apa?' : 'Catatan (boleh dikosongkan)'}</Text>
          <TextInput
            testID="notes-input"
            value={notes}
            onChangeText={setNotes}
            placeholder={
              type === 'FUEL'
                ? 'Contoh: Pertamax 30 liter, SPBU Cibubur'
                : type === 'OTHER_COST'
                  ? 'Contoh: cuci mobil, makan driver'
                  : 'Tulis keterangan singkat'
            }
            placeholderTextColor="#8593a3"
            multiline
            style={styles.notes}
          />

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

          <Button title="Kirim laporan" icon="send" big onPress={submit} loading={busy} testID="submit-report" />
          <Button title="Batal" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: { fontSize: font.body, fontWeight: '800', color: colors.navy, marginTop: 6 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, minHeight: 52, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOn: { backgroundColor: colors.primary },
  segmentText: { fontSize: font.small, fontWeight: '800', color: colors.navy, textAlign: 'center' },
  segmentTextOn: { color: colors.white },
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
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16, backgroundColor: colors.surface },
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
});
