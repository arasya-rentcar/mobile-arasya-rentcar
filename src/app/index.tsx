import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { SyncBanners } from '@/components/SyncBanners';
import { TripCard } from '@/components/TripCard';
import { Banner, Button, EmptyState } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { dayLabel, formatDateKey, todayKey, tripDateKey } from '@/lib/format';
import { retryNow, useQueue } from '@/lib/queue';
import { useSession } from '@/lib/session';
import { useMe, useNotifications, useTrips } from '@/lib/trips';
import type { Trip } from '@/lib/types';

type Scope = 'active' | 'history';

function groupTrips(trips: Trip[]) {
  const sections: { title: string; key: string; data: Trip[] }[] = [];
  for (const t of trips) {
    const key = tripDateKey(t) ?? 'none';
    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = { key, title: dayLabel(key === 'none' ? null : key), data: [] };
      sections.push(section);
    }
    section.data.push(t);
  }
  return sections;
}

export default function TripsScreen() {
  const session = useSession();
  if (session.status !== 'signedIn' || session.user.role !== 'DRIVER') return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <TripsHome />;
}

function TripsHome() {
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<Scope>('active');
  const me = useMe();
  const inbox = useNotifications();
  const unread = inbox.data?.unread ?? 0;
  const active = useTrips('active');
  const history = useTrips('history');
  const queue = useQueue();
  const current = scope === 'active' ? active : history;

  useFocusEffect(
    useCallback(() => {
      void active.refetch();
      void me.refetch();
      void inbox.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const sections = useMemo(() => groupTrips(current.trips), [current.trips]);
  const newCount = active.trips.filter((t) => !t.accepted_at && t.status === 'SCHEDULED').length;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    retryNow();
    await Promise.all([current.refetch(), me.refetch(), inbox.refetch()]);
    setRefreshing(false);
  };

  const pendingByTrip = useMemo(() => {
    const m = new Map<string, number>();
    queue.forEach((q) => m.set(q.tripId, (m.get(q.tripId) ?? 0) + 1));
    return m;
  }, [queue]);

  const name = me.data?.name;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello} numberOfLines={1}>
              {name ? `Halo, ${name.split(' ')[0]}` : 'Halo, Driver'}
            </Text>
            <Text style={styles.today}>{formatDateKey(todayKey(), true)}</Text>
          </View>
          <Pressable
            testID="open-notifications"
            onPress={() => router.push('/notifications')}
            style={styles.profileBtn}
            accessibilityRole="button"
            accessibilityLabel={unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}>
            <View>
              <Ionicons name="notifications-outline" size={30} color={colors.white} />
              {unread > 0 ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.profileText}>Notifikasi</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/profile')}
            style={styles.profileBtn}
            accessibilityRole="button"
            accessibilityLabel="Profil">
            <Ionicons name="person-circle-outline" size={30} color={colors.white} />
            <Text style={styles.profileText}>Profil</Text>
          </Pressable>
        </View>

        <View style={styles.segment} accessibilityRole="tablist">
          {(['active', 'history'] as const).map((s) => {
            const on = scope === s;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.segmentBtn, on && styles.segmentBtnOn]}>
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {s === 'active' ? 'Tugas' : 'Riwayat'}
                </Text>
                {s === 'active' && newCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{newCount}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            <SyncBanners />
            {current.error && !current.data ? (
              <Banner tone="error" icon="alert-circle">
                {`Daftar tugas belum bisa dimuat. ${(current.error as Error).message}`}
              </Banner>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, section.title === 'Hari ini' && { color: colors.primary }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <TripCard
            trip={item}
            pending={pendingByTrip.get(item.id) ?? 0}
            onPress={() => router.push({ pathname: '/trip/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={
          current.isPending ? (
            <EmptyState icon="hourglass-outline" title="Memuat tugas…" text="Sebentar, ya." />
          ) : current.error ? (
            <View style={{ paddingTop: 24 }}>
              <Button title="Coba lagi" icon="refresh" onPress={() => current.refetch()} />
            </View>
          ) : scope === 'active' ? (
            <EmptyState
              icon="car-sport-outline"
              title="Belum ada tugas"
              text="Santai dulu. Tugas baru akan muncul di sini dan Anda akan dapat notifikasi."
            />
          ) : (
            <EmptyState icon="time-outline" title="Riwayat masih kosong" text="Tugas yang sudah selesai akan tampil di sini." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.navy, paddingHorizontal: 16, paddingBottom: 14, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hello: { color: colors.white, fontSize: font.hero, fontWeight: '900' },
  today: { color: '#c8d8ea', fontSize: font.small, marginTop: 2, fontWeight: '600' },
  profileBtn: { alignItems: 'center', minWidth: 56, minHeight: 56, justifyContent: 'center' },
  profileText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 4, gap: 4 },
  segmentBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtnOn: { backgroundColor: colors.white },
  segmentText: { color: colors.white, fontSize: font.body, fontWeight: '800' },
  segmentTextOn: { color: colors.navy },
  badge: {
    backgroundColor: '#f0a43a',
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.navy, fontWeight: '900', fontSize: 14 },
  bellBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#f0a43a',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.navy,
  },
  bellBadgeText: { color: colors.navy, fontWeight: '900', fontSize: 12 },
  list: { padding: 16, gap: 0 },
  sectionTitle: { fontSize: font.large, fontWeight: '900', color: colors.navy, marginTop: 14, marginBottom: 10 },
});
