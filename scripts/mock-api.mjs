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

// etoll_card: what the office recorded (admin driver form); shown on the profile's top-up request.
const driver = {
  id: 'drv-1', name: 'Budi Santoso', phone: '0812345678', status: 'ON_DUTY', type: 'INTERNAL',
  etoll_card: 'Mandiri e-Money 6032 ••••1234',
};

// Trips are stored like the API's service-day lines: `driver_accepted_at` is set only by "Terima tugas"
// (or the first step); ASSIGNED just means the day has a driver. Sent to the app as `accepted_at`.
function trip(t) {
  return {
    order_code: null, status: 'ASSIGNED', driver_accepted_at: null, service_kind: null, service_package: null,
    notes: null, order_notes: null, passenger_count: null, other_customers: [], car: null,
    actual_start_at: null, actual_pickup_at: null, customer_onboard_at: null, trip_finished_at: null,
    payment_ready: true, ...t,
  };
}

const trips = [
  trip({
    // Assigned by the office but not accepted yet: the app shows "Terima tugas".
    id: 'line-new-bandara', order_id: 'ord-101', order_code: 'ARS-2410-101', status: 'ASSIGNED',
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
    driver_accepted_at: at(-1, '19:12'),
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
    driver_accepted_at: at(-2, '10:00'),
    service_date: wibDay(2), start_at: at(2, '06:00'), end_at: at(4, '18:00'),
    pickup_location: 'Jl. Kemang Raya No. 45, Jakarta Selatan',
    dropoff_location: 'Malioboro, Yogyakarta (keliling Jogja 3 hari)',
    service_kind: 'Sewa mobil + driver', service_package: 'ALL-IN', passenger_count: 6,
    notes: 'Paket ALL-IN: BBM, tol, parkir, dan makan driver ditanggung kantor. Simpan semua struk.',
    // Only the DP is paid: the driver may drive there, "Mulai perjalanan" waits for full payment.
    payment_ready: false,
    customer: { name: 'Keluarga Hartono', phone: '+62 813-5555-0101' },
    car: { plate_number: 'B 2468 TJA', model: 'Toyota Hiace Premio' },
  }),
  trip({
    id: 'line-done-cibubur', order_id: 'ord-090', order_code: 'ARS-2409-090', status: 'DONE',
    driver_accepted_at: at(-1, '05:00'), actual_start_at: at(-1, '06:05'), actual_pickup_at: at(-1, '06:50'),
    customer_onboard_at: at(-1, '07:00'),
    trip_finished_at: at(-1, '17:40'),
    service_date: wibDay(-1), start_at: at(-1, '07:00'), end_at: at(-1, '17:00'),
    pickup_location: 'Cibubur Junction, Jakarta Timur',
    dropoff_location: 'Kebun Raya Bogor',
    service_kind: 'Sewa mobil + driver', service_package: '10H', passenger_count: 5,
    customer: { name: 'Ibu Dewi Lestari', phone: '087788990011' },
    car: { plate_number: 'B 1234 ABC', model: 'Toyota Innova Reborn' },
  }),
];

