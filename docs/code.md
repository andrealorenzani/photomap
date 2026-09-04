# Photomap — Code

## Status
The frontend (guest mode + account mode, at the repo root) and the backend (PHP + MySQL accounts
API, at `backend/`) are both implemented and, as of Phase 3, wired together over the backend's
JSON HTTP API. They remain two separately runnable/deployable projects with no shared code — the
frontend has no build-time dependency on the backend and vice versa. This document covers the
frontend project first, then the backend project, then the root-level Docker/deployment tooling
that spans both.

# Frontend (guest mode + account mode)

## Running it

Native dev (guest mode works with no backend running; account mode needs the backend up):

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). Select a folder of photos via
the "Select folder…" button, or drag-and-drop a folder onto the map. Vite's dev server proxies
`/api` requests to `http://localhost:8000` by default (`VITE_DEV_API_PROXY_TARGET`), so the
frontend and backend appear same-origin here too.

Other scripts:

```bash
npm test        # runs the automated test suite once (vitest)
npm run test:watch
npm run build    # type-checks and produces a static production build (tsc -b && vite build) -> dist/
npm run lint     # type-check only (tsc --noEmit)
```

`npm run build`'s `dist/` output is plain static files (HTML/CSS/JS plus a runtime `config.js`)
with no Node entry point — deployable to any static host or the same web root as a plain PHP
host. See the root `README.md` for the full deployment story and the whole-stack Docker path.

## Stack

- TypeScript + Vite + React (`react`, `react-dom`)
- `exifr` — EXIF/GPS/datetime parsing
- `leaflet` + `@types/leaflet`, `leaflet.markercluster` (untyped; ambient declaration provided)
- `idb` — thin Promise wrapper over IndexedDB
- `zustand` — global state (`photoStore`, `authStore`)
- No routing library — a small hand-rolled two-route matcher (`src/Router.tsx`)
- Dev/test: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
  `fake-indexeddb`

## Project layout

