import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Banner, Button } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { colors, font } from '@/lib/config';
import { useSession } from '@/lib/session';

function loginErrorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'Tidak bisa terhubung. Periksa sinyal atau paket data, lalu coba lagi.';
    if (e.status === 401) {
      // The server's message is Indonesian; ignore the generic fallback api.ts makes up.
      return e.message && !e.message.startsWith('Permintaan gagal') ? e.message : 'Nomor HP/email atau kata sandi salah';
    }
    if (e.status === 400 || e.status === 404) return 'Nomor HP/email atau kata sandi salah. Periksa lagi, ya.';
    if (e.status === 403) return 'Akun Anda tidak aktif. Hubungi admin Arasya.';
    if (e.status === 429) return 'Terlalu sering mencoba. Tunggu sebentar lalu coba lagi.';
    return 'Server sedang bermasalah. Coba lagi beberapa saat lagi.';
  }
  return 'Terjadi kesalahan. Coba lagi.';
}

export default function LoginScreen() {
  const { login } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError('Isi nomor HP atau email dan kata sandi dulu.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(identifier, password);
    } catch (e) {
      setError(loginErrorText(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>A</Text>
            </View>
            <Text style={styles.brand}>Arasya Driver</Text>
            <Text style={styles.tagline}>Aplikasi tugas untuk driver Arasya Rent Car</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Nomor HP atau email</Text>
            <TextInput
              testID="login-identifier"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Contoh: 0812xxxxxxx"
              placeholderTextColor="#8593a3"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username"
              returnKeyType="next"
              style={styles.input}
            />

            <Text style={styles.label}>Kata sandi</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="login-password"
                value={password}
                onChangeText={setPassword}
                placeholder="Kata sandi"
                placeholderTextColor="#8593a3"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                style={[styles.input, styles.passwordInput]}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eye}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={26} color={colors.navy} />
                <Text style={styles.eyeText}>{showPassword ? 'Sembunyikan' : 'Lihat'}</Text>
              </Pressable>
            </View>

            {error ? (
              <Banner tone="error" icon="alert-circle">
                {error}
              </Banner>
            ) : null}

            <Button title="Masuk" onPress={submit} loading={loading} big icon="log-in-outline" testID="login-submit" />
            <Text style={styles.help}>Lupa kata sandi? Hubungi admin Arasya Rent Car.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: 20, gap: 28, justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: 8 },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  logoText: { color: colors.white, fontSize: 48, fontWeight: '900' },
  brand: { fontSize: 30, fontWeight: '900', color: colors.navy },
  tagline: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  form: { gap: 10 },
  label: { fontSize: font.body, fontWeight: '700', color: colors.navy, marginTop: 6 },
  input: {
    minHeight: 58,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: font.large,
    color: colors.text,
    backgroundColor: colors.white,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1 },
  eye: {
    minHeight: 58,
    minWidth: 64,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  eyeText: { fontSize: 12, fontWeight: '700', color: colors.navy },
  help: { textAlign: 'center', color: colors.textMuted, fontSize: font.small, marginTop: 8 },
});
