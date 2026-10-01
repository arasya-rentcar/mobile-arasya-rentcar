import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Button } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { useSession } from '@/lib/session';

export default function AdminScreen() {
  const { logout, user } = useSession();
  return (
    <View style={styles.wrap}>
      <Ionicons name="desktop-outline" size={64} color={colors.primary} />
      <Text style={styles.title}>Aplikasi ini untuk driver.</Text>
      <Text style={styles.text}>Silakan pakai dashboard admin.</Text>
      {user?.email ? <Text style={styles.small}>Masuk sebagai {user.email}</Text> : null}
      <Button title="Keluar" variant="danger" icon="log-out-outline" onPress={logout} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.bg },
  title: { fontSize: font.title, fontWeight: '800', color: colors.navy, textAlign: 'center' },
  text: { fontSize: font.body, color: colors.text, textAlign: 'center' },
  small: { fontSize: font.small, color: colors.textMuted, marginBottom: 12 },
});
