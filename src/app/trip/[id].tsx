import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ReportList } from '@/components/ReportList';
import { Stepper } from '@/components/Stepper';
import { SyncBanners } from '@/components/SyncBanners';
import { Banner, Button, Card, Chip, Dialog, EmptyState, SectionTitle, type IconName } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { ADMIN_WHATSAPP, colors, font } from '@/lib/config';
import { formatDateKey, formatRupiah, mapsUrl, telUrl, tripDateKey, tripDays, tripTimeText, waNumber, wibDateKey } from '@/lib/format';
import { showNotice } from '@/lib/notices';
import { useOnline } from '@/lib/network';
import { retryNow, useQueue } from '@/lib/queue';
import { useSession } from '@/lib/session';
import { doTripAction, useTrip } from '@/lib/trips';
import {
  ACTION_DONE_TEXT,
  ACTION_LABEL,
  EXPENSE_STATUS,
  nextAction,
  odometerButtons,
  statusChip,
  unpaid,
  waitingForPayment,
  type ReportState,
} from '@/lib/tripState';
import type { Contact, Expense, ReportType } from '@/lib/types';

const ACTION_ICON: Record<string, IconName> = {
  accept: 'checkmark-circle-outline',
  start: 'car-sport-outline',
  arrive: 'location-outline',
  board: 'people-outline',
  finish: 'flag-outline',
};

const ACTION_HINT: Record<string, string> = {
  accept: 'Tekan untuk konfirmasi Anda siap menjalankan tugas ini.',
  start: 'Tekan saat Anda berangkat dari garasi.',
  arrive: 'Tekan saat Anda sudah sampai di lokasi jemput. Anda akan diminta foto di lokasi (dengan GPS).',
  board: 'Tekan saat pelanggan sudah naik dan perjalanan dimulai.',
  finish: 'Tekan setelah pelanggan diantar dan tugas selesai.',
};

export default function TripDetailScreen() {
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (session.status !== 'signedIn' || !id) return null;
  return <TripDetailView id={String(id)} />;
}

function open(url: string) {
  Linking.openURL(url).catch(() => showNotice('Tidak bisa membuka aplikasi untuk tautan ini.', 'error'));
}

