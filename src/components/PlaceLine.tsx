import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';
import { formatFix } from '@/lib/location';

/** Where a photo was taken: the place name (when the phone found one) above the coordinates. */
export function PlaceLine({
  name,
  latitude,
  longitude,
  accuracy,
  mocked,
  small,
}: {
  name?: string | null;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  mocked?: boolean;
  small?: boolean;
}) {
  const coords = `${formatFix({ latitude, longitude })}${accuracy != null ? ` · akurasi ${accuracy} m` : ''}`;
  return (
    <View style={styles.row} accessibilityLabel={`Lokasi: ${name ? `${name}, ` : ''}${coords}`}>
      <Ionicons name="location" size={small ? 16 : 20} color={mocked ? colors.danger : colors.success} style={styles.icon} />
      <View style={styles.texts}>
        {name ? (
          <Text style={[styles.name, small && styles.nameSmall]} numberOfLines={2}>
            {name}
          </Text>
        ) : null}
        <Text style={[styles.coords, small && styles.coordsSmall]}>{coords}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  icon: { marginTop: 1 },
  texts: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: font.body, color: colors.navy, fontWeight: '800' },
  nameSmall: { fontSize: font.small, fontWeight: '700', color: colors.text },
  coords: { fontSize: font.small, color: colors.text, fontWeight: '600' },
  coordsSmall: { fontSize: 13, color: colors.textMuted },
});
