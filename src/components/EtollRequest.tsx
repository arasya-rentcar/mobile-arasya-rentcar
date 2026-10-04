import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';
import { formatRupiah, formatShortDate, formatThousands, formatTime, parseRupiah, todayKey, wibDateKey } from '@/lib/format';
import { useOnline } from '@/lib/network';
import { showNotice } from '@/lib/notices';
import { discardItem, retryFailed, useQueue } from '@/lib/queue';
import { requestEtollTopup, useDriverRequests } from '@/lib/trips';
import type { DriverRequest } from '@/lib/types';
import { Banner, Button, Card } from './ui';

// Web only: the browser focus ring clashes with our own borders.
const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

/** A handled request is still mentioned for this long ("Top-up sudah diproses admin …"). */
const SHOW_RESULT_MS = 2 * 24 * 60 * 60 * 1000;

/** "10.12" today, else "Kam 2 Okt 10.12" (WIB). */
function whenText(iso: string | null | undefined): string {
  const key = wibDateKey(iso);
  const time = formatTime(iso) ?? '';
  if (!key) return time;
  return key === todayKey() ? time : `${formatShortDate(key)} ${time}`;
}

function amount(v: DriverRequest['balance']): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "Kartu Mandiri ••••1234 · saldo Rp 12.000" */
function requestDetail(card: string | null | undefined, balance: number | null): string {
  const parts: string[] = [];
  if (card) parts.push(`Kartu ${card}`);
  if (balance != null) parts.push(`sisa saldo ${formatRupiah(balance)}`);
  return parts.join(' · ');
}

/**
 * Profile: "Minta top-up e-toll". The driver confirms the card (the office's record, or types
 * another), may add the remaining balance and a note, and the request goes through the offline
 * queue (sent once, also when the phone resends). While a request is open the screen says so
 * instead of offering a second one; the office's answer comes as a notification.
 */
