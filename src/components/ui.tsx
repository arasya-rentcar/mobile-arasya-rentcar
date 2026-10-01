import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, font } from '@/lib/config';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'primary' | 'secondary' | 'outline' | 'whatsapp' | 'danger' | 'ghost' | 'navy';

const variantStyle: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.white },
  navy: { bg: colors.navy, fg: colors.white },
  secondary: { bg: colors.primarySoft, fg: colors.navy },
  outline: { bg: colors.white, fg: colors.primary, border: colors.primary },
  whatsapp: { bg: colors.whatsapp, fg: colors.white },
  danger: { bg: colors.white, fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  big,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const v = variantStyle[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg },
        variant === 'ghost' && styles.buttonGhost,
        pressed && { opacity: 0.8 },
        inactive && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={big ? 26 : 22} color={v.fg} /> : null}
          <Text
            style={[styles.buttonText, big && styles.buttonTextBig, { color: v.fg }]}
            numberOfLines={2}
            maxFontSizeMultiplier={1.4}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const chipTone = {
  new: { bg: '#fff1d6', fg: '#8a4b00' },
  accepted: { bg: colors.primarySoft, fg: colors.primaryDark },
  running: { bg: '#e1f5e8', fg: colors.success },
  done: { bg: '#eceff3', fg: '#3c4a5c' },
  cancelled: { bg: colors.dangerSoft, fg: colors.danger },
  pending: { bg: colors.warningSoft, fg: colors.warning },
} as const;

export function Chip({ label, tone }: { label: string; tone: keyof typeof chipTone }) {
  const t = chipTone[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Banner({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  icon?: IconName;
  children: ReactNode;
}) {
  const t = {
    info: { bg: colors.primarySoft, fg: colors.navy },
    warning: { bg: colors.warningSoft, fg: '#7a3e00' },
    error: { bg: colors.dangerSoft, fg: colors.danger },
    success: { bg: colors.successSoft, fg: colors.success },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={22} color={t.fg} /> : null}
      <Text style={[styles.bannerText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function Dialog({
  visible,
  title,
  message,
  children,
  onClose,
  actions,
}: {
  visible: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Tutup" />
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {message ? <Text style={styles.dialogMessage}>{message}</Text> : null}
          {children}
          <View style={styles.dialogActions}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={44} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 2,
  },
  buttonBig: { minHeight: 64, borderRadius: 16 },
  buttonGhost: { borderWidth: 0, minHeight: 48 },
  buttonText: { fontSize: font.body, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  buttonTextBig: { fontSize: font.large },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  sectionTitle: {
    fontSize: font.small,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 8,
  },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  chipText: { fontSize: 14, fontWeight: '800' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  bannerText: { fontSize: font.small, fontWeight: '700', flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,38,75,0.55)',
    justifyContent: 'center',
    padding: 20,
  },
  dialog: { backgroundColor: colors.white, borderRadius: 20, padding: 20, gap: 12 },
  dialogTitle: { fontSize: font.title, fontWeight: '800', color: colors.navy },
  dialogMessage: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  dialogActions: { gap: 10, marginTop: 4 },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48, gap: 10 },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: { fontSize: font.title, fontWeight: '800', color: colors.navy, textAlign: 'center' },
  emptyText: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 24 },
});
