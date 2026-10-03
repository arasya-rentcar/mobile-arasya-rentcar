import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Banner, Button, EmptyState, type IconName } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatDateTime, formatRupiah, formatShortDate, wibDateKey } from '@/lib/format';
import { useSession } from '@/lib/session';
import { isRequestNotice, markNotificationsRead, useNotifications } from '@/lib/trips';
import type { AppNotification } from '@/lib/types';

const ICON: Record<string, { name: IconName; color: string }> = {
  trip_assigned: { name: 'car-sport', color: colors.primary },
  trip_reminder: { name: 'alarm', color: colors.primary },
  trip_updated: { name: 'swap-horizontal', color: colors.warning },
  order_paid: { name: 'wallet', color: colors.success },
  payable_paid: { name: 'cash', color: colors.success },
  expense_rejected: { name: 'close-circle', color: colors.danger },
};
const REQUEST_ICON = { name: 'card' as IconName, color: colors.success };

export default function NotificationsScreen() {
  const session = useSession();
  if (session.status !== 'signedIn') return null;
  return <NotificationsView />;
}

function NotificationsView() {
  const insets = useSafeAreaInsets();
  const q = useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const items = q.data?.items ?? [];
  const unread = q.data?.unread ?? 0;

  const onRefresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  const open = (n: AppNotification) => {
    if (!n.read) void markNotificationsRead({ ids: [n.id] });
    const lineId = typeof n.data?.line_id === 'string' ? n.data.line_id : null;
    // A trip that was moved to another driver is no longer viewable.
    if (lineId && n.type !== 'trip_updated') router.push({ pathname: '/trip/[id]', params: { id: lineId } });
    // e.g. "Top-up e-toll sudah diproses": the request status is on the profile.
    else if (isRequestNotice(n.type)) router.push('/profile');
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Notifikasi' }} />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 4 }}>
            {q.error && !q.data ? (
              <Banner tone="error" icon="alert-circle">
                {`Notifikasi belum bisa dimuat. ${(q.error as Error).message}`}
              </Banner>
            ) : null}
            {unread > 0 ? (
              <Button
                title={`Tandai semua dibaca (${unread})`}
                icon="checkmark-done-outline"
                variant="outline"
                onPress={() => void markNotificationsRead({ all: true })}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => <Row n={item} onPress={() => open(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          q.isPending ? (
            <EmptyState icon="hourglass-outline" title="Memuat notifikasi…" text="Sebentar, ya." />
          ) : (
            <EmptyState
              icon="notifications-outline"
              title="Belum ada notifikasi"
              text="Tugas baru, pelunasan order, dan pembayaran fee Anda akan muncul di sini."
            />
          )
        }
      />
    </>
  );
}

type PayItem = { order_code?: string | null; service_date?: string | null; fee?: number; reimburse?: number; advance?: number; extras?: number; total?: number };

function Row({ n, onPress }: { n: AppNotification; onPress: () => void }) {
  const icon = ICON[n.type] ?? (isRequestNotice(n.type) ? REQUEST_ICON : { name: 'notifications' as IconName, color: colors.navy });
  const payItems = n.type === 'payable_paid' && Array.isArray(n.data?.items) ? (n.data.items as PayItem[]) : [];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n.read ? '' : 'Belum dibaca. '}${n.title}. ${n.body}`}
      style={({ pressed }) => [styles.row, !n.read && styles.rowUnread, pressed && { opacity: 0.85 }]}>
      <View style={[styles.icon, { backgroundColor: `${icon.color}1a` }]}>
        <Ionicons name={icon.name} size={24} color={icon.color} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !n.read && { fontWeight: '900' }]} numberOfLines={2}>
            {n.title}
          </Text>
          {!n.read ? <View style={styles.dot} /> : null}
        </View>
        <Text style={styles.body}>{n.body}</Text>
        {payItems.length ? <PayBreakdown items={payItems} /> : null}
        <Text style={styles.at}>{formatDateTime(n.created_at)}</Text>
      </View>
    </Pressable>
  );
}

/** What the fee payment is made of (fee + reimbursed costs − uang jalan + extras), per trip. */
function PayBreakdown({ items }: { items: PayItem[] }) {
  return (
    <View style={styles.breakdown}>
      {items.map((p, i) => {
        const day = wibDateKey(p.service_date ?? null);
        return (
          <View key={i} style={{ gap: 2 }}>
            {items.length > 1 ? (
              <Text style={styles.bdHead}>{`${day ? formatShortDate(day) : ''} ${p.order_code ?? ''}`.trim()}</Text>
            ) : null}
            <Line label="Fee" value={p.fee} />
            {p.reimburse ? <Line label="Ganti biaya" value={p.reimburse} /> : null}
            {p.advance ? <Line label="Uang jalan (dipotong)" value={-p.advance} /> : null}
            {p.extras ? <Line label="Lainnya" value={p.extras} /> : null}
            {items.length > 1 ? <Line label="Jumlah" value={p.total} bold /> : null}
          </View>
        );
      })}
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value?: number; bold?: boolean }) {
  if (value == null) return null;
  return (
    <View style={styles.bdRow}>
      <Text style={[styles.bdLabel, bold && { fontWeight: '800' }]}>{label}</Text>
      <Text style={[styles.bdValue, bold && { fontWeight: '900' }]}>
        {value < 0 ? `−${formatRupiah(-value)}` : formatRupiah(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowUnread: { borderColor: colors.primary, backgroundColor: '#f5f9ff' },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: font.body, fontWeight: '800', color: colors.navy },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  body: { fontSize: font.small, color: colors.text, lineHeight: 21 },
  at: { fontSize: 13, color: colors.textMuted },
  breakdown: { backgroundColor: colors.surface, borderRadius: 10, padding: 10, gap: 6 },
  bdHead: { fontSize: 13, fontWeight: '800', color: colors.navy },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  bdLabel: { fontSize: 14, color: colors.textMuted },
  bdValue: { fontSize: 14, color: colors.navy, fontWeight: '700' },
});
