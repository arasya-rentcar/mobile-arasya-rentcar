import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';
import { formatRupiah, formatShortDate, formatThousands, formatTime, parseRupiah, todayKey, wibDateKey } from '@/lib/format';
import { useOnline } from '@/lib/network';
import { showNotice } from '@/lib/notices';
import { discardItem, retryFailed, useQueue, type QueueItem } from '@/lib/queue';
import { etollCardAction, requestEtollTopup, useDriverRequests, useEtollCards } from '@/lib/trips';
import type { DriverRequest, EtollCard } from '@/lib/types';
import { EtollRequest } from './EtollRequest';
import { Banner, Button, Card } from './ui';

// Web only: the browser focus ring clashes with our own borders.
const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

/** A handled request is still mentioned for this long ("Top-up sudah diproses admin …"). */
const SHOW_RESULT_MS = 2 * 24 * 60 * 60 * 1000;

/** "10.12" today, else "2 Okt 10.12" (WIB). */
function whenText(iso: string | null | undefined): string {
  const key = wibDateKey(iso);
  const time = formatTime(iso) ?? '';
  if (!key) return time;
  return key === todayKey() ? time : `${formatShortDate(key)} ${time}`;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'pick' }
  | { kind: 'take'; card: EtollCard }
  | { kind: 'topup'; card: EtollCard }
  | { kind: 'balance'; card: EtollCard }
  | { kind: 'return'; card: EtollCard };

/**
 * Profile: the office e-toll cards. The cards are a shared pool: the driver takes one from the
 * operations team when a trip starts ("Ambil kartu"), asks for a top-up for it, writes down the
 * balance read on it, and returns it when back at the garage. Everything goes through the offline
 * queue. A server without the card pool, or before the office has entered any card, keeps the
 * free-text top-up request (EtollRequest).
 */
