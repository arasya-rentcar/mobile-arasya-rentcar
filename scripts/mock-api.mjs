// Mock of the Arasya driver API for local development and UI tests. No dependencies.
// Usage: node scripts/mock-api.mjs   (PORT=4010 by default)
// Then:  EXPO_PUBLIC_API_URL=http://localhost:4010/api/v1 npx expo start
// Logins: driver 0812345678 / test1234 · admin admin@arasya.id / admin123
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 4010);
const BASE = '/api/v1';
const DRIVER_TOKEN = 'mock-token-driver';
const ADMIN_TOKEN = 'mock-token-admin';

// ---- sample data (dates relative to "today" in WIB) ----
const WIB = 7 * 3600 * 1000;
const wibDay = (offset) => new Date(Date.now() + WIB + offset * 86400000).toISOString().slice(0, 10);
const at = (offset, hhmm) => new Date(`${wibDay(offset)}T${hhmm}:00+07:00`).toISOString();

const driver = { id: 'drv-1', name: 'Budi Santoso', phone: '0812345678', status: 'ON_DUTY', type: 'INTERNAL' };

function trip(t) {
  return {
    order_code: null, status: 'ASSIGNED', accepted_at: null, service_kind: null, service_package: null,
    notes: null, order_notes: null, passenger_count: null, other_customers: [], car: null,
    actual_start_at: null, actual_pickup_at: null, trip_finished_at: null, ...t,
  };
}

const trips = [
  trip({
    id: 'line-new-bandara', order_id: 'ord-101', order_code: 'ARS-2410-101', status: 'SCHEDULED',
    service_date: wibDay(1), start_at: at(1, '04:30'), end_at: at(1, '09:00'),
    pickup_location: 'Perumahan Bogor Nirwana Residence, Jl. Bukit Nirwana Blok C3 No. 8, Bogor',
    dropoff_location: 'Bandara Soekarno-Hatta Terminal 3 (Keberangkatan Internasional)',
    service_kind: 'Antar bandara', service_package: 'DROP', passenger_count: 3,
    notes: 'Bawa 3 koper besar. Pelanggan minta jemput tepat waktu, penerbangan 08.40.',
    customer: { name: 'Ibu Siti Rahmawati', phone: '081311112222' },
    car: { plate_number: 'F 1789 KB', model: 'Toyota Avanza Veloz' },
  }),
  trip({
    id: 'line-jkt-bdg', order_id: 'ord-099', order_code: 'ARS-2410-099', status: 'ASSIGNED',
    accepted_at: at(-1, '19:12'),
    service_date: wibDay(0), start_at: at(0, '08:00'), end_at: at(0, '20:00'),
    pickup_location: 'Hotel Indonesia Kempinski, Jl. M.H. Thamrin No. 1, Jakarta Pusat',
    dropoff_location: 'Gedung Sate, Jl. Diponegoro No. 22, Bandung',
    service_kind: 'Sewa mobil + driver', service_package: '12H', passenger_count: 4,
    order_notes: 'Mampir makan siang di Rest Area KM 72. Tol dan parkir ditanggung pelanggan (reimburse).',
    customer: { name: 'Bapak Andi Wijaya', phone: '081298765432' },
    other_customers: [{ name: 'Rina (sekretaris)', phone: '085711223344' }],
    car: { plate_number: 'B 1234 ABC', model: 'Toyota Innova Reborn' },
  }),
  trip({
    id: 'line-3hari-jogja', order_id: 'ord-095', order_code: 'ARS-2409-095', status: 'ASSIGNED',
    accepted_at: at(-2, '10:00'),
    service_date: wibDay(2), start_at: at(2, '06:00'), end_at: at(4, '18:00'),
    pickup_location: 'Jl. Kemang Raya No. 45, Jakarta Selatan',
    dropoff_location: 'Malioboro, Yogyakarta (keliling Jogja 3 hari)',
    service_kind: 'Sewa mobil + driver', service_package: 'ALL-IN', passenger_count: 6,
    notes: 'Paket ALL-IN: BBM, tol, parkir, dan makan driver ditanggung kantor. Simpan semua struk.',
    customer: { name: 'Keluarga Hartono', phone: '+62 813-5555-0101' },
    car: { plate_number: 'B 2468 TJA', model: 'Toyota Hiace Premio' },
  }),
  trip({
    id: 'line-done-cibubur', order_id: 'ord-090', order_code: 'ARS-2409-090', status: 'DONE',
    accepted_at: at(-1, '05:00'), actual_start_at: at(-1, '06:05'), actual_pickup_at: at(-1, '06:50'),
    trip_finished_at: at(-1, '17:40'),
    service_date: wibDay(-1), start_at: at(-1, '07:00'), end_at: at(-1, '17:00'),
    pickup_location: 'Cibubur Junction, Jakarta Timur',
    dropoff_location: 'Kebun Raya Bogor',
    service_kind: 'Sewa mobil + driver', service_package: '10H', passenger_count: 5,
    customer: { name: 'Ibu Dewi Lestari', phone: '087788990011' },
    car: { plate_number: 'B 1234 ABC', model: 'Toyota Innova Reborn' },
  }),
];

