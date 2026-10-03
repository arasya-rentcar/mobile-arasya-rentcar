import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@/lib/config';
import { formatTime } from '@/lib/format';
import { isAccepted } from '@/lib/tripState';
import type { Trip } from '@/lib/types';

export function Stepper({ trip }: { trip: Trip }) {
  const steps = [
    { label: 'Diterima', done: isAccepted(trip), at: trip.accepted_at },
    { label: 'Berangkat', done: !!trip.actual_start_at || trip.status === 'IN_PROGRESS', at: trip.actual_start_at },
    { label: 'Sampai jemput', done: !!trip.actual_pickup_at, at: trip.actual_pickup_at },
    // Older servers have no "Mulai perjalanan" step (field not sent).
    ...(trip.customer_onboard_at !== undefined
      ? [{ label: 'Mulai jalan', done: !!trip.customer_onboard_at, at: trip.customer_onboard_at ?? null }]
      : []),
    { label: 'Selesai', done: trip.status === 'DONE', at: trip.trip_finished_at },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <View style={styles.row} accessibilityRole="progressbar">
      {steps.map((s, i) => {
        const active = i === current;
        return (
          <View key={s.label} style={styles.step}>
            <View style={styles.track}>
              <View style={[styles.line, { backgroundColor: i === 0 ? 'transparent' : s.done || active ? colors.primary : colors.border }]} />
              <View
                style={[
                  styles.dot,
                  s.done && styles.dotDone,
                  active && styles.dotActive,
                ]}>
                {s.done ? (
                  <Ionicons name="checkmark" size={18} color={colors.white} />
                ) : (
                  <Text style={[styles.num, active && { color: colors.primary }]}>{i + 1}</Text>
                )}
              </View>
              <View
                style={[
                  styles.line,
                  { backgroundColor: i === steps.length - 1 ? 'transparent' : steps[i + 1].done || i + 1 === current ? colors.primary : colors.border },
                ]}
              />
            </View>
            <Text style={[styles.label, (s.done || active) && styles.labelOn]} numberOfLines={2}>
              {s.label}
            </Text>
            {s.done && s.at ? <Text style={styles.time}>{formatTime(s.at)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 4 },
  dot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotActive: { borderColor: colors.primary },
  num: { fontWeight: '800', color: colors.textMuted, fontSize: 15 },
  label: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.textMuted, textAlign: 'center' },
  labelOn: { color: colors.navy },
  time: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