function TripDetailView({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const { trip, error, isPending, refetch } = useTrip(id);
  const queue = useQueue();
  const online = useOnline();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishNote, setFinishNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const gone = error instanceof ApiError && error.status === 404;
  useEffect(() => {
    if (gone) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [gone]);

  const pendingReports = useMemo(() => queue.filter((q) => q.tripId === id && q.kind === 'report'), [queue, id]);

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}>
        {isPending ? (
          <EmptyState icon="hourglass-outline" title="Memuat tugas…" text="Sebentar, ya." />
        ) : (
          <View style={{ gap: 12 }}>
            <Banner tone="error" icon="alert-circle">
              {(error as Error | null)?.message ?? 'Tugas tidak ditemukan.'}
            </Banner>
            <Button title="Coba lagi" icon="refresh" onPress={() => refetch()} />
          </View>
        )}
      </View>
    );
  }

  const action = nextAction(trip);
  const chip = statusChip(trip);
  const locked = waitingForPayment(trip);
  const notPaidYet = unpaid(trip);
  const askAdmin = () =>
    open(
      `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(
        `Halo admin, saya driver tugas ${trip.order_code ?? ''} (${trip.customer.name}). Saya sudah di lokasi jemput, pembayaran pelanggan belum lunas di aplikasi. Mohon dicek.`,
      )}`,
    );

  const runAction = () => {
    if (!action || locked) return;
    if (action === 'finish') {
      setConfirmFinish(true);
      return;
    }
    if (action === 'arrive') {
      router.push({ pathname: '/arrive/[id]', params: { id: trip.id } });
      return;
    }
    doTripAction(trip.id, action);
    showNotice(online ? ACTION_DONE_TEXT[action] : `${ACTION_DONE_TEXT[action]} (dikirim saat ada sinyal)`, 'success');
  };

  const finish = () => {
    setConfirmFinish(false);
    doTripAction(trip.id, 'finish', finishNote);
    setFinishNote('');
    showNotice(online ? ACTION_DONE_TEXT.finish : `${ACTION_DONE_TEXT.finish} (dikirim saat ada sinyal)`, 'success');
  };

  const openReport = (type: ReportType) =>
    router.push({ pathname: '/report/[id]', params: { id: trip.id, type } });

  const odo = odometerButtons(trip, queue);

  const onRefresh = async () => {
    setRefreshing(true);
    retryNow();
    await refetch();
    setRefreshing(false);
  };

  const startKey = tripDateKey(trip);
  const endKey = wibDateKey(trip.end_at);
  const days = tripDays(trip);
  const countedExpenses = trip.expenses.filter((e) => e.status !== 'REJECTED');
  const expenseTotal = countedExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  return (
    <>
      <Stack.Screen options={{ title: trip.order_code ? `Tugas ${trip.order_code}` : 'Detail tugas' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
        <SyncBanners tripId={trip.id} />

        {/* Status + next step */}
        <Card style={{ gap: 16 }}>
          <View style={styles.statusRow}>
            <Chip label={chip.label} tone={chip.tone} />
            {trip.order_code ? <Text style={styles.code}>{trip.order_code}</Text> : null}
          </View>
          {trip.status === 'CANCELLED' ? (
            <Banner tone="error" icon="close-circle">
              Tugas ini dibatalkan. Tidak perlu dijalankan.
            </Banner>
          ) : (
            <Stepper trip={trip} />
          )}
          {action ? (
            <View style={{ gap: 8 }}>
              {locked ? (
                <Banner tone="warning" icon="wallet-outline">
                  Pelanggan belum lunas, jadi perjalanan belum boleh dimulai. Minta pelanggan melunasi pembayaran, lalu
                  hubungi admin. Tombol aktif setelah admin mencatat pelunasan (Anda akan dapat notifikasi).
                </Banner>
              ) : notPaidYet ? (
                <Banner tone="info" icon="wallet-outline">
                  Pelanggan belum lunas. Anda tetap boleh berangkat ke lokasi jemput, tapi perjalanan baru bisa dimulai
                  setelah lunas.
                </Banner>
              ) : null}
              <Button
                testID="primary-action"
                title={locked ? 'Mulai perjalanan (menunggu pelunasan)' : ACTION_LABEL[action]}
                icon={locked ? 'lock-closed-outline' : ACTION_ICON[action]}
                variant={action === 'finish' ? 'navy' : 'primary'}
                big
                disabled={locked}
                onPress={runAction}
              />
              {locked ? (
                <Button title="Hubungi admin (WhatsApp)" icon="logo-whatsapp" variant="whatsapp" onPress={askAdmin} />
              ) : (
                <Text style={styles.hint}>{ACTION_HINT[action]}</Text>
              )}
            </View>
          ) : trip.status === 'DONE' ? (
            <Banner tone="success" icon="checkmark-circle">
              Tugas selesai. Terima kasih! Struk yang tertinggal masih bisa dikirim di bawah.
            </Banner>
          ) : null}
        </Card>

        {/* Schedule */}
        <Card style={{ gap: 6 }}>
          <InfoLabel icon="calendar-outline">Jadwal</InfoLabel>
          <Text style={styles.big}>{startKey ? formatDateKey(startKey, true) : 'Tanggal belum ditentukan'}</Text>
          <Text style={styles.body}>{tripTimeText(trip)}</Text>
          {days > 1 && endKey ? (
            <Text style={styles.muted}>{`${days} hari, sampai ${formatDateKey(endKey, true)}`}</Text>
          ) : null}
        </Card>

        {/* Places */}
        <Card style={{ gap: 14 }}>
          <Place label="Lokasi jemput" icon="radio-button-on" color={colors.primary} text={trip.pickup_location} />
          <View style={styles.divider} />
          <Place label="Tujuan" icon="flag" color={colors.navy} text={trip.dropoff_location} />
        </Card>

        {/* Customer */}
        <Card style={{ gap: 14 }}>
          <InfoLabel icon="person-outline">Pelanggan</InfoLabel>
          <Person contact={trip.customer} main />
          {trip.other_customers.length ? (
            <>
              <View style={styles.divider} />
              <InfoLabel icon="people-outline">Kontak lain</InfoLabel>
              {trip.other_customers.map((c, i) => (
                <Person key={`${c.name}-${i}`} contact={c} />
              ))}
            </>
          ) : null}
        </Card>

        {/* Car & package */}
        <Card style={{ gap: 12 }}>
          <InfoLabel icon="car-outline">Mobil & paket</InfoLabel>
          {trip.car ? (
            <View style={styles.carRow}>
              <View style={styles.plate}>
                <Text style={styles.plateText}>{trip.car.plate_number}</Text>
              </View>
              <Text style={styles.big}>{trip.car.model}</Text>
            </View>
          ) : (
            <Text style={styles.muted}>Mobil belum ditentukan. Tanyakan ke admin.</Text>
          )}
          <View style={styles.facts}>
            {trip.service_kind ? <Fact label="Layanan" value={trip.service_kind} /> : null}
            {trip.service_package ? <Fact label="Paket" value={trip.service_package} /> : null}
            {trip.passenger_count ? <Fact label="Penumpang" value={`${trip.passenger_count} orang`} /> : null}
          </View>
        </Card>

        {trip.notes || trip.order_notes ? (
          <Card style={{ gap: 10 }}>
            <InfoLabel icon="document-text-outline">Catatan</InfoLabel>
            {trip.notes ? <Text style={styles.body}>{trip.notes}</Text> : null}
            {trip.order_notes ? <Text style={styles.body}>{trip.order_notes}</Text> : null}
          </Card>
        ) : null}

        {/* Reports */}
        <SectionTitle>Laporan & biaya</SectionTitle>
        {trip.status === 'CANCELLED' ? null : (
          <View style={styles.grid}>
            <OdometerButton
              testID="odo-start"
              label="Odometer awal"
              state={odo.start}
              enabled={odo.canStart}
              onPress={() => openReport('ODOMETER_START')}
            />
            <OdometerButton
              testID="odo-end"
              label="Odometer akhir"
              state={odo.end}
              enabled={odo.canEnd}
              lockedHint={odo.start === 'failed' ? 'Odometer awal gagal dikirim' : 'Kirim odometer awal dulu'}
              onPress={() => openReport('ODOMETER_END')}
            />
            <ReportButton icon="water-outline" label="Bensin" onPress={() => openReport('FUEL')} />
            <ReportButton icon="git-network-outline" label="Tol" onPress={() => openReport('TOLL')} />
            <ReportButton icon="car-outline" label="Parkir" onPress={() => openReport('PARKING')} />
            <ReportButton icon="cash-outline" label="Biaya lain" onPress={() => openReport('OTHER_COST')} />
            <ReportButton icon="camera-outline" label="Foto / Catatan" onPress={() => openReport('PHOTO')} wide />
          </View>
        )}
        {trip.expenses.length ? <ExpenseList expenses={trip.expenses} total={expenseTotal} /> : null}
        <ReportList reports={trip.reports} pending={pendingReports} />
      </ScrollView>

      <Dialog
        visible={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="Selesaikan tugas?"
        message="Pastikan pelanggan sudah diantar. Jangan lupa kirim foto odometer akhir dan struk biaya."
        actions={
          <>
            <Button title="Ya, selesai" icon="flag" variant="navy" onPress={finish} testID="confirm-finish" />
            <Button title="Batal" variant="ghost" onPress={() => setConfirmFinish(false)} />
          </>
        }>
        <TextInput
          value={finishNote}
          onChangeText={setFinishNote}
          placeholder="Catatan (boleh dikosongkan)"
          placeholderTextColor="#8593a3"
          multiline
          style={styles.noteInput}
        />
      </Dialog>
    </>
  );
}

function InfoLabel({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={styles.infoLabel}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.infoLabelText}>{children}</Text>
    </View>
  );
}

function Place({ label, icon, color, text }: { label: string; icon: IconName; color: string; text: string }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.infoLabel}>
        <Ionicons name={icon} size={18} color={color} />
        <Text style={styles.infoLabelText}>{label}</Text>
      </View>
      <Text style={styles.big}>{text}</Text>
      <Button title="Buka Maps" icon="navigate-outline" variant="outline" onPress={() => open(mapsUrl(text))} />
    </View>
  );
}