export function EtollCards({ etollCard, enabled }: { etollCard: string | null | undefined; enabled: boolean }) {
  const router = useRouter();
  const online = useOnline();
  const queue = useQueue();
  const { cards, isError, refetch } = useEtollCards(enabled);
  const requests = useDriverRequests(enabled);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Someone may have taken a card or the office topped one up: fresh list on every visit.
  const refetchReq = requests.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void refetch();
      void refetchReq();
    }, [enabled, refetch, refetchReq]),
  );

  if (cards === null || (cards && cards.length === 0)) return <EtollRequest etollCard={etollCard} enabled={enabled} />;
  if (!cards) {
    // First visit without saved data: loading, or no signal yet.
    return (
      <Card style={{ gap: 12 }}>
        <View style={styles.head}>
          <Ionicons name="card-outline" size={24} color={colors.navy} />
          <Text style={styles.title}>Kartu e-toll</Text>
        </View>
        {isError ? (
          <>
            <Text style={styles.hint}>Daftar kartu belum bisa dimuat.</Text>
            <Button title="Coba lagi" icon="refresh" variant="outline" onPress={() => void refetch()} />
          </>
        ) : (
          <Text style={styles.hint}>Memuat kartu…</Text>
        )}
      </Card>
    );
  }

  const all = cards;
  const mine = all.filter((c) => c.holder?.mine);
  const others = all.filter((c) => !c.holder?.mine);
  const amount = parseRupiah(amountText);
  const open = (next: Mode) => {
    setMode(next);
    setAmountText('');
    setNote('');
    setError(null);
  };
  const close = () => open({ kind: 'idle' });
  const offlineNote = () => {
    if (!online) showNotice('Disimpan di HP. Dikirim otomatis saat ada sinyal.', 'success');
  };

  const submit = () => {
    if (mode.kind === 'take') {
      etollCardAction('take', mode.card, amount);
    } else if (mode.kind === 'return') {
      etollCardAction('return', mode.card, amount);
    } else if (mode.kind === 'balance') {
      if (amount == null) return setError('Tulis sisa saldo yang terbaca di kartu.');
      etollCardAction('balance', mode.card, amount);
    } else if (mode.kind === 'topup') {
      requestEtollTopup({ card_id: mode.card.id, card_label: mode.card.label, balance: amount, note: note.trim() || undefined });
    }
    close();
    offlineNote();
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <Ionicons name="card-outline" size={24} color={colors.navy} />
        <Text style={styles.title}>Kartu e-toll</Text>
      </View>

      {mode.kind === 'pick' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Pilih kartu yang Anda ambil</Text>
          {others.map((c) => (
            <Pressable
              key={c.id}
              testID={`etoll-pick-${c.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Ambil ${c.name}`}
              onPress={() => open({ kind: 'take', card: c })}
              style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={styles.cardName}>{c.name}</Text>
                <Text style={styles.cardMeta}>{cardMeta(c)}</Text>
                <Text style={c.holder ? styles.heldOther : styles.atOffice}>
                  {c.holder ? `Dipegang ${c.holder.name}` : 'Di kantor'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
          ))}
          {!others.length ? <Text style={styles.hint}>Semua kartu sudah tercatat Anda pegang.</Text> : null}
          <Button title="Batal" variant="ghost" onPress={close} />
        </View>
      ) : mode.kind !== 'idle' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.formTitle}>{FORM_TITLE[mode.kind]}</Text>
          <Text style={styles.cardMeta}>{mode.card.label}</Text>
          {mode.kind === 'take' && mode.card.holder && !mode.card.holder.mine ? (
            <Banner tone="warning" icon="swap-horizontal">
              {`Kartu ini tercatat dipegang ${mode.card.holder.name}. Kalau Anda ambil, kartu pindah ke Anda.`}
            </Banner>
          ) : null}
          {mode.kind === 'return' ? (
            <Text style={styles.hint}>Kembalikan hanya kalau kartu sudah Anda serahkan ke kantor/garasi.</Text>
          ) : null}
          <Text style={styles.label}>{mode.kind === 'balance' ? 'Sisa saldo di kartu' : 'Sisa saldo di kartu (boleh dikosongkan)'}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.unit}>Rp</Text>
            <TextInput
              testID="etoll-amount-input"
              value={amount != null ? formatThousands(amount) : ''}
              // 8 digits: the server refuses more than Rp 100.000.000.
              onChangeText={(t) => setAmountText(t.replace(/\D/g, '').slice(0, 8))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#8593a3"
              style={styles.amountInput}
              accessibilityLabel="Sisa saldo e-toll dalam rupiah"
            />
          </View>
          {mode.kind === 'topup' ? (
            <>
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
            </>
          ) : null}
          {error ? (
            <Banner tone="error" icon="alert-circle">
              {error}
            </Banner>
          ) : null}
          {!online ? (
            <Banner tone="warning" icon="cloud-offline">
              Tidak ada sinyal. Disimpan dan dikirim otomatis nanti.
            </Banner>
          ) : null}
          <Button testID="etoll-submit" title={SUBMIT[mode.kind]} icon={SUBMIT_ICON[mode.kind]} big onPress={submit} />
          <Button title="Batal" variant="ghost" onPress={close} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {mine.length ? (
            mine.map((c) => (
              <HeldCard
                key={c.id}
                card={c}
                queue={queue}
                requests={requests.data ?? []}
                online={online}
                onTopup={() => open({ kind: 'topup', card: c })}
                onBalance={() => open({ kind: 'balance', card: c })}
                onReturn={() => open({ kind: 'return', card: c })}
              />
            ))
          ) : (
            <Text style={styles.empty} testID="etoll-none-held">
              Anda belum memegang kartu e-toll kantor. Setelah menerima kartu dari tim operasional, catat di sini.
            </Text>
          )}
          <FailedCardItems queue={queue} />
          {others.length ? (
            <Button
              testID="etoll-take"
              title={mine.length ? 'Ambil kartu lain' : 'Ambil kartu'}
              icon="add-circle-outline"
              variant={mine.length ? 'outline' : 'primary'}
              big={!mine.length}
              onPress={() => open({ kind: 'pick' })}
            />
          ) : null}
          {Platform.OS === 'android' ? (
            <Button title="Tes kartu NFC" icon="radio-outline" variant="ghost" onPress={() => router.push('/nfc-test')} />
          ) : null}
        </View>
      )}
    </Card>
  );
}

const FORM_TITLE = {
  take: 'Ambil kartu',
  topup: 'Minta top-up',
  balance: 'Catat sisa saldo',
  return: 'Kembalikan kartu',
} as const;
const SUBMIT = {
  take: 'Ya, saya pegang kartu ini',
  topup: 'Kirim permintaan',
  balance: 'Simpan saldo',
  return: 'Ya, sudah dikembalikan',
} as const;
const SUBMIT_ICON = {
  take: 'checkmark-circle',
  topup: 'send',
  balance: 'save-outline',
  return: 'return-down-back',
} as const;

/** "BCA Flazz · ••••5678" */
function cardMeta(c: EtollCard): string {
  return [c.issuer_label, `••••${c.card_last4}`].filter(Boolean).join(' · ');
}

