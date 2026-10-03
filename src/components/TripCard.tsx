import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';
import { tripDays, tripTimeText } from '@/lib/format';
import { statusChip, unpaid } from '@/lib/tripState';
import type { Trip } from '@/lib/types';
import { Chip } from './ui';

export function TripCard({ trip, onPress, pending }: { trip: Trip; onPress: () => void; pending: number }) {
  const chip = statusChip(trip);
  const days = tripDays(trip);
  const isNew = chip.tone === 'new';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Tugas ${trip.pickup_location} ke ${trip.dropoff_location}`}
      style={({ pressed }) => [styles.card, isNew && styles.cardNew, pressed && { opacity: 0.85 }]}>
      <View style={styles.top}>
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={20} color={colors.navy} />
          <Text style={styles.time} numberOfLines={2}>
            {tripTimeText(trip)}
          </Text>
        </View>
        <Chip label={chip.label} tone={chip.tone} />
      </View>

      <View style={styles.route}>
        <View style={styles.routeIcons}>
          <View style={[styles.pin, { backgroundColor: colors.primary }]} />
          <View style={styles.routeLine} />
          <View style={[styles.pin, { backgroundColor: colors.navy, borderRadius: 3 }]} />
        </View>
        <View style={{ flex: 1, gap: 14 }}>
          <Text style={styles.place} numberOfLines={2}>
            {trip.pickup_location}
          </Text>
          <Text style={styles.place} numberOfLines={2}>
            {trip.dropoff_location}
          </Text>
        </View>
      </View>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          <Text style={styles.metaText} numberOfLines={1}>
            {trip.customer.name}
          </Text>
        </View>
        {trip.car ? (
          <View style={styles.metaItem}>
            <Ionicons name="car-outline" size={18} color={colors.textMuted} />
            <Text style={[styles.metaText, styles.plate]} numberOfLines={1}>
              {trip.car.plate_number}
            </Text>
          </View>
        ) : null}
        {days > 1 ? <Chip label={`${days} hari`} tone="accepted" /> : null}
      </View>

      {unpaid(trip) ? (
        <View style={styles.pending}>
          <Ionicons name="wallet-outline" size={18} color={colors.warning} />
          <Text style={styles.pendingText}>Belum lunas: perjalanan belum boleh dimulai</Text>
        </View>
      ) : null}
      {pending > 0 ? (
        <View style={styles.pending}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.warning} />
          <Text style={styles.pendingText}>{pending} data menunggu dikirim</Text>
        </View>
      ) : null}
      {isNew ? (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Terima tugas</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  cardNew: { borderColor: '#f0a43a', borderWidth: 2 },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  time: { fontSize: font.large, fontWeight: '800', color: colors.navy, flexShrink: 1 },
  route: { flexDirection: 'row', gap: 12 },
  routeIcons: { alignItems: 'center', paddingTop: 6, width: 14 },
  pin: { width: 14, height: 14, borderRadius: 7 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 4 },
  place: { fontSize: font.body, fontWeight: '600', color: colors.text, lineHeight: 23 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '60%' },
  metaText: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  plate: { color: colors.navy, fontWeight: '800', letterSpacing: 0.5 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pendingText: { color: colors.warning, fontWeight: '700', fontSize: font.small },
  cta: {
    marginHorizontal: -16,
    marginBottom: -16,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaText: { color: colors.white, fontWeight: '800', fontSize: font.body },
});