function Person({ contact, main }: { contact: Contact; main?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={main ? styles.big : styles.body}>{contact.name}</Text>
      {contact.phone ? (
        <>
          <Text style={styles.muted}>{contact.phone}</Text>
          <View style={styles.contactRow}>
            <Button
              title="Telepon"
              icon="call"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => open(telUrl(contact.phone!))}
            />
            <Button
              title="WhatsApp"
              icon="logo-whatsapp"
              variant="whatsapp"
              style={{ flex: 1 }}
              onPress={() => open(`https://wa.me/${waNumber(contact.phone!)}`)}
            />
          </View>
        </>
      ) : (
        <Text style={styles.muted}>Nomor HP tidak tersedia</Text>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const ODO_STATE_TEXT: Record<ReportState, string> = {
  sent: 'Terkirim',
  pending: 'Menunggu dikirim',
  failed: 'Gagal dikirim, lihat di bawah',
  none: '',
};

/** One odometer photo: tappable only when it is its turn (start first, then end, once each). */
function OdometerButton({
  label,
  state,
  enabled,
  lockedHint,
  onPress,
  testID,
}: {
  label: string;
  state: ReportState;
  enabled: boolean;
  lockedHint?: string;
  onPress: () => void;
  testID?: string;
}) {
  const done = state !== 'none';
  const sub = done ? ODO_STATE_TEXT[state] : enabled ? 'Ketuk untuk foto' : lockedHint ?? '';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={`${label}. ${sub}`}
      style={({ pressed }) => [
        styles.odo,
        done && (state === 'failed' ? styles.odoFailed : styles.odoDone),
        !enabled && !done && styles.odoLocked,
        pressed && enabled && { opacity: 0.8 },
      ]}>
      <Ionicons
        name={state === 'sent' ? 'checkmark-circle' : state === 'failed' ? 'alert-circle' : enabled ? 'speedometer-outline' : 'lock-closed-outline'}
        size={26}
        color={state === 'sent' ? colors.success : state === 'failed' ? colors.danger : enabled ? colors.primary : colors.textMuted}
      />
      <Text style={[styles.odoLabel, !enabled && !done && { color: colors.textMuted }]}>{label}</Text>
      {sub ? <Text style={styles.odoSub}>{sub}</Text> : null}
    </Pressable>
  );
}

/** Costs sent for this trip with the office's review (approved costs are reimbursed). */
function ExpenseList({ expenses, total }: { expenses: Expense[]; total: number }) {
  const LABEL: Record<string, string> = { FUEL: 'Bensin', TOLL: 'Tol', PARKING: 'Parkir', OTHER: 'Biaya lain' };
  return (
    <Card style={{ gap: 10 }}>
      <InfoLabel icon="receipt-outline">Biaya perjalanan</InfoLabel>
      {expenses.map((e) => {
        const st = e.status ? EXPENSE_STATUS[e.status] : null;
        return (
          <View key={e.id} style={{ gap: 4 }}>
            <View style={styles.expenseRow}>
              <Text style={[styles.body, { flex: 1 }]}>{`${LABEL[e.type] ?? e.type} ${formatRupiah(e.amount)}`}</Text>
              {st ? <Chip label={st.label} tone={st.tone} /> : null}
            </View>
            {e.status === 'REJECTED' && e.review_note ? <Text style={styles.reject}>{`Alasan: ${e.review_note}`}</Text> : null}
          </View>
        );
      })}
      <Text style={styles.total}>{`Total (tanpa yang ditolak): ${formatRupiah(total)}`}</Text>
    </Card>
  );
}

function ReportButton({ icon, label, onPress, wide }: { icon: IconName; label: string; onPress: () => void; wide?: boolean }) {
  return (
    <Button
      title={label}
      icon={icon}
      variant="secondary"
      onPress={onPress}
      style={[styles.reportBtn, wide && styles.reportBtnWide]}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  hint: { fontSize: font.small, color: colors.textMuted, textAlign: 'center' },
  big: { fontSize: font.large, fontWeight: '800', color: colors.navy, lineHeight: 26 },
  body: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  muted: { fontSize: font.small, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border },
  infoLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoLabelText: { fontSize: 14, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactRow: { flexDirection: 'row', gap: 10 },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  plate: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  plateText: { color: colors.white, fontWeight: '900', fontSize: font.body, letterSpacing: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fact: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  factLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '700' },
  factValue: { fontSize: font.body, color: colors.navy, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reportBtn: { flexBasis: '47%', flexGrow: 1, minHeight: 60 },
  reportBtnWide: { flexBasis: '100%' },
  total: { fontSize: font.body, fontWeight: '800', color: colors.navy },
  expenseRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reject: { fontSize: font.small, color: colors.danger },
  odo: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 84,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 2,
  },
  odoDone: { borderColor: '#9fd5b1', backgroundColor: colors.successSoft },
  odoFailed: { borderColor: '#e8a0a0', backgroundColor: '#fff5f5' },
  odoLocked: { borderColor: colors.border, backgroundColor: colors.surface },
  odoLabel: { fontSize: font.body, fontWeight: '800', color: colors.navy, textAlign: 'center' },
  odoSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  noteInput: {
    minHeight: 90,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: font.body,
    color: colors.text,
    textAlignVertical: 'top',
  },
});
