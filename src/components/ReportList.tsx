import { Image, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { API_URL, colors, font } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import type { QueueItem } from '@/lib/queue';
import { formatReportAmount, REPORT_LABEL } from '@/lib/tripState';
import type { Report } from '@/lib/types';
import { Chip } from './ui';

function absoluteUrl(url: string) {
  if (/^(https?:|data:|file:|blob:)/.test(url)) return url;
  const origin = API_URL.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

type Row = {
  key: string;
  type: string;
  notes: string | null;
  amount: number | null;
  photo: string | null;
  at: string;
  pending?: { attempts: number; lastError?: string };
};

export function ReportList({ reports, pending }: { reports: Report[]; pending: QueueItem[] }) {
  const rows: Row[] = [
    ...pending.map((q) => ({
      key: q.id,
      type: q.reportType ?? 'NOTE',
      notes: q.notes ?? null,
      amount: q.amount ?? null,
      photo: q.photoUri ?? null,
      at: q.createdAt,
      pending: { attempts: q.attempts, lastError: q.lastError },
    })),
    ...[...reports]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({
        key: r.id,
        type: r.report_type,
        notes: r.notes,
        amount: r.amount,
        photo: r.file_url ? absoluteUrl(r.file_url) : null,
        at: r.created_at,
      })),
  ];

  if (!rows.length) {
    return <Text style={styles.empty}>Belum ada laporan untuk tugas ini.</Text>;
  }

  return (
    <View style={{ gap: 10 }}>
      {rows.map((r) => (
        <View key={r.key} style={[styles.row, r.pending && styles.rowPending]}>
          {r.photo ? (
            <Image source={{ uri: r.photo }} style={styles.thumb} resizeMode="cover" accessibilityLabel="Foto laporan" />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]}>
              <Ionicons name="document-text-outline" size={28} color={colors.textMuted} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.titleRow}>
              <Text style={styles.type}>{REPORT_LABEL[r.type] ?? r.type}</Text>
              {r.amount != null ? <Text style={styles.amount}>{formatReportAmount(r.type, r.amount)}</Text> : null}
            </View>
            {r.notes ? (
              <Text style={styles.notes} numberOfLines={3}>
                {r.notes}
              </Text>
            ) : null}
            <Text style={styles.at}>{formatDateTime(r.at)}</Text>
            {r.pending ? (
              <View style={{ gap: 2 }}>
                <Chip label="Menunggu dikirim" tone="pending" />
                {r.pending.attempts > 0 && r.pending.lastError ? (
                  <Text style={styles.err}>Dicoba lagi otomatis ({r.pending.lastError})</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.sent}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.sentText}>Terkirim</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: font.body, color: colors.textMuted, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  rowPending: { borderColor: '#f0c27a', backgroundColor: '#fffaf0' },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  type: { fontSize: font.body, fontWeight: '800', color: colors.navy },
  amount: { fontSize: font.body, fontWeight: '800', color: colors.text },
  notes: { fontSize: font.small, color: colors.text },
  at: { fontSize: 13, color: colors.textMuted },
  err: { fontSize: 12, color: colors.warning },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sentText: { fontSize: 13, color: colors.success, fontWeight: '700' },
});
