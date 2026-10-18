import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner, Button, Card } from '@/components/ui';
import { colors, font } from '@/lib/config';
import { formatRupiah } from '@/lib/format';

/**
 * "Tes kartu NFC": reads an e-toll card and shows everything the phone got, to learn per bank
 * what can be read without the bank's keys (card number, balance, transaction history). Read
 * only: every command passes `isReadOnly` (SELECT, READ BINARY/RECORD, GET DATA/RESPONSE,
 * Mandiri's B3/B5 and DESFire's read commands); nothing that writes, credits or debits is ever
 * sent. The result can be shared as text for the office.
 */

type ProbeResult = { name: string; apdu: string; response: string; sw: string; note: string };
type ReadResult = { v: number; at: string; tech: string | null; tag: unknown; probes: ProbeResult[]; error?: string };

/** Version of the probe set, so shared results say which commands were tried. */
const PROBE_VERSION = 2;
/** Upper bound on commands per tap (the card must stay on the phone the whole time). */
const MAX_PROBES = 160;

const MANDIRI_AID = '00A40400080000000000000001';

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
  '6A83': 'record tidak ada',
  '6A81': 'tidak didukung',
  '6981': 'jenis file salah',
  '6986': 'tidak diizinkan',
  '6700': 'panjang salah',
  '9140': 'tidak ada kunci',
  '91F0': 'file tidak ada',
  '917E': 'panjang salah',
};

const OK_SW = new Set(['9000', '9100']);
const hex2 = (n: number) => (n & 0xff).toString(16).padStart(2, '0').toUpperCase();

/**
 * Only commands that read. ISO (CLA 00): SELECT, READ BINARY, READ RECORD, Mandiri info (B3)
 * and balance (B5), GET DATA, GET RESPONSE. EMV (CLA 80): GET DATA. DESFire (CLA 90):
 * GetVersion, more frames, GetApplicationIDs, SelectApplication, GetFileIDs, GetFileSettings,
 * ReadData, ReadRecords, GetValue.
 */
const READ_ONLY: Record<number, number[]> = {
  0x00: [0xa4, 0xb0, 0xb2, 0xb3, 0xb5, 0xca, 0xc0],
  0x80: [0xca],
  0x90: [0x60, 0xaf, 0x6a, 0x5a, 0x6f, 0xf5, 0xbd, 0xbb, 0x6c],
};
function isReadOnly(apdu: string): boolean {
  const b = hexToBytes(apdu);
  return b.length >= 4 && (READ_ONLY[b[0]] ?? []).includes(b[1]);
}

function hexToBytes(hex: string): number[] {
  return (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
}
const bytesToHex = (bytes: number[]) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase()).join('');

type IsoDep = { transceive: (bytes: number[]) => Promise<number[]> };
type Send = (name: string, apdu: string) => Promise<ProbeResult>;

/**
 * One command and its follow-ups, all read only: DESFire "more data" (91AF → AF), ISO "more
 * data" (61xx → GET RESPONSE) and "wrong length" (6Cxx → same command with the right Le).
 */
async function transceive(iso: IsoDep, name: string, apdu: string): Promise<ProbeResult> {
  if (!isReadOnly(apdu)) return { name, apdu, response: '', sw: '', note: 'ditolak: bukan perintah baca' };
  try {
    let bytes = await iso.transceive(hexToBytes(apdu));
    for (let i = 0; i < 8 && bytes.length >= 2; i++) {
      const sw = bytesToHex(bytes.slice(-2));
      let next: string | null = null;
      if (sw === '91AF') next = '90AF000000';
      else if (sw.startsWith('61')) next = `00C00000${sw.slice(2)}`;
      else if (sw.startsWith('6C') && i === 0) {
        bytes = await iso.transceive(hexToBytes(apdu.slice(0, -2) + sw.slice(2)));
        continue;
      }
      if (!next) break;
      const more = await iso.transceive(hexToBytes(next));
      bytes = [...bytes.slice(0, -2), ...more];
    }
    const sw = bytesToHex(bytes.slice(-2));
    return { name, apdu, response: bytesToHex(bytes.slice(0, -2)), sw, note: SW_TEXT[sw] ?? '' };
  } catch (e) {
    return { name, apdu, response: '', sw: '', note: `gagal: ${String((e as Error)?.message ?? e)}` };
  }
}

const ok = (r: ProbeResult) => OK_SW.has(r.sw);

/**
 * The probe set (v2). Order matters: each group selects before it reads.
 * 1. What the chip is: EMV directory, ISO master file, DESFire version and applications.
 * 2. DESFire (e.g. Brizzi): every application and file, read where the file is open without a key.
 * 3. Mandiri e-Money: info (card number) and balance, then searching for the transaction log
 *    inside the e-Money application (READ RECORD per file, READ BINARY, B3 pages, GET DATA).
 */
