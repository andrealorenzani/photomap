# Photomap — Architecture

## Current state

Photomap now consists of two separate, unconnected projects in the same repo:

- A frontend project (TypeScript + Vite + React) at the repo root, implementing guest mode
  entirely client-side (Phase 1, implemented).
- A standalone backend project (PHP 8.x + MySQL) at `backend/`, implementing the accounts API
  (Phase 2, implemented).

**The two are not wired together yet.** The frontend makes no calls to the backend and the
backend has no knowledge of the frontend; a user of the live app today still only experiences
guest mode exactly as in Phase 1. Connecting them (real login/register in the banner, uploads
and map/timeline data switching to the backend when logged in, a public `/share/{token}` route,
and the remaining "core"/"nice to have" features) is Phase 3, a separate future change.

## Phase 1 — guest mode frontend (implemented)

The frontend implements guest mode entirely client-side. There is no backend call and no network
traffic involving photo data from this project; the only network traffic it generates is
OpenStreetMap basemap tile requests (inherent to the mandated Leaflet + OSM stack) and ordinary
dev tooling traffic (npm, Vite HMR).

### High-level shape

```
Browser
├── React UI (TopBanner, UploadControl, StatusPanel, MapView, TimelineStrip,
│             PhotoThumbStrip, FullSizeViewer, PrivacyNote)
├── Zustand store (photoStore) — photos, ingest status, timeline filter, selection
├── Ingest pipeline (lib/ingest) — folder-picker/drop input -> per-file cache check
│   -> dispatch to worker pool -> write results to store + repository
├── Worker pool (lib/exifWorkerPool) — 2-4 Web Workers running exifWorker.ts
│   (exifr EXIF/GPS/datetime parsing + createImageBitmap/OffscreenCanvas thumbnail
│   + preview generation), off the main thread
├── PhotoRepository interface (lib/db) — IndexedDbPhotoRepository is the only
│   module that talks to IndexedDB directly (photoMeta, photoBlobs, folders stores)
└── Leaflet + Leaflet.markercluster (map rendering) <-- OpenStreetMap tile server (network)
```

### Module boundaries and the seam for future phases