// `is_system` rows (START / ARRIVE_CUSTOMER / FINISH) are written by the server itself when a trip
// is started, arrived at or finished; they are not driver reports and are not counted.
const sys = (type, created_at) => ({ id: randomUUID(), report_type: type, notes: null, file_url: null, amount: null, created_at, is_system: true });
const reports = {
  'line-done-cibubur': [
    sys('START', at(-1, '06:05')),
    { id: randomUUID(), report_type: 'ODOMETER_START', notes: null, file_url: null, amount: 45210, created_at: at(-1, '06:00'), is_system: false },
    sys('ARRIVE_CUSTOMER', at(-1, '06:50')),
    { id: randomUUID(), report_type: 'TOLL', notes: 'Tol Jagorawi', file_url: null, amount: 24500, created_at: at(-1, '07:30'), is_system: false },
    { id: randomUUID(), report_type: 'ODOMETER_END', notes: 'Bensin sisa 1/2', file_url: null, amount: 45318, created_at: at(-1, '17:35'), is_system: false },
    sys('FINISH', at(-1, '17:40')),
  ],
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
function addSystemRow(tripId, type, created_at) {
  const list = (reports[tripId] ||= []);
  if (!list.some((r) => r.is_system && r.report_type === type)) list.push(sys(type, created_at));
}
const clientRefs = new Map(); // client_ref -> report
const files = new Map(); // name -> Buffer
const devices = new Set();

// ---- helpers ----
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};
function send(res, status, body) {
  if (status === 204) {
    res.writeHead(204, cors);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify(body));
}
const ok = (res, data, status = 200) => send(res, status, { status: 'success', data });
const fail = (res, status, message) => send(res, status, { status: 'error', message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: {} };
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const fields = {}, fileParts = {};
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // strip leading CRLF and trailing CRLF
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString();
    const content = part.slice(sep + 4);
    const name = /name="([^"]+)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (name) {
      if (filename !== undefined) fileParts[name] = { filename, type, data: content };
      else fields[name] = content.toString();
    }
    pos = next;
  }
  return { fields, files: fileParts };
}

const isAccepted = (t) => !!t.accepted_at || ['ASSIGNED', 'IN_PROGRESS', 'DONE'].includes(t.status);
const sortKey = (t) => t.start_at || t.service_date || '';
const withCount = (t) => ({ ...t, report_count: (reports[t.id] || []).filter((r) => !r.is_system).length });
const expensesOf = (id) =>
  (reports[id] || [])
    .filter((r) => r.amount != null && ['FUEL', 'TOLL', 'PARKING', 'OTHER_COST'].includes(r.report_type))
    .map((r) => ({
      id: r.id,
      type: r.report_type === 'OTHER_COST' ? 'OTHER' : r.report_type,
      amount: r.amount,
      note: r.notes,
      created_at: r.created_at,
    }));

function auth(req) {
  const h = req.headers.authorization || '';
  if (h === `Bearer ${DRIVER_TOKEN}`) return 'DRIVER';
  if (h === `Bearer ${ADMIN_TOKEN}`) return 'ADMIN';
  return null;
}