async function runProbes(send: Send, full: () => boolean) {
  await send('SELECT PPSE (EMV)', '00A404000E325041592E5359532E444446303100');
  await send('SELECT MF 3F00', '00A40000023F00');
  await send('DESFire GetVersion', '9060000000');
  const apps = await send('DESFire GetApplicationIDs', '906A000000');

  if (ok(apps) && apps.response.length >= 6) {
    const aids = (apps.response.match(/.{6}/g) ?? []).slice(0, 4);
    for (const aid of aids) {
      if (full()) return;
      const sel = await send(`DESFire app ${aid}: Select`, `905A000003${aid}00`);
      if (!ok(sel)) continue;
      const files = await send(`DESFire app ${aid}: GetFileIDs`, '906F000000');
      for (const fid of (ok(files) ? files.response.match(/../g) ?? [] : []).slice(0, 8)) {
        if (full()) return;
        const st = await send(`DESFire ${aid}/${fid}: GetFileSettings`, `90F5000001${fid}00`);
        const type = ok(st) ? st.response.slice(0, 2) : '';
        if (type === '00' || type === '01') await send(`DESFire ${aid}/${fid}: ReadData`, `90BD000007${fid}00000000000000`);
        else if (type === '02') await send(`DESFire ${aid}/${fid}: GetValue`, `906C000001${fid}00`);
        else if (type === '03' || type === '04') await send(`DESFire ${aid}/${fid}: ReadRecords`, `90BB000007${fid}00000000000000`);
      }
    }
  }

  const mandiri = await send('SELECT AID 0000000000000001', MANDIRI_AID);
  await send('Info kartu (B3)', '00B300003F');
  await send('Saldo (B5)', '00B500000A');
  if (!ok(mandiri)) return;

  // Transaction log search, inside the e-Money application.
  for (let page = 1; page <= 3; page++) {
    if (full()) return;
    await send(`Info kartu (B3) hal ${page}`, `00B3${hex2(page)}003F`);
  }
  for (const tag of ['9F4F', '9F36', '9F13', '9F17']) {
    if (full()) return;
    await send(`GET DATA ${tag}`, `80CA${tag}00`);
  }
  if (!full()) await send('READ BINARY (file aktif)', '00B0000000');
  for (let sfi = 1; sfi <= 10; sfi++) {
    if (full()) return;
    await send(`READ BINARY SFI ${sfi}`, `00B0${hex2(0x80 | sfi)}0000`);
    // Records 1..10 of this file; stop at the first record the card does not have.
    for (let rec = 1; rec <= 10; rec++) {
      if (full()) return;
      const r = await send(`READ RECORD SFI ${sfi} no ${rec}`, `00B2${hex2(rec)}${hex2((sfi << 3) | 4)}00`);
      if (!ok(r)) break;
    }
  }
  for (let rec = 1; rec <= 10; rec++) {
    if (full()) return;
    const r = await send(`READ RECORD file aktif no ${rec}`, `00B2${hex2(rec)}0400`);
    if (!ok(r)) break;
  }
}

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
  const [progress, setProgress] = useState(0);
  const [showAll, setShowAll] = useState(false);

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
    setProgress(0);
    setState('reading');
    const out: ReadResult = { v: PROBE_VERSION, at: new Date().toISOString(), tech: null, tag: null, probes: [] };
    try {
      out.tech = await m.requestTechnology([NfcTech.IsoDep, NfcTech.NfcA, NfcTech.NfcB]);
      out.tag = await m.getTag();
      if (out.tech === NfcTech.IsoDep) {
        const send = async (name: string, apdu: string) => {
          const r = await transceive(m.isoDepHandler, name, apdu);
          out.probes.push(r);
          setProgress(out.probes.length);
          return r;
        };
        await runProbes(send, () => out.probes.length >= MAX_PROBES);
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
  const cardNumber = guessCardNumber(result);
  // Answers with data first; the rest (unknown command, no such file) folded away.
  const found = result?.probes.filter((p) => ok(p) && p.response) ?? [];
  const rest = result?.probes.filter((p) => !(ok(p) && p.response)) ?? [];

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
              {`Tempelkan kartu ke belakang HP dan tahan sampai selesai… ${progress ? `(${progress} perintah)` : ''}`}
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
          {cardNumber ? <Row label="Nomor kartu" value={cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')} /> : null}
          {balance != null ? (
            <Banner tone="success" icon="wallet-outline">
              {`Kemungkinan saldo ${formatRupiah(balance)}. Cocokkan dengan aplikasi bank.`}
            </Banner>
          ) : null}
          <Text style={styles.muted}>
            {`${result.probes.length} perintah baca dicoba, ${found.length} menjawab dengan data.`}
          </Text>
          {found.map((p, i) => (
            <ProbeRow key={`f${i}`} p={p} />
          ))}
          {rest.length ? (
            <Button
              title={showAll ? 'Sembunyikan perintah tanpa data' : `Lihat ${rest.length} perintah tanpa data`}
              variant="ghost"
              onPress={() => setShowAll((v) => !v)}
            />
          ) : null}
          {showAll ? rest.map((p, i) => <ProbeRow key={`r${i}`} p={p} />) : null}
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

/** Mandiri e-Money: the first 8 bytes of the info answer are the 16-digit card number. */
function guessCardNumber(r: ReadResult | null): string | null {
  const p = r?.probes.find((x) => x.name === 'Info kartu (B3)');
  if (!p || !OK_SW.has(p.sw)) return null;
  const n = p.response.slice(0, 16);
  return /^\d{16}$/.test(n) ? n : null;
}

function ProbeRow({ p }: { p: ProbeResult }) {
  return (
    <View style={styles.probe}>
      <Text style={styles.probeName}>{`${p.name} · ${p.sw || '-'}${p.note ? ` (${p.note})` : ''}`}</Text>
      {p.response ? (
        <Text style={styles.mono} selectable>
          {p.response}
        </Text>
      ) : null}
    </View>
  );
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