- `PhotoRecord` (in `src/types.ts`) is the shared domain model. Its fields were deliberately
  named to closely mirror the concepts in the now-implemented Phase 2 `photos` database table
  (`lat`, `lon`, `takenAt`, `cameraMake`, `cameraModel`, camelCase vs. the DB's snake_case) —
  confirmed a close 1:1 match now that the backend's actual schema exists (see below) — so
  mapping to the backend's JSON API in Phase 3 should be straightforward.
- `PhotoRepository` (in `src/lib/db/`) is an interface, not just a concrete class.
  `IndexedDbPhotoRepository` is the only implementation today. This is the seam a future Phase 3
  `ApiPhotoRepository` is expected to implement against the now-implemented backend's
  `GET/POST/DELETE /api/photos` (plus a `PATCH /api/photos/{id}` still to be added in Phase 3),
  without the rest of the app (store, components) needing to know which one it's using.
- The ingest pipeline, worker pool, and grouping/timeline math are pure client-side concerns with
  no awareness of accounts or a backend; they operate purely on `PhotoRecord`s regardless of
  where those records ultimately come from.
- No shared code exists between the frontend and the backend project, and none is planned — they
  are two independent projects (different language/runtime) that will only ever communicate over
  the backend's JSON HTTP API, once Phase 3 wires that connection up. The frontend was not
  touched at all while building the Phase 2 backend.

### Key architectural decisions (Phase 1)

- **Two data layers, not one**: `groupKey` (~50m latitude-corrected grid bucketing, in
  `lib/grouping.ts`) folds photos taken at the same spot into one logical marker; Leaflet's
  `markercluster` plugin then visually clusters those location-markers as the map zooms. These
  are distinct concerns and are not conflated in the implementation.
- **Never cache original file bytes**: only a ~200px thumbnail and a ~1600-1800px/quality-80
  preview are generated (in the worker) and persisted to IndexedDB per photo. This keeps storage
  usage bounded for large personal libraries; the full-size viewer is therefore not
  pixel-perfect against the original file — an accepted, documented tradeoff.
- **Per-file cache identity, not per-folder**: browsers give no stable folder identity from
  `<input webkitdirectory>` or drag-and-drop, so "have I seen this file before" is answered by a
  deterministic id (`hash(relativePath, size, lastModified)`, `lib/stableId.ts`) checked against
  IndexedDB before dispatching to the worker pool. This degrades gracefully to per-file
  granularity for partial folder changes, at the accepted cost that deleting a photo and later
  reopening the same folder will re-add it (no tombstone/exclusion list exists).
- **Web Worker owns the whole per-photo pipeline**, not just EXIF parsing: metadata extraction
  *and* thumbnail/preview image generation both happen in `exifWorker.ts`, off the main thread,
  which is what actually keeps the UI responsive on large folders. A small worker pool (2-4
  workers) bounds concurrency and batches progress updates rather than firing every file at once.
- **Zustand over React Context** for global state: photo counts can run into the hundreds or
  thousands with frequent progress updates, and selector-based subscriptions avoid re-rendering
  the map/timeline on every tick.
- **Reverse geocoding is omitted entirely from the frontend, not throttled**: browser `fetch()`
  cannot set a custom `User-Agent` header (a forbidden header per the Fetch spec), which is
  exactly what a public geocoder's usage policy requires to identify a compliant client — so no
  in-browser call can honor that policy regardless of throttling. The full-size photo view shows
  only a datetime overlay. Phase 2 has since built the server-side geocoding proxy this was
  deferred to (`GET /api/geocode`, see below); the frontend does not call it yet — that's Phase 3.
- **Privacy guarantee is scoped to photo data**: "your photos never leave this device" covers
  photo bytes, EXIF metadata, filenames, and GPS coordinates. It explicitly does not (and
  structurally cannot) cover OpenStreetMap basemap tile requests, which are an inherent,
  disclosed consequence of using an online slippy map (Leaflet + OSM tiles were mandated by the
  product spec) and carry only generic tile x/y/z indices, never photo data.

## Phase 2 — accounts backend (implemented, standalone, no frontend wiring)

A separate PHP 8.1+ project at `backend/`, with its own dependencies (Composer), its own tests
(PHPUnit), and its own README — entirely independent of the frontend project at the repo root.
It is reachable only via direct HTTP calls (curl/Postman/its own test suite) today; the frontend
makes no calls into it.

### High-level shape

```
Client (curl/Postman/tests today; the Photomap frontend in a future Phase 3)
  │  JSON over HTTP, session cookie + X-CSRF-Token header
  ▼
public/index.php (front controller, only web-root-reachable file)
  └── Router (src/Routing/Router.php) — hand-rolled method+regex path matcher
        ├── Middleware: AuthMiddleware (session check), CsrfMiddleware (X-CSRF-Token vs. session)
        └── Controllers (Auth, Account, Photos, Media, ShareLinks, Share, Geocode)
              ├── Repositories (User, Photo, ShareLink, GeocodeCache, LoginAttempt)
              │     └── PDO (prepared statements only) ──► MySQL
              │           (users, photos, share_links, geocode_cache, login_attempts,
              │            nominatim_rate_limit, schema_migrations)
              └── Services:
                    ImageProcessor (GD: EXIF-orient, resize ≤2000px q85, thumbnail 320px q80)
                    FileValidator (finfo real content-type + size check)
                    StorageQuotaService (row-locked 100MB/account usage check)
                    RateLimiter (failed-login throttling, per-account + per-IP)
                    SignedUrl (HMAC-signed, time-limited media URLs)
                    NominatimClient / NominatimRateLimiter (rate-limited, cached geocoding)
                                          │
                                          ▼ (ext-curl, real network call on cache miss)
                                 OpenStreetMap Nominatim
  storage/ (OUTSIDE public/, never web-reachable)
    photos/{user_id}/{random32hex}.jpg
    thumbnails/{user_id}/{random32hex}.jpg
  — served back to clients only via signed, time-limited /api/photos/{id}/file|thumbnail URLs,
    never as a directly browsable directory
```

### Key architectural decisions (Phase 2)

- **Hand-rolled router, not a framework**: consistent with the project's minimal-dependency
  posture; a small regex method+path matcher is sufficient for this endpoint count.
- **Raw `ext-gd`, not Imagick/Intervention**: for the same reason. EXIF orientation is corrected
  manually (`exif_read_data()` + `imagerotate()`) before resizing; output is always normalized to
  JPEG regardless of input format (JPEG/PNG/WebP accepted, WebP gracefully rejected at runtime
  with `422 webp_unsupported` if the GD build lacks WebP support, rather than crashing).
- **Signed, expiring URLs for image bytes**, not a "check ownership on every request to a
  photo-serving endpoint" cookie-auth model: `SignedUrl` HMAC-signs a URL (owner context: 15 min
  TTL; share context: 10 min TTL) that's freshly regenerated on every `/api/photos` or
  `/api/share/{token}` JSON response, never persisted. Share-context URLs additionally re-check
  the share link's `revoked_at` live on every image fetch (not just at issuance), so revoking a
  share link cuts off access to already-open image URLs from that link immediately rather than
  only once their TTL expires.