function HeldCard({
  card,
  queue,
  requests,
  online,
  onTopup,
  onBalance,
  onReturn,
}: {
  card: EtollCard;
  queue: QueueItem[];
  requests: DriverRequest[];
  online: boolean;
  onTopup: () => void;
  onBalance: () => void;
  onReturn: () => void;
}) {
  const waiting = queue.find((q) => q.kind === 'request' && q.request?.card_id === card.id);
  const pendingCard = queue.some((q) => q.kind === 'etoll' && q.etoll?.cardId === card.id && !q.failed);
  const own = requests.filter((r) => r.card_id === card.id);
  const openOwn = own.find((r) => r.status === 'OPEN');
  const openOther = card.open_request && !card.open_request.mine ? card.open_request : null;
  const latest = own[0];
  const result =
    !openOwn && latest && latest.status !== 'OPEN' && latest.handled_at && Date.now() - Date.parse(latest.handled_at) < SHOW_RESULT_MS
      ? latest
      : null;
  const asked = !!(waiting || openOwn || openOther || (card.open_request?.mine ?? false));

  return (
    <View style={styles.held} testID={`etoll-held-${card.id}`}>
      <View style={{ gap: 2 }}>
        <Text style={styles.cardName}>{card.name}</Text>
        <Text style={styles.cardMeta}>{cardMeta(card)}</Text>
      </View>
      <View style={styles.balanceBox}>
        <Text style={styles.balanceLabel}>Perkiraan saldo</Text>
        {card.balance != null ? (
          <>
            <Text style={styles.balance}>{formatRupiah(Math.max(0, card.balance))}</Text>
            {card.balance_at ? <Text style={styles.hint}>{`Terakhir dicek ${whenText(card.balance_at)}`}</Text> : null}
          </>
        ) : (
          <Text style={styles.hint}>Saldo belum diketahui</Text>
        )}
      </View>
      {pendingCard ? (
        <Banner tone="warning" icon="time">
          {`Disimpan di HP · ${online ? 'sedang dikirim…' : 'dikirim otomatis saat ada sinyal'}`}
        </Banner>
      ) : null}

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
      ) : openOwn || card.open_request?.mine ? (
        <View style={styles.openBox} testID="etoll-open-request">
          <View style={styles.openHead}>
            <Ionicons name="hourglass-outline" size={22} color={colors.warning} />
            <Text style={styles.openTitle}>
              {`Top-up diminta ${whenText(openOwn?.created_at ?? card.open_request?.created_at)} · menunggu admin`}
            </Text>
          </View>
          <Text style={styles.hint}>Anda akan dapat notifikasi setelah admin mengisi saldo.</Text>
        </View>
      ) : openOther ? (
        <Banner tone="info" icon="hourglass-outline">
          {`Top-up kartu ini sudah diminta ${whenText(openOther.created_at)} · menunggu admin`}
        </Banner>
      ) : result ? (
        <Banner tone={result.status === 'DONE' ? 'success' : 'info'} icon={result.status === 'DONE' ? 'checkmark-circle' : 'close-circle'}>
          {result.status === 'DONE'
            ? `Top-up sudah diproses admin ${whenText(result.handled_at)}. Update saldo kartu dulu (tempel kartu) sebelum masuk tol.`
            : `Permintaan top-up dibatalkan admin ${whenText(result.handled_at)}${result.handled_note ? ` · ${result.handled_note}` : ''}`}
        </Banner>
      ) : null}

      {!asked ? <Button testID="etoll-topup" title="Minta top-up" icon="card" big onPress={onTopup} /> : null}
      <View style={styles.row}>
        <Button testID="etoll-balance" title="Catat saldo" icon="create-outline" variant="outline" style={{ flex: 1 }} onPress={onBalance} />
        <Button testID="etoll-return" title="Kembalikan" icon="return-down-back" variant="outline" style={{ flex: 1 }} onPress={onReturn} />
      </View>
    </View>
  );
}

/** Card actions that could not be sent (e.g. the card was deactivated): retry or drop. */
function FailedCardItems({ queue }: { queue: QueueItem[] }) {
  const failed = queue.filter((q) => q.kind === 'etoll' && q.failed);
  if (!failed.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {failed.map((q) => (
        <View key={q.id} style={{ gap: 8 }}>
          <Banner tone="error" icon="alert-circle">
            {`${ACTION_TEXT[q.etoll!.action]} ${q.etoll?.cardName ?? ''} gagal dikirim${q.lastError ? ` (${q.lastError})` : ''}.`}
          </Banner>
          <View style={styles.row}>
            <Button title="Coba lagi" icon="refresh" style={{ flex: 1 }} onPress={() => retryFailed(q.id)} />
            <Button title="Hapus" icon="trash-outline" variant="danger" style={{ flex: 1 }} onPress={() => discardItem(q.id)} />
          </View>
        </View>
      ))}
    </View>
  );
}

const ACTION_TEXT = { take: 'Ambil kartu', return: 'Kembalikan kartu', balance: 'Catat saldo' } as const;

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: font.large, fontWeight: '900', color: colors.navy },
  label: { fontSize: font.body, fontWeight: '800', color: colors.navy, marginTop: 4 },
  formTitle: { fontSize: font.title, fontWeight: '900', color: colors.navy },
  hint: { fontSize: font.small, color: colors.textMuted },
  empty: { fontSize: font.body, color: colors.textMuted, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  held: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 14, gap: 10 },
  cardName: { fontSize: font.title, fontWeight: '900', color: colors.navy },
  cardMeta: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  balanceBox: { backgroundColor: colors.primarySoft, borderRadius: 12, padding: 12, gap: 2 },
  balanceLabel: { fontSize: font.small, color: colors.navy, fontWeight: '700' },
  balance: { fontSize: font.hero, color: colors.navy, fontWeight: '900' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 72,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  atOffice: { fontSize: font.small, color: colors.success, fontWeight: '800' },
  heldOther: { fontSize: font.small, color: colors.warning, fontWeight: '800' },
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
});