// `is_system` rows (START / ARRIVE_CUSTOMER / ONBOARD / FINISH) are written by the server itself when a trip
// is started, arrived at or finished; they are not driver reports and are not counted.
const sys = (type, created_at) => ({ id: randomUUID(), report_type: type, notes: null, file_url: null, amount: null, created_at, is_system: true });
const reports = {
  'line-done-cibubur': [
    sys('START', at(-1, '06:05')),
    { id: randomUUID(), report_type: 'ODOMETER_START', notes: null, file_url: null, amount: 45210, created_at: at(-1, '06:00'), is_system: false },
    sys('ARRIVE_CUSTOMER', at(-1, '06:50')),
    { id: randomUUID(), report_type: 'TOLL', notes: 'Tol Jagorawi', file_url: null, amount: 24500, created_at: at(-1, '07:30'), is_system: false, expense_status: 'APPROVED' },
    { id: randomUUID(), report_type: 'PARKING', notes: 'Parkir Kebun Raya', file_url: null, amount: 15000, created_at: at(-1, '09:10'), is_system: false, expense_status: 'REJECTED', review_note: 'Struk tidak terbaca' },
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
const UNPAID =
  'Order belum lunas. Perjalanan dengan pelanggan baru bisa dimulai setelah pelunasan tercatat (invoice ditandai terbayar). Hubungi admin.';
const REPORT_TYPES = ['ODOMETER_START', 'ODOMETER_END', 'FUEL', 'TOLL', 'PARKING', 'OTHER_COST', 'PHOTO', 'NOTE', 'ARRIVAL_PHOTO'];

// Inbox (GET /driver/notifications): every push the server sends is also stored there.
const notifications = [
  {
    id: randomUUID(), type: 'payable_paid', title: 'Fee sudah dibayar', read: false, created_at: at(0, '09:15'),
    body: `Rp 474.500 (transfer) untuk trip kemarin · ARS-2409-090.`,
    data: { type: 'payable_paid', total: 474500, items: [{ order_code: 'ARS-2409-090', service_date: wibDay(-1), fee: 250000, reimburse: 24500, advance: 0, extras: 200000, total: 474500 }] },
  },
  {
    id: randomUUID(), type: 'expense_rejected', title: 'Biaya ditolak', read: false, created_at: at(0, '08:40'),
    body: 'Parkir Rp 15.000 · trip kemarin: Struk tidak terbaca', data: { type: 'expense_rejected', line_id: 'line-done-cibubur' },
  },
  {
    id: randomUUID(), type: 'order_paid', title: 'Order ARS-2410-099 sudah lunas', read: true, created_at: at(-1, '20:05'),
    body: 'Perjalanan bisa dimulai saat pelanggan naik: hari ini 08.00 · Hotel Indonesia Kempinski', data: { type: 'order_paid', line_id: 'line-jkt-bdg' },
  },
  {
    id: randomUUID(), type: 'trip_assigned', title: 'Tugas baru', read: true, created_at: at(-1, '19:00'),
    body: 'Besok 04.30 · Bogor Nirwana Residence → Bandara Soekarno-Hatta', data: { type: 'trip_assigned', line_id: 'line-new-bandara' },
  },
];
// Location fields of arrive and of reports (arrival and checkpoint photos). `location_name` is the
// place name the phone looked up (stored and returned with the coordinates).
const location = (f) =>
  f.latitude != null && f.latitude !== '' && f.longitude != null && f.longitude !== ''
    ? {
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        location_accuracy_m: f.location_accuracy_m != null && f.location_accuracy_m !== '' ? Math.round(Number(f.location_accuracy_m)) : null,
        location_at: f.location_at || null,
        location_mocked: f.location_mocked === true || f.location_mocked === 'true' ? true : f.location_mocked != null ? false : null,
        location_name: typeof f.location_name === 'string' && f.location_name.trim() ? f.location_name.trim() : null,
      }
    : {};
/** Same checks as the API's location fields: both coordinates or none, name at most 200 characters. */
function locationError(f) {
  const lat = f.latitude != null && f.latitude !== '';
  const lng = f.longitude != null && f.longitude !== '';
  if (lat !== lng) return 'latitude and longitude go together';
  if (lat && (!Number.isFinite(Number(f.latitude)) || Math.abs(Number(f.latitude)) > 90)) return 'latitude tidak valid';
  if (lng && (!Number.isFinite(Number(f.longitude)) || Math.abs(Number(f.longitude)) > 180)) return 'longitude tidak valid';
  if (f.location_name != null && String(f.location_name).length > 200) return 'location_name maksimal 200 karakter';
  return null;
}

// Driver requests (POST /driver/requests): e-toll top-up. One OPEN request per type; client_ref makes
// a resend return the same request.
const requests = [];
const requestRefs = new Map(); // client_ref -> request
const REQUEST_TYPES = ['ETOLL_TOPUP'];
// Same fields as the API's toRequest (balance is a number there).
const publicRequest = (r) => ({ ...r });
const files = new Map(); // name -> Buffer
const devices = new Set();

// ---- helpers ----
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
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

const isAccepted = (t) => !!t.driver_accepted_at;
const sortKey = (t) => t.start_at || t.service_date || '';
// Like the API's toTrip: the line's driver_accepted_at goes out as `accepted_at`.
const withCount = ({ driver_accepted_at, ...t }) => ({
  ...t,
  accepted_at: driver_accepted_at,
  report_count: (reports[t.id] || []).filter((r) => !r.is_system).length,
});
const expensesOf = (id) =>
  (reports[id] || [])
    .filter((r) => r.amount != null && ['FUEL', 'TOLL', 'PARKING', 'OTHER_COST'].includes(r.report_type))
    .map((r) => ({
      id: r.id,
      type: r.report_type === 'OTHER_COST' ? 'OTHER' : r.report_type,
      amount: r.amount,
      note: r.notes,
      // Every cost waits for the office to check the receipt.
      status: r.expense_status || 'PENDING',
      review_note: r.review_note || null,
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

    if (req.method === 'GET' && p === '/driver/requests') {
      // Like the API: case-insensitive, default `all`.
      const status = (url.searchParams.get('status') || 'all').toLowerCase();
      if (!['open', 'all'].includes(status)) return fail(res, 400, 'status harus open atau all');
      const list = requests
        .filter((r) => status === 'all' || r.status === 'OPEN')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20);
      return ok(res, { items: list.map(publicRequest) });
    }
    if (req.method === 'POST' && p === '/driver/requests') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!REQUEST_TYPES.includes(body.type)) return fail(res, 400, 'type tidak valid');
      if (!body.client_ref || !UUID_RE.test(body.client_ref)) return fail(res, 400, 'client_ref harus UUID');
      if (body.occurred_at && Number.isNaN(Date.parse(body.occurred_at))) return fail(res, 400, 'occurred_at tidak valid');
      if (body.card_label != null && String(body.card_label).length > 60) return fail(res, 400, 'card_label maksimal 60 karakter');
      if (body.note != null && String(body.note).length > 500) return fail(res, 400, 'note terlalu panjang');
      const balanceSent = body.balance != null && body.balance !== '';
      if (balanceSent && !(Number(body.balance) >= 0 && Number(body.balance) <= 100_000_000))
        return fail(res, 400, 'balance tidak valid');
      const again = requestRefs.get(body.client_ref);
      if (again) return ok(res, { request: publicRequest(again) });
      const open = requests.find((r) => r.type === body.type && r.status === 'OPEN');
      if (open) return ok(res, { request: publicRequest(open), already_open: true });
      const r = {
        id: randomUUID(), driver_id: driver.id, type: body.type,
        card_label: body.card_label?.trim() || driver.etoll_card || null,
        balance: balanceSent ? Math.round(Number(body.balance)) : null,
        note: body.note?.trim() || null, status: 'OPEN', client_ref: body.client_ref,
        created_at: body.occurred_at || now, handled_at: null, handled_by: null, handled_note: null,
      };
      requests.push(r);
      requestRefs.set(r.client_ref, r);
      console.log(`  admin notification: ${driver.name} minta top-up e-toll · Kartu ${r.card_label ?? '-'}`);
      return ok(res, { request: publicRequest(r) }, 201);
    }
    // Test helper: the admin marks the request done → push + inbox "Top-up e-toll sudah diproses".
    const handled = /^\/driver\/__mock\/requests\/([^/]+)\/done$/.exec(p);
    if (req.method === 'POST' && handled) {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const r = requests.find((x) => x.id === handled[1]);
      if (!r) return fail(res, 404, 'Permintaan tidak ditemukan');
      if (r.status !== 'OPEN') return fail(res, 409, 'Permintaan sudah diproses');
      Object.assign(r, { status: 'DONE', handled_at: now, handled_by: 'usr-admin-1', handled_note: body.note?.trim() || null });
      // Same push/inbox text and data as the API's markRequestDone.
      const card = r.card_label ? `Kartu ${r.card_label.replace(/^kartu\s+/i, '')}` : 'Saldo e-toll';
      notifications.push({
        id: randomUUID(), type: 'driver_request_done', title: 'Top-up e-toll sudah diproses', read: false, created_at: now,
        body: r.handled_note ? `${card}. ${r.handled_note}` : `${card} sudah diisi. Cek saldonya sebelum jalan.`,
        data: { type: 'driver_request_done', request_id: r.id, request_type: r.type },
      });
      return ok(res, { request: publicRequest(r) });
    }

    if (req.method === 'GET' && p === '/driver/notifications') {
      const list = [...notifications].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return ok(res, { unread: list.filter((n) => !n.read).length, items: list });
    }
    if (req.method === 'POST' && p === '/driver/notifications/read') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (!body.all && !(Array.isArray(body.ids) && body.ids.length)) return fail(res, 400, 'ids or all is required');
      let updated = 0;
      for (const n of notifications) {
        if (!n.read && (body.all || body.ids.includes(n.id))) {
          n.read = true;
          updated++;
        }
      }
      return ok(res, { updated, unread: notifications.filter((n) => !n.read).length });
    }
    // Test helper: the admin records the settlement → "Mulai perjalanan" unlocks and a notification arrives.
    const paid = /^\/driver\/__mock\/pay\/([^/]+)$/.exec(p);
    if (req.method === 'POST' && paid) {
      const t = trips.find((x) => x.id === paid[1]);
      if (!t) return fail(res, 404, 'Tugas tidak ditemukan');
      t.payment_ready = true;
      notifications.push({
        id: randomUUID(), type: 'order_paid', title: `Order ${t.order_code} sudah lunas`, read: false, created_at: now,
        body: `Perjalanan bisa dimulai saat pelanggan naik · ${t.pickup_location}`, data: { type: 'order_paid', line_id: t.id },
      });
      return ok(res, withCount(t));
    }

    if (req.method === 'GET' && p === '/driver/trips') {
      const scope = url.searchParams.get('scope') || 'active';
      const list =
        scope === 'history'
          ? trips.filter((t) => t.status === 'DONE').sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
          : trips.filter((t) => !['DONE', 'CANCELLED'].includes(t.status)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return ok(res, list.map(withCount));
    }

    const m = /^\/driver\/trips\/([^/]+)(?:\/(accept|start|arrive|board|finish|reports))?$/.exec(p);
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
      if (!REPORT_TYPES.includes(fields.report_type)) return fail(res, 400, 'report_type tidak valid');
      if (fields.client_ref && !UUID_RE.test(fields.client_ref)) return fail(res, 400, 'client_ref harus UUID');
      if (fields.occurred_at && Number.isNaN(Date.parse(fields.occurred_at))) return fail(res, 400, 'occurred_at tidak valid');
      if ((fileParts.photo?.data?.length || 0) > MAX_PHOTO_BYTES) return fail(res, 413, 'Ukuran foto maksimal 10 MB');
      const locErr = locationError(fields);
      if (locErr) return fail(res, 400, locErr);
      if (fields.client_ref && clientRefs.has(fields.client_ref)) return ok(res, clientRefs.get(fields.client_ref));
      const hasPhoto = !!fileParts.photo?.data?.length;
      // Same rules as the real API: odometer start once, then end once and not lower.
      if (fields.report_type.startsWith('ODOMETER')) {
        if (!hasPhoto || !fields.amount) return fail(res, 400, 'Foto odometer perlu foto dan angka kilometer.');
        const list = reports[t.id] || [];
        const start = list.find((r) => r.report_type === 'ODOMETER_START');
        if (fields.report_type === 'ODOMETER_START' && start) return fail(res, 409, 'Foto odometer awal sudah terkirim untuk tugas ini.');
        if (fields.report_type === 'ODOMETER_END') {
          if (!start) return fail(res, 409, 'Kirim foto odometer awal dulu, baru odometer akhir.');
          if (list.some((r) => r.report_type === 'ODOMETER_END')) return fail(res, 409, 'Foto odometer akhir sudah terkirim untuk tugas ini.');
          if (start.amount != null && Number(fields.amount) < start.amount)
            return fail(res, 409, `Angka odometer akhir (${fields.amount} km) lebih kecil dari odometer awal (${start.amount} km).`);
        }
      }
      if (fields.report_type === 'ARRIVAL_PHOTO' && (!hasPhoto || !fields.latitude))
        return fail(res, 400, 'Foto sampai lokasi perlu foto dan lokasi GPS.');
      let file_url = null;
      if (fileParts.photo?.data?.length) {
        const name = `${randomUUID()}.jpg`;
        files.set(name, fileParts.photo.data);
        file_url = `http://${req.headers.host}/uploads/${name}`;
      }
      const amount = fields.amount ? parseInt(fields.amount, 10) : null;
      if (amount != null && (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000)) return fail(res, 400, 'amount tidak valid');
      // ODOMETER_* carry the odometer reading (km) in `amount`; cost types carry rupiah. Optional.
      // `stamped`: the phone's GPS camera already printed time/driver/GPS on the photo (not returned).
      const report = { id: randomUUID(), report_type: fields.report_type, notes: fields.notes || null, file_url, amount, created_at: fields.occurred_at || now, is_system: false, ...location(fields) };
      if (fields.stamped === 'true') console.log(`  ${fields.report_type} stamped on the phone${fields.location_name ? ` · ${fields.location_name}` : ''}`);
      (reports[t.id] ||= []).push(report);
      if (fields.client_ref) clientRefs.set(fields.client_ref, report);
      return ok(res, report);
    }

    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (body.occurred_at && Number.isNaN(Date.parse(body.occurred_at))) return fail(res, 400, 'occurred_at tidak valid');
    if (body.client_ref && !UUID_RE.test(body.client_ref)) return fail(res, 400, 'client_ref harus UUID');
    const actionLocErr = locationError(body);
    if (actionLocErr) return fail(res, 400, actionLocErr);
    // Same as the real API: the phone's time of the tap (queued offline) wins.
    const at = body.occurred_at || now;
    if (action === 'accept') {
      if (t.status === 'CANCELLED') return fail(res, 409, 'Tugas sudah dibatalkan');
      t.driver_accepted_at ||= at;
    } else if (action === 'start') {
      if (['DONE', 'CANCELLED'].includes(t.status)) return fail(res, 409, 'Tugas sudah selesai/dibatalkan');
      if (t.status !== 'IN_PROGRESS') {
        t.driver_accepted_at ||= at;
        t.status = 'IN_PROGRESS';
        t.actual_start_at ||= at;
        addSystemRow(t.id, 'START', at);
      }
    } else if (action === 'arrive') {
      if (['DONE', 'CANCELLED'].includes(t.status)) return fail(res, 409, 'Tugas sudah selesai/dibatalkan');
      t.driver_accepted_at ||= at;
      t.actual_pickup_at ||= at;
      addSystemRow(t.id, 'ARRIVE_CUSTOMER', at);
      Object.assign(reports[t.id].find((r) => r.report_type === 'ARRIVE_CUSTOMER'), location(body));
    } else if (action === 'board') {
      // Same rule as the real API: the trip with the customer begins only when paid in full.
      if (['DONE', 'CANCELLED'].includes(t.status)) return fail(res, 409, 'Tugas sudah selesai/dibatalkan');
      if (!t.customer_onboard_at && t.payment_ready === false && !clientRefs.has(body.client_ref))
        return fail(res, 409, UNPAID);
      if (!t.customer_onboard_at) {
        t.driver_accepted_at ||= at;
        t.customer_onboard_at = at;
        t.actual_start_at ||= at;
        t.status = 'IN_PROGRESS';
        addSystemRow(t.id, 'ONBOARD', at);
        if (body.client_ref) clientRefs.set(body.client_ref, true);
      }
    } else if (action === 'finish') {
      if (t.status === 'CANCELLED') return fail(res, 409, 'Tugas sudah dibatalkan');
      if (t.status !== 'DONE' && !t.customer_onboard_at && t.payment_ready === false) return fail(res, 409, UNPAID);
      if (t.status !== 'DONE') {
        t.driver_accepted_at ||= at;
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
  console.log(`Driver login: 0812345678 / test1234 (accepted: ${trips.filter(isAccepted).length} of ${trips.length} trips)`);
  console.log('Helpers: POST /api/v1/driver/__mock/pay/<line id> · POST /api/v1/driver/__mock/requests/<request id>/done');
});