- **CSRF required on every state-changing endpoint, including register and login**: no bootstrap
  exemption — a public `GET /api/csrf-token` endpoint seeds/returns the session's CSRF token
  before any state-changing call, including the very first one.
- **MySQL row lock, not filesystem `flock()`, for the global Nominatim rate limit**: a
  `nominatim_rate_limit` sentinel row locked via `SELECT ... FOR UPDATE` correctly serializes the
  1-request/second limit across multiple PHP processes/workers, which a local `flock()` would
  not; the same row-lock pattern (on a per-user row) is reused by `StorageQuotaService` to make
  the 100MB quota check race-safe under concurrent uploads (quota check + row insert in one
  transaction).
- **Single-active-share-link model**: `POST /api/share-links` revokes any existing active link
  for that account and creates a new one ("rotate"), rather than allowing multiple simultaneous
  active links, matching the product's framing of "a shareable permalink" (singular).
- **Storage quota accounted in actual on-disk bytes** (resized image + thumbnail), not original
  upload size, computed via `SUM()` over a stored `file_size_bytes` column rather than re-reading
  the filesystem on every check.
- **Ownership is never trusted from the client**: every `/api/photos/*`, `/api/share-links/*`,
  and `/api/account` operation resolves the target resource's owner from the authenticated
  session server-side; mismatched-ownership deletes return `404` (not `403`) to avoid confirming
  another user's resource id exists.
- **Docker is dev/test tooling only, not part of the deliverable's primary path**: the sandbox
  this was built in has no native PHP/MySQL, so `docker-compose.yml` + `docker/` exist purely as
  an optional convenience, clearly labeled as such in both the compose file and the README; the
  documented, required way to run this backend is the plain `php -S localhost:8000 -t public
  public/index.php` against a local MySQL instance.

### Known, documented limitations (Phase 2)

- **Account deletion (`DELETE /api/account`) ends only the current session.** It does not
  proactively invalidate any other active session for the same account elsewhere; such a session
  would only start failing on its next DB-touching request, since the underlying user row is
  gone. No cross-session store exists in this design to do otherwise within this phase's scope.
- **The session cookie's `Secure` flag is gated by `APP_ENV=production`.** Plain-HTTP `php -S`
  (used for local dev and the test suite) cannot meaningfully use `Secure` cookies at all, so
  `APP_ENV=local` is a documented dev-only exception; the `Secure`/`HttpOnly`/`SameSite=Lax`
  attributes themselves are always set correctly in the response header regardless.
