import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button, Card } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatRupiah } from '@/lib/format';

/**
 * "Tes kartu NFC": reads an e-toll card and shows everything the phone got, to learn per bank
 * what can be read without the bank's keys (card number, balance, history). Read only: it sends
 * SELECT / GET / READ commands, never anything that writes, credits or debits. The result can be
 * shared as text for the office.
 */

type Probe = { name: string; apdu: string };
type ProbeResult = { name: string; apdu: string; response: string; sw: string; note: string };
type ReadResult = { at: string; tech: string | null; tag: unknown; probes: ProbeResult[]; error?: string };

// Read-only probes. SELECT and GET-style commands only; the card answers an error status for
// what it does not know. Order matters: each group selects before it reads.
const PROBES: Probe[] = [
  { name: 'SELECT PPSE (EMV)', apdu: '00A404000E325041592E5359532E444446303100' },
  { name: 'SELECT MF 3F00', apdu: '00A40000023F00' },
  { name: 'DESFire GetVersion', apdu: '9060000000' },
  { name: 'DESFire GetApplicationIDs', apdu: '906A000000' },
  { name: 'SELECT AID 0000000000000001', apdu: '00A40400080000000000000001' },
  { name: 'Info kartu (B3)', apdu: '00B300003F' },
  { name: 'Saldo (B5)', apdu: '00B500000A' },
];

const SW_TEXT: Record<string, string> = {
  '9000': 'OK',
  '9100': 'OK',
  '91AF': 'ada lanjutan',
  '6A82': 'tidak ada',
  '6A86': 'parameter salah',
  '6D00': 'perintah tidak dikenal',
  '6E00': 'kelas tidak dikenal',
  '6982': 'perlu izin/kunci',
  '91AE': 'perlu izin/kunci',
  '911C': 'perintah tidak dikenal',
  '919D': 'tidak diizinkan',
  '91A0': 'aplikasi tidak ada',
};

const hexToBytes = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
const bytesToHex = (bytes: number[]) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase()).join('');

/** The native module is only in the Android build; loaded lazily so web and old builds still run. */
function loadNfc(): typeof import('react-native-nfc-manager') | null {
  if (Platform.OS !== 'android') return null;
  try {
    return require('react-native-nfc-manager');
  } catch {
    return null;
  }
}

