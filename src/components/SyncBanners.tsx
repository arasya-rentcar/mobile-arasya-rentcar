import { Pressable, StyleSheet, View } from 'react-native';

import { useOnline } from '@/lib/network';
import { useQueue } from '@/lib/queue';
import { sendQueueNow, useSendingNow } from '@/lib/trips';
import { Banner } from './ui';

/** "Tidak ada sinyal" + "N laporan menunggu dikirim" banners. Pass tripId to count one trip only. */
export function SyncBanners({ tripId }: { tripId?: string }) {
  const online = useOnline();
  const queue = useQueue();
  const sending = useSendingNow();
  const all = tripId ? queue.filter((q) => q.tripId === tripId) : queue;
  const failed = all.filter((q) => q.failed);
  const items = all.filter((q) => !q.failed);
  const reports = items.filter((q) => q.kind === 'report').length;
  const requests = items.filter((q) => q.kind === 'request').length;
  const actions = items.length - reports - requests;
  if (online && !all.length) return null;

  const parts: string[] = [];
  if (reports) parts.push(`${reports} laporan`);
  if (actions) parts.push(`${actions} perubahan status`);
  if (requests) parts.push(`${requests} permintaan`);
  return (
    <View style={styles.wrap}>
      {!online ? (
        <Banner tone="error" icon="cloud-offline">
          Tidak ada sinyal. Data tetap tersimpan dan dikirim otomatis nanti.
        </Banner>
      ) : null}
      {failed.length ? (
        <Pressable onPress={sendQueueNow} disabled={sending} accessibilityRole="button" accessibilityHint="Coba kirim ulang">
          <Banner tone="error" icon="alert-circle">
            {`${failed.length} data gagal dikirim${failed[0]?.lastError ? ` (${failed[0].lastError})` : ''} · ketuk untuk coba lagi`}
          </Banner>
        </Pressable>
      ) : null}
      {items.length ? (
        <Pressable onPress={sendQueueNow} disabled={sending} accessibilityRole="button" accessibilityHint="Coba kirim sekarang">
          <Banner tone="warning" icon="time">
            {sending
              ? `Mengirim ${parts.join(' & ')}...`
              : `${parts.join(' & ')} menunggu dikirim${online ? ' · ketuk untuk kirim sekarang' : ''}`}
          </Banner>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 8 } });