- **Orphan-file cleanup** (e.g., files left behind by a crash mid-upload) and **trusting a
  reverse proxy's `X-Forwarded-For` header** for the login rate limiter's IP address are both out
  of scope for this phase — the deliverable is explicitly local-dev/direct-connection only.
- **`PATCH /api/photos/{id}`** (drag-to-reassign a marker's location) is not implemented — the
  original request explicitly said this is not required until Phase 3.
- **`nominatim_rate_limit.last_request_at` is a `DOUBLE` (microtime), not a MySQL `DATETIME`** —
  a deliberate deviation from an unstated assumption, needed because `DATETIME`'s whole-second
  resolution made sub-second spacing impossible to correctly enforce and test; production
  behavior at the default 1-second interval is unaffected.

## Phase 3 — wire the frontend to accounts + remaining features (planned, not yet implemented)

- The currently-inert top banner becomes functional (real login/register calling the Phase 2
  backend's `/api/register` and `/api/login`, then account email + copy-share-link +
  delete-account controls calling `/api/share-links` and `/api/account`).
- Uploads and map/timeline data source switch to the backend API when logged in, via a new
  `ApiPhotoRepository` implementing the existing `PhotoRepository` interface, calling the
  now-implemented `GET/POST/DELETE /api/photos`.
- A public read-only `/share/{token}` route rendering `GET /api/share/{token}`.
- Adding `PATCH /api/photos/{id}` (drag-to-reassign location for GPS-less photos in account
  mode) — explicitly deferred from Phase 2 to here.
- Remaining "core" features (date/camera/has-location filter-search); remaining "nice to have"
  features as time allows (trip auto-grouping, route lines, GeoJSON/KML export, heatmap map
  mode).
- CORS/dev-proxy configuration between the Vite dev server and the PHP API, and a combined
  top-level README tying both projects together, are expected to land as part of this phase.
- No shared code is expected between the frontend and the Phase 2 backend project even after
  wiring — they will continue to communicate only over the backend's JSON HTTP API.

## Resolved architecture questions

- **Does "zero network calls" contradict the mandated Leaflet + OpenStreetMap tile stack?**
  No — the guarantee is scoped to photo data specifically; OSM tile requests are a disclosed,
  expected exception (see above).
- **Should IndexedDB cache original photo bytes or only derived images?** Only derived
  thumbnail + preview images, never originals (see above).
- **Is there a numeric performance/scale target for Phase 1?** No hard target; the design
  (worker pool, thumbnail/preview-only storage) targets typical personal libraries (hundreds to
  a few thousand photos) as best-effort, with `navigator.storage.estimate()`/`persist()` used to
  surface quota pressure rather than enforcing a hard cap.
- **Share-link "create/rotate" semantics (Phase 2)?** Single-active-link: `POST
  /api/share-links` revokes the existing link (if any) and creates a new one, matching the
  original spec's singular wording "this user's share token."
- **How should uploaded/served photo images be protected — ownership-checked endpoint or
  signed/expiring URL (Phase 2)?** Signed, HMAC-based, time-limited URLs (15 min owner / 10 min
  share context), regenerated fresh on every JSON response and never persisted; share-context
  URLs additionally re-check revocation live on every fetch, not just at issuance.
- **What serializes the global 1-req/sec Nominatim rate limit across PHP worker processes
  (Phase 2)?** A MySQL row lock (`SELECT ... FOR UPDATE`) on a sentinel row, not a filesystem
  `flock()`, since MySQL is already a hard dependency and a DB lock works correctly across
  multiple processes.
- **Does account deletion need to invalidate other active sessions for the same account
  elsewhere (Phase 2)?** No — out of scope for Phase 2; documented limitation, since no
  cross-session store exists in this design.
- **Is the 100MB per-account storage quota permanent product policy?** Not decided; enforced
  exactly as specified for Phase 2, with permanence left as a future product decision.
