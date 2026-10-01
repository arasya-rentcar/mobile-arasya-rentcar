import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Banner, Button, Card, Dialog } from '@/components/ui';
import { API_URL, colors, font } from '@/lib/config';
import { useOnline } from '@/lib/network';
import { retryNow, useQueue } from '@/lib/queue';
import { useSession } from '@/lib/session';
import { useMe } from '@/lib/trips';

const STATUS_TEXT: Record<string, string> = {
  AVAILABLE: 'Siap tugas',
  ON_DUTY: 'Sedang bertugas',
  OFF: 'Libur',
};

export default function ProfileScreen() {
  const session = useSession();
  const me = useMe(session.status === 'signedIn');
  const queue = useQueue();
  const online = useOnline();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try {
      await session.logout();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={styles.content}>
      <Card style={styles.profile}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={44} color={colors.white} />
        </View>
        <Text style={styles.name}>{me.data?.name ?? 'Driver'}</Text>
        {me.data?.phone ? <Text style={styles.phone}>{me.data.phone}</Text> : null}
        {session.user?.email ? <Text style={styles.muted}>{session.user.email}</Text> : null}
        {me.data?.status ? (
          <View style={styles.status}>
            <Text style={styles.statusText}>{STATUS_TEXT[me.data.status] ?? me.data.status}</Text>
          </View>
        ) : null}
      </Card>

      {queue.length ? (
        <Card style={{ gap: 10 }}>
          <Banner tone="warning" icon="time">
            {`${queue.length} data belum terkirim.`}
          </Banner>
          <Button title="Kirim sekarang" icon="cloud-upload-outline" variant="outline" onPress={retryNow} disabled={!online} />
        </Card>
      ) : null}

      <Card style={{ gap: 8 }}>
        <Row label="Versi aplikasi" value={version} />
        <Row label="Koneksi" value={online ? 'Online' : 'Tidak ada sinyal'} />
        <Row label="Server" value={API_URL.replace(/^https?:\/\//, '')} />
      </Card>

      <Button title="Keluar" icon="log-out-outline" variant="danger" big onPress={() => setConfirm(true)} />

      <Dialog
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Keluar dari aplikasi?"
        message={
          queue.length
            ? `Masih ada ${queue.length} data yang BELUM TERKIRIM. Kalau keluar sekarang, data itu akan hilang. Sebaiknya tunggu sampai ada sinyal.`
            : 'Anda tidak akan menerima notifikasi tugas sampai masuk lagi.'
        }
        actions={
          <>
            <Button
              title={queue.length ? 'Tetap keluar (data hilang)' : 'Ya, keluar'}
              variant="danger"
              onPress={logout}
              loading={busy}
            />
            <Button title="Batal" variant="ghost" onPress={() => setConfirm(false)} />
          </>
        }
      />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  profile: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: { fontSize: font.hero, fontWeight: '900', color: colors.navy, textAlign: 'center' },
  phone: { fontSize: font.large, color: colors.text, fontWeight: '600' },
  muted: { fontSize: font.small, color: colors.textMuted },
  status: { marginTop: 6, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  statusText: { color: colors.navy, fontWeight: '800', fontSize: font.small },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, gap: 12 },
  rowLabel: { fontSize: font.body, color: colors.textMuted },
  rowValue: { fontSize: font.body, color: colors.navy, fontWeight: '700', flexShrink: 1 },
});
