import { Pressable, StyleSheet, View } from 'react-native';

import { useOnline } from '@/lib/network';
import { retryNow, useQueue } from '@/lib/queue';
import { Banner } from './ui';

/** "Tidak ada sinyal" + "N laporan menunggu dikirim" banners. Pass tripId to count one trip only. */
export function SyncBanners({ tripId }: { tripId?: string }) {
  const online = useOnline();
  const queue = useQueue();
  const items = tripId ? queue.filter((q) => q.tripId === tripId) : queue;
  const reports = items.filter((q) => q.kind === 'report').length;
  const actions = items.length - reports;
  if (online && !items.length) return null;

  const parts: string[] = [];
  if (reports) parts.push(`${reports} laporan`);
  if (actions) parts.push(`${actions} perubahan status`);
  return (
    <View style={styles.wrap}>
      {!online ? (
        <Banner tone="error" icon="cloud-offline">
          Tidak ada sinyal. Data tetap tersimpan dan dikirim otomatis nanti.
        </Banner>
      ) : null}
      {items.length ? (
        <Pressable onPress={retryNow} accessibilityRole="button" accessibilityHint="Coba kirim sekarang">
          <Banner tone="warning" icon="time">
            {`${parts.join(' & ')} menunggu dikirim${online ? ' · ketuk untuk kirim sekarang' : ''}`}
          </Banner>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 8 } });