```
src/
  types.ts                    Shared domain model (PhotoRecord, MarkerGroup, worker messages,
                                isUsableGPS() Null Island rule)
  types/leaflet.markercluster.d.ts   Ambient types for the untyped leaflet.markercluster plugin
  Router.tsx                   Hand-rolled path matcher: `/` -> App, `/share/:token` -> SharePage
                                (not react-router-dom — see docs/architecture.md)
  state/
    photoStore.ts               Zustand store: photos (Map), ingest status, timeline dateFilter,
                                 searchFilters (date range/camera/has-location), selected-photo
                                 id; hydrateFromDB/upsertPhoto/removePhoto/reconcileId/
                                 reassignLocation/setSearchFilters etc.
    authStore.ts                 Zustand store: session status ('idle'|'checking'|
                                 'authenticated'|'guest'), current user; restoreSession/register/
                                 login/logout/deleteAccount; swaps the active PhotoRepository via
                                 lib/db on every status transition
  lib/
    config.ts                    Reads runtime public/config.js (window.__PHOTOMAP_CONFIG__)
                                  layered over build-time VITE_* defaults; exposes
                                  getApiBaseUrl()/getMapConfig()
    api/
      http.ts                    Shared fetch client: CSRF-token-once-per-session,
                                  credentials:'include', typed ApiError (distinguishes
                                  413 quota_exceeded/422 from generic failures)
      authApi.ts, photosApi.ts, shareLinksApi.ts, accountApi.ts, shareApi.ts
                                  Thin per-resource wrappers over http.ts
    db/
      schema.ts                  IndexedDB schema (photoMeta, photoBlobs, folders stores)
      photoRepository.ts         PhotoRepository interface + IndexedDbPhotoRepository;
                                  StorageQuotaExceededError wrapping; estimateUsage(),
                                  requestPersistence(); getActiveRepository()/
                                  setActiveRepository() around a swappable module-level active
                                  implementation; the exported `photoRepository` is now a thin
                                  proxy delegating to the active implementation at call time
      apiPhotoRepository.ts      ApiPhotoRepository — implements the same interface against
                                  GET/POST/DELETE/PATCH /api/photos; estimateUsage()/
                                  requestPersistence() are no-ops (IndexedDB-only concepts)
      index.ts                   Barrel export — the only module allowed to talk to
                                  IndexedDB directly
    ingest/
      index.ts                   Orchestrates folder-picker/drop input -> per-file cache-key
                                  check -> worker pool dispatch -> writes into store +
                                  repository; awaits PhotoRepository.add()'s returned
                                  PhotoRecord and reconciles the store entry via reconcileId()
                                  if the server assigned a different id than the optimistic
                                  client-generated one; handles QuotaExceededError (guest mode)
                                  and surfaces non-quota upload failures (account mode) as a
                                  status message instead of an unhandled rejection
    filters.ts                    Pure date-range/camera-make-model/has-location filter
                                  predicates over a PhotoRecord list (client-side only, both
                                  modes and the share view)
    mapStyles.ts                  Detailed/Treasure Map preset config (tile URL, attribution,
                                  maxZoom, CSS filter), sourced from VITE_MAP_* env vars via
                                  lib/config.ts; localStorage load/save of the chosen style
    grouping.ts                   Latitude-corrected ~50m grid bucketing (gridKey,
                                  computeMarkerGroups)
    timeline.ts                   Pure binning/domain/intensity/hit-testing logic for the
                                  timeline strip
    exifWorkerPool.ts             Round-robin 2-4 Web Worker pool with progress tracking and
                                  cancellation
    stableId.ts                   FNV-1a hash of (relativePath, size, lastModified) — the
                                  per-file cache key
    dropFiles.ts                  Recursive folder drag-and-drop resolution
                                  (webkitGetAsEntry)
    objectUrlCache.ts / useObjectUrl.ts   LRU cache of blob object URLs with explicit
                                  revocation on delete
    format.ts                     Small display-formatting helpers
  workers/
    exifWorker.ts                 Runs off the main thread: exifr.parse() for EXIF metadata,
                                  then createImageBitmap + OffscreenCanvas to generate a
                                  ~200px thumbnail and a ~1600-1800px/quality-0.8 preview, with
                                  EXIF-orientation correction applied
                                  (createImageBitmap(..., {imageOrientation:'from-image'})
                                  preferred, manual canvas-transform fallback for orientations
                                  2-8 on browsers without that option); HEIC decode-failure
                                  fallback to a placeholder
  components/
    TopBanner.tsx                 "Photomap" wordmark + login/register forms when logged out;
                                  account email + "copy share link" + "delete account" when
                                  logged in
    AccountNotice.tsx              Persistent "you're logged in — photos are stored on the
                                  server" notice, visible for the whole authenticated session;
                                  mutually exclusive with PrivacyNote
    PrivacyNote.tsx                Persistent "Guest mode: your photos never leave this
                                  device." note; hidden while authenticated
    UploadControl.tsx              Folder picker + drag-and-drop zone
    StatusPanel.tsx                Live processed/with-GPS/without-GPS counts + progress bar
    FilterBar.tsx                  Date-range/camera make-model/has-location filter controls,
                                  writing to photoStore's searchFilters slice
    UnlocatedPhotosPanel.tsx       Panel of GPS-less photos, draggable onto the map to assign
                                  a location for the first time
    MapView.tsx                    Imperative Leaflet + markercluster integration; plain-DOM
                                  marker popups with delete buttons; draggable markers +
                                  map-container drop target funneling into reassignLocation();
                                  Detailed/Treasure Map tile-layer switching; bounds auto-fit
                                  with a redundant-fit guard; empty-state hint; optional
                                  `photos`/`readOnly` props for the share view
    MapStyleToggle.tsx             Small on-map Detailed/Treasure Map control; default
                                  Detailed, choice persisted to localStorage only
    TimelineStrip.tsx              Custom canvas density-heatmap timeline component with an
                                  "Unknown date" bucket for photos with no datetime; optional
                                  `photos`/controlled `dateFilter` props for the share view
    PhotoThumbStrip.tsx            Chronological thumbnail strip (marker popups and
                                  timeline-filtered results); optional `photos`/`readOnly` props
    FullSizeViewer.tsx             Full-size photo view; datetime-only overlay banner; delete
                                  action; optional `photos`/`readOnly` props
    (each *.tsx has a matching *.css)
  pages/
    SharePage.tsx                  Public read-only `/share/{token}` view: fetches
                                  GET /api/share/{token} into local component state (never the
                                  global store's photo data), reuses only UI-only global-store
                                  slots (selectedPhotoId, dateFilter); renders MapView/
                                  TimelineStrip/PhotoThumbStrip/FullSizeViewer with
                                  `photos`/`readOnly` set; no upload/delete/login affordances;
                                  filters and the map-style toggle remain available
  main.tsx, App.tsx, App.css, index.css, vite-env.d.ts
test/
  fixtures/                      Real sample JPEGs (and one HEIC) with deliberate EXIF
                                  characteristics — see "Testing" below
  *.test.ts / *.test.tsx         Vitest unit/integration tests (see "Testing" below)
public/                          Static assets served as-is by Vite, including config.js
                                  (window.__PHOTOMAP_CONFIG__ runtime override for apiBaseUrl/
                                  map settings — a plain file, editable post-build with no
                                  rebuild)
index.html, vite.config.ts, tsconfig.json, package.json, .env.example, .gitignore, README.md
docker/                          Root whole-stack Docker build context: frontend/Dockerfile
                                  (multi-stage node:20-alpine build -> nginx:alpine serve),
                                  frontend/nginx.conf (SPA fallback + /api/ reverse proxy)
docker-compose.yml               Root whole-stack compose (mysql + backend + frontend) — see
                                  "Docker" below
docs/                            product.md, architecture.md, code.md, plans.md,
                                  original_prompts.md (this documentation set)
first_research.md, photomap_prompt.md   Original background-research reference files
backend/                          Standalone PHP + MySQL accounts backend — see below
```