export function EtollRequest({ etollCard, enabled }: { etollCard: string | null | undefined; enabled: boolean }) {
  const online = useOnline();
  const queue = useQueue();
  const requests = useDriverRequests(enabled);
  const [formOpen, setFormOpen] = useState(false);
  const [editCard, setEditCard] = useState(false);
  const [card, setCard] = useState('');
  const [balanceText, setBalanceText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The office may have handled it meanwhile: refresh whenever the profile comes into view.
  const refetch = requests.refetch;
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [enabled, refetch]),
  );

  const savedCard = etollCard?.trim() || null;
  const waiting = queue.find((q) => q.kind === 'request' && q.request?.type === 'ETOLL_TOPUP');
  const mine = (requests.data ?? []).filter((r) => r.type === 'ETOLL_TOPUP');
  const open = mine.find((r) => r.status === 'OPEN');
  const latest = mine[0];
  const result =
    !open && latest && latest.status !== 'OPEN' && latest.handled_at && Date.now() - Date.parse(latest.handled_at) < SHOW_RESULT_MS
      ? latest
      : null;
  const balance = parseRupiah(balanceText);
  const typingCard = !savedCard || editCard;

  const start = () => {
    setFormOpen(true);
    setEditCard(false);
    setCard(savedCard ?? '');
    setBalanceText('');
    setNote('');
    setError(null);
  };

  const submit = () => {
    const label = (typingCard ? card : (savedCard ?? '')).trim();
    if (!label) return setError('Tulis kartu e-toll Anda dulu (contoh: Mandiri 6032 ••••1234).');
    setError(null);
    requestEtollTopup({ card_label: label, balance, note: note.trim() || undefined });
    setFormOpen(false);
    // Online, the answer follows right away ("sudah sampai ke admin"); meanwhile the card says it is being sent.
    if (!online) showNotice('Permintaan top-up disimpan. Dikirim otomatis saat ada sinyal.', 'success');
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <Ionicons name="card-outline" size={24} color={colors.navy} />
        <Text style={styles.title}>Kartu e-toll</Text>
      </View>
      {formOpen && !waiting && !open ? null : (
        <Text style={styles.cardText} testID="etoll-card">
          {savedCard ?? 'Kartu e-toll belum tercatat di kantor.'}
        </Text>
      )}

      {waiting ? (
        waiting.failed ? (
          <View style={{ gap: 8 }}>
            <Banner tone="error" icon="alert-circle">
              {`Permintaan top-up gagal dikirim${waiting.lastError ? ` (${waiting.lastError})` : ''}.`}
            </Banner>
            <View style={styles.row}>
              <Button title="Coba lagi" icon="refresh" style={{ flex: 1 }} onPress={() => retryFailed(waiting.id)} />
              <Button title="Hapus" icon="trash-outline" variant="danger" style={{ flex: 1 }} onPress={() => discardItem(waiting.id)} />
            </View>
          </View>
        ) : (
          <Banner tone="warning" icon="time">
            {`Permintaan top-up disimpan di HP · ${online ? 'sedang dikirim…' : 'dikirim otomatis saat ada sinyal'}`}
          </Banner>
        )
      ) : open ? (
        <View style={styles.openBox} testID="etoll-open-request">
          <View style={styles.openHead}>
            <Ionicons name="hourglass-outline" size={22} color={colors.warning} />
            <Text style={styles.openTitle}>{`Sudah diminta ${whenText(open.created_at)} · menunggu admin`}</Text>
          </View>
          {requestDetail(open.card_label, amount(open.balance)) ? (
            <Text style={styles.openText}>{requestDetail(open.card_label, amount(open.balance))}</Text>
          ) : null}
          {open.note ? <Text style={styles.openText}>{`Catatan: ${open.note}`}</Text> : null}
          <Text style={styles.hint}>Anda akan dapat notifikasi setelah admin mengisi saldo.</Text>
        </View>
      ) : formOpen ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Kartu yang diisi</Text>
          {typingCard ? (
            <TextInput
              testID="etoll-card-input"
              value={card}
              onChangeText={setCard}
              placeholder="Contoh: Mandiri 6032 ••••1234"
              placeholderTextColor="#8593a3"
              maxLength={60}
              autoCapitalize="words"
              style={styles.input}
              accessibilityLabel="Kartu e-toll"
            />
          ) : (
            <View style={styles.savedRow}>
              <Text style={styles.savedCard}>{savedCard}</Text>
              <Button title="Ganti" icon="create-outline" variant="outline" onPress={() => setEditCard(true)} />
            </View>
          )}

          <Text style={styles.label}>Sisa saldo (boleh dikosongkan)</Text>
          <View style={styles.amountRow}>
            <Text style={styles.unit}>Rp</Text>
            <TextInput
              testID="etoll-balance-input"
              value={balance != null ? formatThousands(balance) : ''}
              // 8 digits: the server refuses more than Rp 100.000.000 (the request would be dropped).
              onChangeText={(t) => setBalanceText(t.replace(/\D/g, '').slice(0, 8))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#8593a3"
              style={styles.amountInput}
              accessibilityLabel="Sisa saldo e-toll dalam rupiah"
            />
          </View>

          <Text style={styles.label}>Catatan (boleh dikosongkan)</Text>
          <TextInput
            testID="etoll-note-input"
            value={note}
            onChangeText={setNote}
            placeholder="Contoh: besok ke Bandung, saldo kurang"
            placeholderTextColor="#8593a3"
            multiline
            maxLength={300}
            style={[styles.input, styles.note]}
          />

          {error ? (
            <Banner tone="error" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          {!online ? (
            <Banner tone="warning" icon="cloud-offline">
              Tidak ada sinyal. Permintaan disimpan dan dikirim otomatis nanti.
            </Banner>
          ) : null}
          <Button testID="etoll-submit" title="Kirim permintaan" icon="send" big onPress={submit} />
          <Button title="Batal" variant="ghost" onPress={() => setFormOpen(false)} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {result ? (
            <Banner tone={result.status === 'DONE' ? 'success' : 'info'} icon={result.status === 'DONE' ? 'checkmark-circle' : 'close-circle'}>
              {`${result.status === 'DONE' ? 'Top-up terakhir sudah diproses admin' : 'Permintaan terakhir dibatalkan admin'} ${whenText(result.handled_at)}${result.handled_note ? ` · ${result.handled_note}` : ''}`}
            </Banner>
          ) : null}
          <Button testID="etoll-request" title="Minta top-up e-toll" icon="card" big onPress={start} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: font.large, fontWeight: '900', color: colors.navy },
  cardText: { fontSize: font.body, color: colors.textMuted, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  label: { fontSize: font.body, fontWeight: '800', color: colors.navy, marginTop: 4 },
  hint: { fontSize: font.small, color: colors.textMuted },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  savedCard: { fontSize: font.large, fontWeight: '900', color: colors.navy, flex: 1, minWidth: 0 },
  input: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: font.body,
    color: colors.text,
    ...noOutline,
  },
  note: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 60,
    gap: 10,
  },
  unit: { fontSize: font.title, fontWeight: '800', color: colors.textMuted },
  amountInput: { flex: 1, minWidth: 0, fontSize: 24, fontWeight: '900', color: colors.navy, minHeight: 56, ...noOutline },
  openBox: { backgroundColor: colors.warningSoft, borderRadius: 14, padding: 14, gap: 6 },
  openHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  openTitle: { fontSize: font.body, fontWeight: '900', color: '#7a3e00', flexShrink: 1 },
  openText: { fontSize: font.small, color: colors.text, fontWeight: '600' },
});
