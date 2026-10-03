# CLAUDE.md — mobile-arasya-rentcar

"Arasya Driver": Expo SDK 57, React Native, TypeScript, expo-router, TanStack Query. Android package `com.arasyarentcar.driver`. Indonesian UI for drivers (big touch targets, plain words).

## Commands
- `npm ci`, `npx tsc --noEmit`
- Bundles: `EXPO_OFFLINE=1 npx expo export --platform android` (EXPO_OFFLINE because the version-check host is blocked in the sandbox). Add `--clear` when changing `EXPO_PUBLIC_*` vars (Metro caches inlined env).
- API base `EXPO_PUBLIC_API_URL` (default `https://api.haikuy.com/api/v1`).
- Mock API for UI work: `node scripts/mock-api.mjs` (port 4010; driver `0812345678` / `test1234`; `POST /driver/__mock/pay/<line id>` simulates the settlement, `POST /driver/__mock/requests/<id>/done` the admin handling an e-toll request). Web export works for previews (Playwright, Chromium at `/opt/pw-browsers/chromium`, 390x844@2x; for the GPS camera launch with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and grant `geolocation` + `camera`). Browsers have no reverse geocoder: a preview may set `window.__arasyaDevGeocoder = async ({latitude, longitude}) => [address]` (init script) to show a place name; never set it in the app.

## Architecture
- `src/lib/api.ts` (fetch client, `ApiError.status` 0 = no signal), `session.tsx` (SecureStore token, push + background sync on driver login), `queue.ts` (offline outbox: every action/report/driver request is queued (requests: `kind: 'request'`, `tripId` = `REQUESTS_QUEUE_ID`), optimistic via `tripState.applyPending`, sent in per-trip order with backoff; items carry `client_ref` = item id and `occurred_at`; 20 transient failures → `failed` with retry/discard UI; 413 permanent), `backgroundSync.ts` (expo-background-task ~15 min; defined at module load for headless starts), `photos.ts` (always resize; never upload originals), `push.ts` (Expo push; needs `extra.eas.projectId`; taps open the trip or the inbox), `cache.ts` (last trip data + inbox for offline open), `location.ts` (GPS fix/watch for the GPS camera; `placeName`/`usePlaceName` reverse-geocode a short place name on the phone, cached, ~3 s limit, none offline; sent as `location_name` with the coordinates), `tripState.ts` (step order accept → start → arrive → board → finish; accepted = `accepted_at` (the server's `driver_accepted_at`), ASSIGNED is not acceptance; odometer start-then-end rules; checkpoint numbering).
- Trip rules (owner, 3 Oct 2026): "Berangkat" and "Sampai di lokasi jemput" are always allowed; "Mulai perjalanan" (board) waits for `payment_ready` (order paid in full, server enforces). Arrival and checkpoint photos ("Foto / Catatan" → PHOTO with location, labelled "Checkpoint N" by order) = `components/StampCamera.tsx` (expo-camera live view with time/driver/place name/GPS stamp, burned in on the phone with react-native-view-shot; `stamped=true` tells the server not to stamp again).
- Screens `src/app/` (login, index = Tugas/Riwayat + bell, trip/[id], report/[id], arrive/[id] (GPS camera), notifications (inbox: `GET /driver/notifications`), profile (e-toll top-up request: `POST /driver/requests`, status from `GET /driver/requests?status=all`), admin placeholder).
- New native modules (expo-camera, expo-location, react-native-view-shot) need a new APK build; an OTA/JS-only update is not enough.
- Server contract lives in the API repo `src/modules/driver-app/*`; keep the mock in sync with it.

## Release (owner has Expo + Firebase accounts)
See README "Rilis pertama": fill `owner` and `extra.eas.projectId` in `app.json` (app.config.js treats empty as unset; `eas init` can't write it), add `google-services.json` at repo root, upload the FCM V1 key in expo.dev credentials, add GitHub secret `EXPO_TOKEN`, run workflow "EAS build" (profile preview → APK).

## Arasya system map (same section in all four repos)

Arasya Rent Car: car rental **with driver**, Bogor HQ, Indonesia. Legal entity **PT Ayomi Raya Karsa**. Brand name "Arasya Rent Car". Official WhatsApp 0821-2402-4281.

| Repo | What | Deploys to |
|---|---|---|
| `arasya-rentcar/arasya-web` | Marketing website (Astro + Sanity), booking form → lead | Vercel (push to `main`), arasya-web.vercel.app |
| `arasya-rentcar/api-arasya-rentcar` | Express + Prisma API, source of truth (Postgres + Storage on Supabase) | VPS via `deploy-local.sh api`, https://api.haikuy.com |
| `arasya-rentcar/dashboard-arasya-rentcar` | Admin dashboard (Next.js) | Vercel (push to `main`) **and** VPS `deploy-local.sh dashboard` → dashboard.haikuy.com |
| `arasya-rentcar/mobile-arasya-rentcar` | Driver app (Expo, Android first) | EAS build (APK) |
| `arasya-rentcar/wa-bot-arasya` (branch `development`) | Old WhatsApp bot (whatsapp-web.js) | **Being retired**, do not extend |

Flow: website form → `POST /api/v1/public/leads` (code `ARS-XXXXX`, also sent in the WhatsApp message and GA4 `generate_lead`) → dashboard "Lead Website" → order (order_code = lead code) → schedule lines assigned to drivers → driver app (accept / start / arrive / finish / reports) → invoices (DP ≥ 20%) → first PAID invoice sends GA4 `purchase` (Measurement Protocol).

Rules that apply everywhere:
- **Time is WIB (Asia/Jakarta, +07:00).** Never derive dates from `toISOString()` or the browser timezone; build `…T00:00:00+07:00` / `…:00+07:00` explicitly.
- **Payments only to BCA 0954840782 a.n. PT Ayomi Raya Karsa.** No personal accounts anywhere (captions, PDFs, site).
- **Cancellation (as enforced by `computeCancellationPenalty`):** before the travel day 20% of the order total; day H until 10:00 WIB and trip not started 50%; after that 100%. Website text, captions and PDFs must say the same.
- **Personal data:** NIK and KTP/document files are sensitive (UU PDP). Lists show masked NIK only; documents live in the private bucket and are served by 5-minute signed URLs; never return a full customer object from endpoints that don't need it.
- **Idempotency:** client-generated `client_ref` (uuid) + guarded conditional updates; resends must be no-ops.
- **WhatsApp:** default is manual mode (`WA_DELIVERY` unset/manual): the API returns `wa_url` links the admin opens; driver messages go to the app as push. `WA_DELIVERY=bot` only while the old bot still runs.
- Commits end with the trailers given by the session; never put model names in code or commits. Secrets never in chat or git.
- Deferred work lives in `dashboard-arasya-rentcar/docs/BACKLOG.md`; the latest handoff in `dashboard-arasya-rentcar/docs/HANDOFF.md`.
