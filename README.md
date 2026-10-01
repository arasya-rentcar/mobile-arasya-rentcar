# Arasya Driver

Aplikasi Android untuk driver **Arasya Rent Car**, pengganti bot WhatsApp. Driver menerima tugas lewat notifikasi, melihat detail perjalanan, menekan **Terima tugas → Berangkat → Sampai di lokasi jemput → Selesai**, dan mengirim laporan (foto odometer, struk bensin/tol/parkir/biaya lain, foto & catatan).

Semua yang dikirim driver masuk **antrean offline** dulu: kalau sinyal hilang, data disimpan di HP dan dikirim otomatis (berurutan, dengan jeda percobaan ulang) saat sinyal kembali. Laporan memakai `client_ref` (UUID), jadi pengiriman ulang tidak pernah membuat laporan ganda.

Dibuat dengan Expo (React Native) + TypeScript + expo-router.

## Menjalankan untuk pengembangan

```bash
npm install
npx expo start            # scan QR dengan development build, atau tekan "w" untuk versi web
```

Alamat API diatur lewat variabel lingkungan (default `https://api.haikuy.com/api/v1`):

```bash
EXPO_PUBLIC_API_URL=https://api.haikuy.com/api/v1 npx expo start
```

### API tiruan (mock) untuk mencoba tanpa backend

```bash
npm run mock-api                                               # http://localhost:4010/api/v1
EXPO_PUBLIC_API_URL=http://localhost:4010/api/v1 npx expo start --web
```

Login driver: `0812345678` / `test1234`. Login admin (untuk melihat layar "khusus driver"): `admin@arasya.id` / `admin123`. Data contoh: tugas baru besok (Bogor → Bandara Soekarno-Hatta), tugas hari ini yang sudah diterima (Jakarta → Bandung, Innova Reborn B 1234 ABC), tugas 3 hari ke Yogyakarta, dan satu tugas selesai di Riwayat.

Pemeriksaan: `npx tsc --noEmit` dan `npx expo export --platform android`.


## Offline & sinkronisasi

- Semua aksi (Terima, Berangkat, Sampai jemput, Selesai) dan laporan masuk antrean di HP dulu, layar langsung berubah, lalu dikirim berurutan begitu ada sinyal (coba ulang 5 dtk → 5 mnt).
- Saat aplikasi ditutup, Android mengirim antrean di latar belakang kira-kira tiap 15 menit bila ada koneksi (`expo-background-task`).
- Setiap item membawa `client_ref` (id unik) dan `occurred_at` (jam ditekan). Server mencatat jam asli kejadian dan mengabaikan kiriman ganda, jadi tidak ada yang tercatat dua kali walau terkirim ulang dari aplikasi dan dari latar belakang sekaligus.

## Membuat APK (gratis)

1. Buat akun gratis di <https://expo.dev> lalu login: `npx eas-cli@latest login`.
2. Sekali saja, hubungkan proyek: `npx eas-cli@latest init`. Perintah ini menulis `extra.eas.projectId` ke `app.json`. **Commit perubahan itu**, karena notifikasi push butuh projectId tersebut.
3. Build APK untuk dipasang langsung di HP driver:
   ```bash
   npx eas-cli@latest build -p android --profile preview
   ```
   Setelah selesai, EAS memberi link/QR untuk mengunduh APK.

Profil di `eas.json`:
- `development`: development client (APK) untuk debugging
- `preview`: APK, distribusi internal (untuk dibagikan ke driver)
- `production`: app bundle (`.aab`) untuk Google Play

### Lewat GitHub Actions

Workflow manual `.github/workflows/eas-build.yml` (tab **Actions → EAS Build (Android) → Run workflow**, pilih profil; default `preview`). Isi dulu secret repository **`EXPO_TOKEN`**: di expo.dev buka *Account settings → Access tokens → Create token*, lalu di GitHub *Settings → Secrets and variables → Actions → New repository secret*. Workflow hanya memulai build (`--no-wait`); hasilnya dilihat di dashboard expo.dev.

## Notifikasi push (Firebase)

Android mengirim push lewat Firebase Cloud Messaging (FCM). Langkahnya:

1. Buat proyek di <https://console.firebase.google.com>, tambahkan aplikasi Android dengan package **`com.arasyarentcar.driver`**.
2. Unduh **`google-services.json`**, taruh di root repo ini, lalu tambahkan ke `app.json`: `"android": { "googleServicesFile": "./google-services.json", ... }`.
3. Di Firebase: *Project settings → Service accounts → Generate new private key* (JSON).
4. Unggah kunci itu ke EAS: `npx eas-cli@latest credentials` → Android → production/preview → *Google Service Account* → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → upload file JSON tadi.
5. Build ulang APK.

Setelah login di HP asli, aplikasi meminta izin notifikasi, mengambil Expo push token (`ExponentPushToken[...]`), dan mendaftarkannya ke `POST /devices`. Saat logout token dihapus (`DELETE /devices`). Notifikasi masuk ke channel Android **`trips`** (prioritas tinggi). Ketuk notifikasi → aplikasi membuka tugas terkait (juga saat aplikasi masih tertutup). Di web dan emulator tanpa Google Play, push dilewati.

## Ringkasan kontrak API

Semua respons `{ "status": "success", "data": ... }`, error `{ "status": "error", "message": "..." }`. Header `Authorization: Bearer <token>`; 401 → token dihapus, kembali ke login.

| Method | Path | Keterangan |
| --- | --- | --- |
| POST | `/auth/login` | `{ identifier, password }` → `{ token, user: { id, email, role } }` |
| GET | `/driver/me` | profil driver |
| GET | `/driver/trips?scope=active\|history` | daftar tugas aktif (naik per tanggal) / riwayat (terbaru dulu) |
| GET | `/driver/trips/:id` | detail + `reports` + `expenses` |
| POST | `/driver/trips/:id/accept` | terima tugas (`accepted_at`) |
| POST | `/driver/trips/:id/start` | berangkat dari garasi (`IN_PROGRESS`, `actual_start_at`) |
| POST | `/driver/trips/:id/arrive` | sampai di lokasi jemput (`actual_pickup_at`) |
| POST | `/driver/trips/:id/finish` | `{ notes? }` → `DONE`, `trip_finished_at` |
| POST | `/driver/trips/:id/reports` | multipart: `report_type`, `client_ref`, `notes?`, `amount?`, `photo?` (JPEG) |
| POST / DELETE | `/devices` | `{ token, platform }` / `{ token }` |

`amount` berarti rupiah untuk FUEL/TOLL/PARKING/OTHER_COST dan **angka odometer (km)** untuk ODOMETER_START/ODOMETER_END. Semua aksi bersifat idempoten. 404 pada endpoint tugas = tugas sudah tidak ditugaskan ke driver ini: aplikasi menghapusnya dari layar beserta antreannya dan memberi tahu driver. Push `data`: `{ type: "trip_assigned" | "trip_reminder" | "trip_updated", line_id }`.

## Struktur

```
src/app/          layar (expo-router): login, daftar tugas (index), trip/[id], report/[id], profile, admin
src/components/   komponen UI (tombol, kartu tugas, stepper, banner)
src/lib/          api, sesi, antrean offline, push, cache, format tanggal WIB & rupiah
scripts/          mock-api.mjs, generate-icons.mjs
```

---

## English summary

Android-first driver app for Arasya Rent Car (Expo + TypeScript + expo-router). Drivers receive trips through push notifications, step through accept / depart / arrived at pickup / finish, and send odometer photos and expense receipts. Every write goes through a persisted offline queue, replayed in order with backoff. Reports are idempotent via `client_ref`.

- Dev: `npm install && npx expo start`. Set `EXPO_PUBLIC_API_URL` (default `https://api.haikuy.com/api/v1`). Mock backend: `npm run mock-api` (driver `0812345678` / `test1234`).
- APK: free Expo account → `npx eas-cli init` (commit the projectId) → `npx eas-cli build -p android --profile preview`. Or run the manual GitHub workflow after adding the `EXPO_TOKEN` repo secret.
- Push: create a Firebase project for `com.arasyarentcar.driver`, add `google-services.json` (`android.googleServicesFile`), and upload an FCM V1 service-account key to EAS credentials.
- Checks: `npx tsc --noEmit`, `npx expo export --platform android`.