export default function NfcTestScreen() {
  const [nfc] = useState(loadNfc);
  const [state, setState] = useState<'checking' | 'unsupported' | 'off' | 'ready' | 'reading'>('checking');
  const [result, setResult] = useState<ReadResult | null>(null);
  const [label, setLabel] = useState('');

  const check = async () => {
    if (!nfc) return setState('unsupported');
    try {
      const m = nfc.default;
      if (!(await m.isSupported())) return setState('unsupported');
      await m.start();
      setState((await m.isEnabled()) ? 'ready' : 'off');
    } catch {
      setState('unsupported');
    }
  };

  useEffect(() => {
    void check();
    return () => {
      void nfc?.default.cancelTechnologyRequest().catch(() => undefined);
    };
  }, []);

  const read = async () => {
    if (!nfc) return;
    const m = nfc.default;
    const { NfcTech } = nfc;
    setResult(null);
    setState('reading');
    const out: ReadResult = { at: new Date().toISOString(), tech: null, tag: null, probes: [] };
    try {
      out.tech = await m.requestTechnology([NfcTech.IsoDep, NfcTech.NfcA, NfcTech.NfcB]);
      out.tag = await m.getTag();
      if (out.tech === NfcTech.IsoDep) {
        for (const p of PROBES) {
          let bytes: number[] = [];
          try {
            bytes = await m.isoDepHandler.transceive(hexToBytes(p.apdu));
            // DESFire sends long answers in parts (91AF): fetch the rest, read only.
            for (let i = 0; i < 3 && bytes.length >= 2 && bytesToHex(bytes.slice(-2)) === '91AF'; i++) {
              const more = await m.isoDepHandler.transceive(hexToBytes('90AF000000'));
              bytes = [...bytes.slice(0, -2), ...more];
            }
          } catch (e) {
            out.probes.push({ name: p.name, apdu: p.apdu, response: '', sw: '', note: `gagal: ${String((e as Error)?.message ?? e)}` });
            continue;
          }
          const sw = bytesToHex(bytes.slice(-2));
          out.probes.push({ name: p.name, apdu: p.apdu, response: bytesToHex(bytes.slice(0, -2)), sw, note: SW_TEXT[sw] ?? '' });
        }
      }
    } catch (e) {
      out.error = String((e as Error)?.message ?? e) || 'Kartu tidak terbaca';
    } finally {
      await m.cancelTechnologyRequest().catch(() => undefined);
    }
    setResult(out);
    setState('ready');
  };

  const cancel = async () => {
    await nfc?.default.cancelTechnologyRequest().catch(() => undefined);
    setState('ready');
  };

  const share = () => {
    if (!result) return;
    void Share.share({ message: JSON.stringify({ kartu: label.trim() || null, ...result }, null, 2) });
  };

  const tag = result?.tag as { id?: string; techTypes?: string[] } | null | undefined;
  const balance = guessBalance(result);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 10 }}>
        <Text style={styles.title}>Tes kartu NFC</Text>
        <Text style={styles.text}>
          Untuk uji coba kantor. Tempelkan kartu e-toll ke bagian belakang HP. Aplikasi hanya membaca, tidak mengubah isi atau
          saldo kartu.
        </Text>
        {state === 'checking' ? <Text style={styles.muted}>Memeriksa NFC…</Text> : null}
        {state === 'unsupported' ? (
          <Banner tone="error" icon="close-circle">
            HP ini tidak punya NFC, atau aplikasi versi ini belum bisa memakai NFC.
          </Banner>
        ) : null}
        {state === 'off' ? (
          <View style={{ gap: 8 }}>
            <Banner tone="warning" icon="radio-outline">
              NFC di HP ini mati. Nyalakan dulu di pengaturan.
            </Banner>
            <Button title="Buka pengaturan NFC" icon="settings-outline" onPress={() => void nfc?.default.goToNfcSetting()} />
            <Button title="Sudah dinyalakan" variant="outline" onPress={() => void check()} />
          </View>
        ) : null}
        {state === 'ready' ? (
          <>
            <Text style={styles.label}>Kartu apa? (untuk catatan)</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Contoh: BCA Flazz kartu 3"
              placeholderTextColor="#8593a3"
              maxLength={60}
              style={styles.input}
            />
            <Button title={result ? 'Baca kartu lagi' : 'Mulai baca kartu'} icon="radio-outline" big onPress={() => void read()} />
          </>
        ) : null}
        {state === 'reading' ? (
          <View style={{ gap: 8 }}>
            <Banner tone="info" icon="radio-outline">
              Tempelkan kartu ke belakang HP dan tahan sampai selesai…
            </Banner>
            <Button title="Batal" variant="ghost" onPress={() => void cancel()} />
          </View>
        ) : null}
      </Card>

      {result ? (
        <Card style={{ gap: 10 }}>
          {result.error ? (
            <Banner tone="error" icon="alert-circle">
              {`Kartu tidak terbaca: ${result.error}`}
            </Banner>
          ) : null}
          {tag?.id ? <Row label="ID chip" value={tag.id} /> : null}
          {tag?.techTypes?.length ? <Row label="Jenis" value={tag.techTypes.map((t) => t.split('.').pop()).join(', ')} /> : null}
          {balance != null ? (
            <Banner tone="success" icon="wallet-outline">
              {`Kemungkinan saldo ${formatRupiah(balance)}. Cocokkan dengan aplikasi bank.`}
            </Banner>
          ) : null}
          {result.probes.map((p) => (
            <View key={p.name} style={styles.probe}>
              <Text style={styles.probeName}>{`${p.name} · ${p.sw || '-'}${p.note ? ` (${p.note})` : ''}`}</Text>
              {p.response ? <Text style={styles.mono}>{p.response}</Text> : null}
            </View>
          ))}
          {result.tech && result.tech !== 'IsoDep' ? (
            <Text style={styles.muted}>Kartu ini bukan jenis IsoDep; hanya ID dan jenis chip yang dibaca.</Text>
          ) : null}
          <Button title="Bagikan hasil" icon="share-social-outline" onPress={share} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

/**
 * Mandiri e-Money style answer to "Saldo (B5)": the first four bytes, least significant first.
 * Only a guess for the test; the screen asks to compare it with the bank's app.
 */
function guessBalance(r: ReadResult | null): number | null {
  const p = r?.probes.find((x) => x.name === 'Saldo (B5)');
  if (!p || p.sw !== '9000' || p.response.length < 8) return null;
  const b = hexToBytes(p.response.slice(0, 8));
  const n = b[0] + b[1] * 0x100 + b[2] * 0x10000 + b[3] * 0x1000000;
  return n >= 0 && n <= 20_000_000 ? n : null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, styles.monoInline]} selectable>
        {value}
      </Text>
    </View>
  );
}

const mono = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: font.title, fontWeight: '900', color: colors.navy },
  text: { fontSize: font.body, color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  label: { fontSize: font.body, fontWeight: '800', color: colors.navy },
  input: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: font.body,
    color: colors.text,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontSize: font.body, color: colors.textMuted },
  rowValue: { fontSize: font.body, color: colors.navy, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  monoInline: { fontFamily: mono },
  probe: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 4 },
  probeName: { fontSize: font.small, fontWeight: '800', color: colors.navy },
  mono: { fontFamily: mono, fontSize: 13, color: colors.text },
});
