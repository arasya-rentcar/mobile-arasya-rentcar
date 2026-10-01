import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';
import { dismissNotice, useNotices } from '@/lib/notices';

export function NoticeHost() {
  const notices = useNotices();
  const insets = useSafeAreaInsets();
  if (!notices.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 16 }]}>
      {notices.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => dismissNotice(n.id)}
          accessibilityRole="alert"
          style={[
            styles.notice,
            { backgroundColor: n.tone === 'error' ? colors.danger : n.tone === 'success' ? colors.success : colors.navy },
          ]}>
          <Ionicons
            name={n.tone === 'error' ? 'alert-circle' : n.tone === 'success' ? 'checkmark-circle' : 'information-circle'}
            size={24}
            color={colors.white}
          />
          <Text style={styles.text}>{n.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, gap: 8, zIndex: 1000 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { color: colors.white, fontSize: font.body, fontWeight: '700', flex: 1 },
});