Notes on layout vs. earlier plans (kept here so the docs don't silently diverge from reality):
`lib/db/` and `lib/ingest/` remain small directories rather than single flat files, as in Phase
1. Coordinate rounding lives in `lib/grouping.ts` (there is no separate `lib/geo/` directory).
The `folders` IndexedDB store is declared in the schema but still not read from or written to
anywhere — unchanged since Phase 1, left as an unwired UX nicety. `src/Router.tsx` lives at
`src/` top level (a sibling of `App.tsx`, not under `lib/` or `components/`) since it's a routing
entry point, not a component or a library helper.

## Data model

`PhotoRecord` (`src/types.ts`) is the shared domain type, field-named to closely mirror the
backend's `photos` database table (`lat`, `lon`, `takenAt`, `cameraMake`, `cameraModel`,
camelCase vs. the DB's snake_case) — this made mapping to/from the backend's JSON API
straightforward in practice.

Guest mode: IndexedDB (`photomap-guest` database) has three object stores:
- `photoMeta` — small records: id (stable per-file hash), EXIF fields, groupKey. Queried on
  every load.
- `photoBlobs` — id → `{ thumbnail, preview }` blobs. Loaded lazily on demand, not eagerly for
  the whole set. Original file bytes are never stored.
- `folders` — reserved for a future "last-opened folder name" UX nicety; declared but unwired.

Account mode: no local persistence of photo data beyond in-memory store state for the current
session — `ApiPhotoRepository` reads/writes directly through to the backend's `photos` table
(see the backend's Data model below) on every call; ids are the backend's `AUTO_INCREMENT`
integers, not the client-generated stable hash (see "id reconciliation" above).

## Known, documented characteristics (not bugs)

- Thumbnails/previews only, never original file bytes — the full-size viewer is not
  pixel-perfect against the original file, in either mode.
- HEIC/HEIF: EXIF metadata used fully in both modes; thumbnail/preview image rendering falls
  back to a placeholder icon on browsers other than Safari (no in-browser HEIC decode support
  there yet). In account mode, an undecodable HEIC upload surfaces as an upload error rather
  than being silently skipped, since there are no image bytes to send the server.
- No delete "tombstone" in guest mode: caching is per-file, not per-folder, so re-selecting the
  same folder after deleting a photo re-adds that photo. Account mode has no folder-reselection
  concept, so this doesn't apply there.
- GPS coordinates of exactly `(0, 0)` ("Null Island") are treated as no-GPS.
- If IndexedDB fills up mid-import (guest mode), remaining not-yet-processed files in that batch
  stop being persisted (surfaced in the status panel) but continue to be parsed/shown for the
  session. In account mode, a `413 quota_exceeded` response from the server is surfaced as a
  distinct, visible error instead.
- EXIF-orientation-based pixel rotation is applied to generated thumbnails/previews
  (`src/workers/exifWorker.ts`), preferring `createImageBitmap(file, { imageOrientation:
  'from-image' })` with a manual canvas-transform fallback for browsers that don't support the
  option. This benefits both modes; it was fixed rather than left as a documented gap once
  account-mode uploads began persisting this same pre-resized, EXIF-stripped preview permanently
  server-side, which would otherwise have escalated it from a session-scoped rendering artifact
  into a permanent data-quality bug.
- The synthetic HEIC test fixture (`test/fixtures/with-gps-and-datetime.heic`, produced via
  ImageMagick) round-trips correctly through `exiftool` but `exifr` cannot parse its EXIF box
  ("Malformed EXIF data") — an encoder-conformance quirk of that specific synthetic file, not a
  real-world code path. The HEIC extraction test mocks `exifr.parse()`'s output instead; the
  fixture file itself is kept in the repo for documentation/manual-testing purposes.
- No guest-to-account photo migration: logging in never uploads existing guest-mode IndexedDB
  photos, and logging out never clears them — two entirely separate namespaces, by design.
- Filter/search is client-side only in both modes and the share view — `GET /api/photos`/
  `GET /api/share/{token}` return the full list; no server-side query-param filtering exists.
- Treasure Map's hard zoom cap (`maxZoom: 10`) means a dense marker cluster can't be zoomed in
  far enough to visually separate the way Detailed mode allows — inherent to the feature as
  specified, not a bug.
- Map style choice persists per-browser (`localStorage`) only, not synced across devices for an
  account, unlike photo data itself.

## Testing

Vitest (jsdom environment) + Testing Library for React component tests. Run via `npm test`
(single run) or `npm run test:watch`. As of this change: **19 test files, 135 tests, all
passing.**

Fixtures (`test/fixtures/`) are real sample images with deliberately varied EXIF: GPS +
datetime; datetime-only/no GPS; GPS without an offset-time tag; a HEIC sample; a corrupted/
truncated JPEG; a non-image file renamed `.jpg`; a pair of JPEGs just inside/outside the ~50m
grouping radius (haversine-verified); a JPEG with GPS exactly `(0, 0)` for the Null Island rule.

Coverage by file:
- `grouping.test.ts` — coordinate-grouping boundary cases (haversine-verified), high-latitude
  correctness.
- `timeline.test.ts` — binning/intensity/range-selection as pure functions, zero-photos/
  current-year default, single-day vs. multi-year spans.
- `exifWorker.test.ts` — EXIF parsing against real fixtures (GPS+datetime, datetime-only, Null
  Island, corrupted/non-image handling, missing offset-time tag), HEIC metadata handling (via
  mocked `exifr.parse()` output — see "Known characteristics" above).
- `exifOrientation.test.ts` — orientation-aware thumbnail/preview generation, including the
  manual canvas-transform fallback path for orientations 2-8.
- `exifWorkerPool.test.ts` — work distribution, progress tracking, cancellation.
- `db.test.ts` — IndexedDB repository behavior, including quota-exceeded handling and
  no-tombstone re-add after delete (uses `fake-indexeddb`).
- `ingest.test.ts` — cache-hit skips re-parsing unchanged files; changed files re-parse;
  client/server id reconciliation after `add()` returns a different id.
- `photoStore.test.ts` — Zustand store state transitions, including searchFilters/reconcileId/
  reassignLocation actions.
- `authStore.test.ts` — session restore, register/login/logout/delete-account flows, and the
  repository swap they trigger.
- `stableId.test.ts` — deterministic per-file cache-key hashing.
- `http.test.ts` — CSRF-token-once-per-session lifecycle, `credentials: 'include'`, typed
  `ApiError` (413/422) surfacing.
- `apiPhotoRepository.test.ts` — `ApiPhotoRepository` against a mocked backend, including
  quota-exceeded and no-op `estimateUsage()`/`requestPersistence()`.
- `filters.test.ts` — date-range/camera-make-model/has-location filter predicates.
- `mapStyles.test.ts` — Detailed/Treasure Map preset config and `localStorage` persistence.
- `mapView.test.tsx` — tile-layer switching between styles, draggable-marker and drop-target
  wiring, `readOnly` disabling both.
- `reassignLocation.test.ts` — optimistic update + rollback-on-error for drag-to-reassign, in
  both repository implementations.
- `router.test.tsx` — `/` vs. `/share/:token` matching, including trailing slash and encoded
  token cases.
- `sharePage.test.tsx` — `/share/{token}` renders from local component state only (asserts the
  global store's `photos.size` stays 0 throughout), `readOnly` behavior, filters/style toggle
  still available.
- `components.test.tsx` — thumbnail strip sorting/deletion, full-size viewer, status panel,
  privacy note, `TopBanner`'s login/register/logged-in states.

Not practical to automate in this environment, left as a manual checklist instead: real
cross-browser drag-and-drop/folder-picker behavior, Leaflet map bounds-fitting in a live
browser, large-set (1000+ photos) performance, visual heatmap density inspection, and live
two-real-origin cookie/CORS behavior (see backend "Testing" below). See the Phase 1 plan's
Testing information section in `docs/plans.md` for the full manual checklist.

Also verified for this change: `npx tsc --noEmit` clean; `npm run build` succeeds and `find dist
-type f` shows only static assets (`index.html`, `config.js`, hashed JS/CSS — no Node entry
point); a manual `grep -rn "http://localhost" src/` returns nothing (confirming no hardcoded
dev-only URLs leaked into the app code).

# Backend (accounts, PHP + MySQL)

A standalone project at `backend/`, with its own `composer.json`, its own tests, and its own
README. Reachable from the frontend only via its JSON HTTP API — no shared code.

## Running it

```bash
cd backend
composer install
cp .env.example .env      # fill in DB credentials, an absolute STORAGE_PATH, and APP_SECRET
php -r 'echo bin2hex(random_bytes(32));'   # generate APP_SECRET
php scripts/migrate.php    # idempotent; tracks applied files in schema_migrations
php -S localhost:8000 -t public public/index.php
```

Requires PHP >= 8.1 with `pdo_mysql`, `gd`, `exif`, `fileinfo`, `curl`, `mbstring`, `json`, plus
a local MySQL (or MySQL-compatible) server and Composer. See `backend/README.md` for full setup
steps, the `GD` WebP-support check, PHP's own `upload_max_filesize`/`post_max_size` ini caveats,
the full API table, the CORS/cross-origin-cookie section, and a copy-pasteable curl walkthrough.

Other scripts:

```bash
composer test               # phpunit — 109 tests (46 Unit + 63 Feature)
bash scripts/smoke-test.sh http://localhost:8000   # runnable curl walkthrough (requires curl, jq)
```

`backend/docker-compose.yml` (`backend/docker/Dockerfile`, `backend/docker/init.sql`) remains a
narrower dev/test convenience for environments without native PHP/MySQL, backend-only — it is
distinct from the root `docker-compose.yml` (whole-stack, see "Docker" below).

## Stack

- PHP >= 8.1, hand-rolled router (no framework)
- PDO for all DB access (prepared statements only, no string-concatenated SQL)
- `ext-gd` for image processing (resize, EXIF-orientation correction, thumbnailing)
- `ext-curl` for the Nominatim HTTP client, behind a `GeocodeClientInterface` so tests never hit
  the real Nominatim service
- `vlucas/phpdotenv` for `.env` loading
- Dev: `phpunit/phpunit` ^10

## Project layout

```
backend/
  public/index.php                 Front controller — the only web-root-reachable file;
                                    CorsMiddleware runs first, before Session::start()
  src/
    Config.php                     Reads/validates .env-derived settings
    Database.php                   PDO connection factory (ERRMODE_EXCEPTION, no emulated prepares)
    Session.php                    Native PHP session bootstrap; HttpOnly cookie, Secure gated
                                    by APP_ENV=production, SameSite configurable
                                    (SESSION_COOKIE_SAMESITE, default Lax); CSRF token seeding
    Bootstrap.php                  Wires dependencies and routes together, including the new
                                    PATCH /api/photos/{id} route
    Http/
      Request.php, Response.php, JsonResponse.php
    Routing/
      Router.php                   Hand-rolled method+regex path matcher -> handler
    Middleware/
      AuthMiddleware.php            Rejects unauthenticated requests to protected routes
      CsrfMiddleware.php            Verifies X-CSRF-Token via hash_equals() on every
                                    POST/PUT/PATCH/DELETE route, including register/login
      CorsMiddleware.php            Opt-in exact-match origin allow-list
                                    (CORS_ALLOWED_ORIGINS, default empty = no CORS headers);
                                    handles OPTIONS preflight; Access-Control-Allow-Credentials:
                                    true + echoed exact origin + Vary: Origin, never a wildcard
    Controllers/
      AuthController.php           register, login, logout, csrfToken, me
      AccountController.php        DELETE /api/account (transactional row+file cascade delete)
      PhotosController.php         index, store (upload pipeline), update (PATCH — lat/lon
                                    only, 404-not-403 ownership), destroy
      MediaController.php          Signed-URL image/thumbnail byte streaming
      ShareLinksController.php     store (rotate: revoke-old-then-create-new), destroy (revoke)
      ShareController.php          Public show(token) — read-only, respects revoked_at
      GeocodeController.php        Cache-first Nominatim proxy
    Repositories/
      UserRepository.php, PhotoRepository.php (now includes updateLocation()),
      ShareLinkRepository.php, GeocodeCacheRepository.php, LoginAttemptRepository.php
      (all parameterized PDO)
    Services/
      ImageProcessor.php           GD: EXIF-orient, resize <=2000px q85, thumbnail 320px q80,
                                    no-upscale, alpha-flatten-to-JPEG, corrupt-image rejection
      FileValidator.php            finfo real-content-type + size checks (never trusts extension
                                    or client-supplied MIME type)
      StorageQuotaService.php      Row-locked reserveAndInsert() — quota check + photo insert in
                                    one transaction, race-safe under concurrent uploads
      RateLimiter.php              Failed-login throttling, per-account + per-IP
      SignedUrl.php                HMAC sign/verify for owner (15 min) and share (10 min)
                                    context media URLs; untouched by PATCH, which only ever
                                    writes lat/lon
      NominatimClient.php          ext-curl client with a proper User-Agent
      GeocodeClientInterface.php   Interface NominatimClient implements; tests use a fake instead
      NominatimRateLimiter.php     DB row-lock (SELECT ... FOR UPDATE) global 1 req/sec spacing,
                                    using a DOUBLE (microtime) timestamp column for sub-second
                                    precision
      PhotoPresenter.php           Shapes a photo row + fresh signed URLs into JSON
      ProcessedImage.php           Value object returned by ImageProcessor
  storage/                          OUTSIDE public/, never web-reachable
    photos/{user_id}/{random32hex}.jpg
    thumbnails/{user_id}/{random32hex}.jpg
  migrations/
    0001_create_users.sql, 0002_create_photos.sql, 0003_create_share_links.sql,
    0004_create_geocode_cache.sql, 0005_create_login_attempts.sql,
    0006_create_nominatim_rate_limit.sql
  scripts/
    migrate.php                    CLI runner; idempotent, tracks applied filenames in a
                                    schema_migrations table it creates automatically
    smoke-test.sh                  Runnable copy of the README's curl walkthrough, including
                                    a PATCH /api/photos/{id} step
  tests/
    bootstrap.php, FakeGeocodeClient.php
    fixtures/                      Real sample images: corrupted, non-image-as-.jpg, small/large/
                                    tiny JPEGs, a WebP, a PNG with alpha
    Unit/                          CsrfMiddleware, FileValidator, GeocodeController, ImageProcessor,
                                    NominatimClient, NominatimRateLimiter, RateLimiter, SignedUrl,
                                    StorageQuotaService (46 tests)
    Feature/                       Auth, Cors, Csrf, Geocode, Ownership, Photos, PhotoUpdate,
                                    ProductionCookie, Quota, RateLimit, SecurityFeature,
                                    ShareLinks (63 tests) — each boots a real `php -S` subprocess
                                    and drives it over real HTTP
    Support/                       ServerProcess (subprocess lifecycle), HttpClient/HttpResponse
                                    (curl wrapper, now with patchJson()/options()),
                                    DatabaseTestCase/FeatureTestCase (base classes),
                                    FakeHttpServer, concurrent_upload_worker.php (real multi-process
                                    concurrency test for the quota row-lock),
                                    nominatim_lookup_worker.php
  composer.json, composer.lock
  .env.example, .env.test, .gitignore   .env.example now documents CORS_ALLOWED_ORIGINS and
                                    SESSION_COOKIE_SAMESITE
  README.md                        Standalone run instructions, API table (including the PATCH
                                    row), CORS/cross-origin-cookie section, curl walkthrough
  docker/ (Dockerfile, init.sql), docker-compose.yml   Backend-only dev/test convenience,
                                    distinct from the root docker-compose.yml
```

## Data model (MySQL)

- `users` — id, `email` (unique), `password_hash`, `created_at`.
- `photos` — id, `user_id` (FK, `ON DELETE CASCADE`), `storage_path`, `thumbnail_path`,
  `file_size_bytes` (backs the quota `SUM()` query), `lat`/`lon` (nullable, updatable via
  `PATCH /api/photos/{id}`), `taken_at` (nullable), `camera_make`, `camera_model`, `created_at`;
  indexed on `user_id`.
- `share_links` — id, `user_id` (FK, `ON DELETE CASCADE`), `token` (unique), `created_at`,
  `revoked_at` (nullable); indexed on `user_id` and `token`.
- `geocode_cache` — PK `(lat_rounded, lon_rounded)`, `place_name` (nullable — caches an explicit
  "no result" too), `fetched_at`.
- `login_attempts` — id, `email`, `ip_address`, `succeeded`, `created_at`; indexed on
  `(email, created_at)` and `(ip_address, created_at)`. Backs failed-login rate limiting.
- `nominatim_rate_limit` — single sentinel row; `last_request_at` is a `DOUBLE` (microtime), not
  a `DATETIME`, for sub-second precision (a deliberate deviation — see `docs/plans.md`).

File paths are `SELECT`ed inside the same transaction as a DB delete, and files are `unlink()`'d
only after the transaction commits. `PATCH /api/photos/{id}` never touches file paths — it writes
only `lat`/`lon`.

## Known, documented characteristics (not bugs)

- Account deletion ends only the current session; it does not invalidate other active sessions
  for the same account elsewhere (no cross-session store exists in this design).
- The session cookie's `Secure` flag is gated by `APP_ENV=production`; `APP_ENV=local` (needed
  for plain-HTTP `php -S`) is a documented dev-only exception. `SameSite` is configurable
  (`SESSION_COOKIE_SAMESITE`, default `Lax`) — only a genuinely split-origin deployment needs
  `SameSite=None` (which also requires `Secure`/`APP_ENV=production`).
- CORS is opt-in and exact-match only: `CORS_ALLOWED_ORIGINS` empty (the default) emits no CORS
  headers at all; a non-matching/near-miss origin gets no `Access-Control-Allow-Origin` header
  either — never a wildcard, never substring/suffix matching.
- No orphan-file cleanup job; `unlink()` failures are best-effort, with the DB row treated as
  authoritative.
- `X-Forwarded-For` is not trusted for the login rate limiter's IP address — out of scope, since
  the deliverable is explicitly local-dev/direct-connection or same-origin reverse-proxy, not a
  hardened multi-hop production topology.
- WebP uploads are rejected at runtime with `422 webp_unsupported` (not a crash) if the GD build
  lacks WebP support; JPEG/PNG are unaffected either way.
- `scripts/migrate.php` does not wrap each migration in a PDO transaction, since MySQL DDL causes
  an implicit commit that makes an explicit transaction a no-op (and previously caused a spurious
  rollback error); a failed migration aborts the script before being recorded as applied.
- `PATCH /api/photos/{id}` is allowed for any owned photo, not restricted to currently-GPS-less
  ones — consistent with the other photo endpoints' unrestricted-within-ownership design.

## Testing

PHPUnit 10. Run via `composer test` from `backend/`. As of this change: **109 tests, 261
assertions, 0 failures** (46 Unit + 63 Feature), run twice for confirmation.

- **Unit tests** (`tests/Unit/`): CSRF token comparison logic; image resize/EXIF-orientation/
  no-upscale/corrupt-image-rejection behavior; finfo-based file-type sniffing; quota math
  including a genuine **multi-process** concurrency test (`tests/Support/
  concurrent_upload_worker.php`) proving the row-lock correctly serializes concurrent uploads
  against the quota; rate-limiter threshold logic; `NominatimRateLimiter` spacing; `SignedUrl`
  sign/verify/expiry/tamper-detection; `NominatimClient`'s wire behavior against a local fake
  socket server (`FakeHttpServer`); geocode rounding/caching via `FakeGeocodeClient` (real
  Nominatim is never called in any automated test).
- **Feature tests** (`tests/Feature/`): each test class boots a real `php -S` subprocess
  (`tests/Support/ServerProcess.php`) and drives it over real HTTP via curl
  (`tests/Support/HttpClient.php`). Covers auth flows (register/login/logout/me), CSRF
  enforcement on every state-changing endpoint (including `PATCH`), upload validation, the new
  `PhotoUpdateFeatureTest` (`PATCH /api/photos/{id}`: success, ownership 404-not-403, validation,
  CSRF), `CorsFeatureTest` (allow-listed origin gets the right headers + preflight response;
  non-matching origin gets none; credentials/`Vary` correctness), cross-account ownership
  isolation (404 not 403), quota exhaustion (a dedicated server instance configured with a small
  `STORAGE_QUOTA_BYTES`), rate limiting (a dedicated server instance with a short window), the
  full share-link lifecycle including "revoking a link immediately closes already-issued image
  URLs from it," session cookie security attributes (`ProductionCookieFeatureTest`), and
  confirming `storage/` itself is not web-reachable.
- Not covered by the automated Feature tier: cache-hit/miss/rounding/rate-limiting-spacing
  behavior of `GET /api/geocode` against a live server, since the live server always wires the
  real `NominatimClient` and the plan requires never calling real Nominatim in tests — that
  behavior is instead covered at the Unit tier via `GeocodeController` + `FakeGeocodeClient`
  directly (a tier-placement choice, not a coverage gap); the Feature tier only checks the
  unauthenticated-401 path for that endpoint. Live two-real-origin cookie/CORS behavior (a
  genuine split-origin browser round-trip) is a documented manual/staging concern, not covered by
  the automated suite, which checks header/config-level correctness only.
- Also verified: `php scripts/migrate.php` is idempotent and works against a genuinely fresh
  database; `bash scripts/smoke-test.sh` passes all steps (including the new PATCH step) against
  a real `php -S` dev server; `php -l` clean on every `src/`, `tests/`, `scripts/`, `public/`
  file.

# Docker and deployment tooling (root)

Two Docker Compose files exist, serving different purposes, both documented in the root
`README.md`:

- `backend/docker-compose.yml` — backend-only dev/test convenience (unchanged since Phase 2),
  for environments without native PHP/MySQL.
- `docker-compose.yml` (root, new) — whole-stack local convenience: `mysql` + `backend` +
  `frontend` (nginx serving the static `dist/` build, reverse-proxying `/api/*` to the backend
  container). One command (`docker compose up --build`), one URL
  (`http://localhost:8080`), same-origin from the browser's perspective (no CORS/`SameSite`
  configuration needed for this path). `docker compose down -v && docker compose up --build`
  reliably rebuilds from a clean volume, including on a genuinely fresh volume (the backend
  service's startup command retries `php scripts/migrate.php` in a loop to absorb MySQL's
  healthcheck reporting healthy slightly before it accepts application connections).
  `docker/frontend/Dockerfile` is a multi-stage build (`node:20-alpine` build stage → only
  `dist/` copied into a final `nginx:alpine` stage — no Node process in the built image).
  `docker/frontend/nginx.conf` provides the SPA fallback (`try_files ... /index.html`) needed
  for a real page load of `/share/:token`, and the `/api/` reverse-proxy config.

Neither Docker path is the "required" way to run the project — the documented, primary paths
remain native dev (three processes: MySQL, `php -S`, Vite) and a genuine production deployment
(a static host for the frontend's `dist/` build, a plain PHP+MySQL host for the backend,
potentially on different origins with `CORS_ALLOWED_ORIGINS`/`SESSION_COOKIE_SAMESITE`
configured for that case). See the root `README.md` for the full three-path breakdown and the
complete environment-variable reference tables for both the frontend and the backend.