// ---- server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const now = new Date().toISOString();
  if (req.method === 'OPTIONS') return send(res, 204);
  console.log(new Date().toISOString().slice(11, 19), req.method, path + url.search);

  try {
    if (req.method === 'GET' && path.startsWith('/uploads/')) {
      const f = files.get(path.slice('/uploads/'.length));
      if (!f) return fail(res, 404, 'File tidak ditemukan');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', ...cors });
      return res.end(f);
    }
    if (!path.startsWith(BASE)) return fail(res, 404, 'Not found');
    const p = path.slice(BASE.length);

    if (req.method === 'POST' && p === '/auth/login') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const id = String(body.identifier || '').trim().replace(/\s|-/g, '');
      if ((id === '0812345678' || id === '+62812345678') && body.password === 'test1234') {
        return ok(res, { token: DRIVER_TOKEN, user: { id: 'usr-driver-1', email: 'budi@arasya.id', role: 'DRIVER' } });
      }
      if (id === 'admin@arasya.id' && body.password === 'admin123') {
        return ok(res, { token: ADMIN_TOKEN, user: { id: 'usr-admin-1', email: 'admin@arasya.id', role: 'ADMIN' } });
      }
      return fail(res, 401, 'Nomor HP/email atau kata sandi salah');
    }

    const role = auth(req);
    if (!role) return fail(res, 401, 'Sesi tidak valid');

    if (p === '/devices') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (req.method === 'POST') devices.add(body.token);
      if (req.method === 'DELETE') devices.delete(body.token);
      return send(res, 204);
    }

    if (!p.startsWith('/driver')) return fail(res, 404, 'Not found');
    if (role !== 'DRIVER') return fail(res, 403, 'Khusus driver');

    if (req.method === 'GET' && p === '/driver/me') return ok(res, driver);

    if (req.method === 'GET' && p === '/driver/trips') {
      const scope = url.searchParams.get('scope') || 'active';
      const list =
        scope === 'history'
          ? trips.filter((t) => t.status === 'DONE').sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
          : trips.filter((t) => !['DONE', 'CANCELLED'].includes(t.status)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return ok(res, list.map(withCount));
    }

    const m = /^\/driver\/trips\/([^/]+)(?:\/(accept|start|arrive|finish|reports))?$/.exec(p);
    if (!m) return fail(res, 404, 'Not found');
    const t = trips.find((x) => x.id === decodeURIComponent(m[1]));
    if (!t) return fail(res, 404, 'Tugas tidak ditemukan');
    const action = m[2];

    if (req.method === 'GET' && !action) {
      return ok(res, { ...withCount(t), reports: reports[t.id] || [], expenses: expensesOf(t.id) });
    }
    if (req.method !== 'POST' || !action) return fail(res, 405, 'Method not allowed');

    if (action === 'reports') {
      if (t.status === 'CANCELLED') return fail(res, 409, 'Tugas sudah dibatalkan');
      const { fields, files: fileParts } = parseMultipart(await readBody(req), req.headers['content-type']);
      const types = ['ODOMETER_START', 'ODOMETER_END', 'FUEL', 'TOLL', 'PARKING', 'OTHER_COST', 'PHOTO', 'NOTE'];
      if (!types.includes(fields.report_type)) return fail(res, 400, 'report_type tidak valid');
      if (fields.client_ref && !UUID_RE.test(fields.client_ref)) return fail(res, 400, 'client_ref harus UUID');
      if (fields.occurred_at && Number.isNaN(Date.parse(fields.occurred_at))) return fail(res, 400, 'occurred_at tidak valid');
      if ((fileParts.photo?.data?.length || 0) > MAX_PHOTO_BYTES) return fail(res, 413, 'Ukuran foto maksimal 10 MB');
      if (fields.client_ref && clientRefs.has(fields.client_ref)) return ok(res, clientRefs.get(fields.client_ref));
      let file_url = null;
      if (fileParts.photo?.data?.length) {
        const name = `${randomUUID()}.jpg`;
        files.set(name, fileParts.photo.data);
        file_url = `http://${req.headers.host}/uploads/${name}`;
      }
      const amount = fields.amount ? parseInt(fields.amount, 10) : null;
      if (amount != null && (!Number.isInteger(amount) || amount < 0)) return fail(res, 400, 'amount tidak valid');
      // ODOMETER_* carry the odometer reading (km) in `amount`; cost types carry rupiah. Optional.
      const report = { id: randomUUID(), report_type: fields.report_type, notes: fields.notes || null, file_url, amount, created_at: fields.occurred_at || now, is_system: false };
      (reports[t.id] ||= []).push(report);
      if (fields.client_ref) clientRefs.set(fields.client_ref, report);
      return ok(res, report);
    }

    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (body.occurred_at && Number.isNaN(Date.parse(body.occurred_at))) return fail(res, 400, 'occurred_at tidak valid');
    if (body.client_ref && !UUID_RE.test(body.client_ref)) return fail(res, 400, 'client_ref harus UUID');
    // Same as the real API: the phone's time of the tap (queued offline) wins.
    const at = body.occurred_at || now;
    if (action === 'accept') {
      if (t.status === 'CANCELLED') return fail(res, 409, 'Tugas sudah dibatalkan');
      t.accepted_at ||= at;
    } else if (action === 'start') {
      if (['DONE', 'CANCELLED'].includes(t.status)) return fail(res, 409, 'Tugas sudah selesai/dibatalkan');
      if (t.status !== 'IN_PROGRESS') {
        t.accepted_at ||= at;
        t.status = 'IN_PROGRESS';
        t.actual_start_at ||= at;
        addSystemRow(t.id, 'START', at);
      }
    } else if (action === 'arrive') {
      if (['DONE', 'CANCELLED'].includes(t.status)) return fail(res, 409, 'Tugas sudah selesai/dibatalkan');
      t.actual_pickup_at ||= at;
      addSystemRow(t.id, 'ARRIVE_CUSTOMER', at);
    } else if (action === 'finish') {
      if (t.status === 'CANCELLED') return fail(res, 409, 'Tugas sudah dibatalkan');
      if (t.status !== 'DONE') {
        t.accepted_at ||= at;
        t.status = 'DONE';
        t.trip_finished_at = at;
        addSystemRow(t.id, 'FINISH', at);
        if (body.notes) t.notes = [t.notes, `Catatan driver: ${body.notes}`].filter(Boolean).join('\n');
      }
    }
    return ok(res, withCount(t));
  } catch (e) {
    console.error(e);
    return fail(res, 500, 'Kesalahan server mock');
  }
});

server.listen(PORT, () => {
  console.log(`Mock Arasya API on http://localhost:${PORT}${BASE}`);
  console.log(`Driver login: 0812345678 / test1234 (accepted: ${trips.filter(isAccepted).length} trips)`);
});
