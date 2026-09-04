# Photomap — Code

## Status
Phase 1 (guest mode, frontend-only, at the repo root) and Phase 2 (accounts backend, PHP +
MySQL, at `backend/`) are both implemented. They are two separate, unconnected projects — the
Phase 2 backend has no frontend integration yet, and the frontend code documented here was not
touched while building it. The account-mode wiring and remaining features (Phase 3) do not exist
yet — see `docs/architecture.md` for how they're expected to slot in. This document covers the
frontend project first, then the backend project.

# Frontend (Phase 1 — guest mode)

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). Select a folder of photos via
the "Select folder…" button, or drag-and-drop a folder onto the map.

Other scripts:

```bash
npm test        # runs the automated test suite once (vitest)
npm run test:watch
npm run build    # type-checks and produces a production build (tsc -b && vite build)
npm run lint     # type-check only (tsc --noEmit)
```

## Stack

- TypeScript + Vite + React (`react`, `react-dom`)
- `exifr` — EXIF/GPS/datetime parsing
- `leaflet` + `@types/leaflet`, `leaflet.markercluster` (untyped; ambient declaration provided)
- `idb` — thin Promise wrapper over IndexedDB
- `zustand` — global state
- Dev/test: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
  `fake-indexeddb`

## Project layout

```
src/
  types.ts                    Shared domain model (PhotoRecord, MarkerGroup, worker messages,
                                isUsableGPS() Null Island rule)
  types/leaflet.markercluster.d.ts   Ambient types for the untyped leaflet.markercluster plugin
  state/photoStore.ts          Zustand store: photos (Map), ingest status, timeline filter,
                                selected-photo id; hydrateFromDB/upsertPhoto/removePhoto etc.
  lib/
    db/
      schema.ts                 IndexedDB schema (photoMeta, photoBlobs, folders stores)
      photoRepository.ts         PhotoRepository interface + IndexedDbPhotoRepository;
                                  StorageQuotaExceededError wrapping; estimateUsage(),
                                  requestPersistence()
      index.ts                   Barrel export — the only module allowed to talk to
                                  IndexedDB directly
    ingest/
      index.ts                   Orchestrates folder-picker/drop input -> per-file cache-key
                                  check -> worker pool dispatch -> writes into store +
                                  repository; handles QuotaExceededError by stopping
                                  persistence for the rest of the batch while continuing to
                                  parse/display in-memory
    grouping.ts                  Latitude-corrected ~50m grid bucketing (gridKey,
                                  computeMarkerGroups)
    timeline.ts                  Pure binning/domain/intensity/hit-testing logic for the
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
                                  ~200px thumbnail and a ~1600-1800px/quality-0.8 preview;
                                  HEIC decode-failure fallback to a placeholder
  components/
    TopBanner.tsx                 "Photomap" wordmark + inert placeholder login controls
    PrivacyNote.tsx                Persistent "Guest mode: your photos never leave this
                                  device." note
    UploadControl.tsx              Folder picker + drag-and-drop zone
    StatusPanel.tsx                Live processed/with-GPS/without-GPS counts + progress bar
    MapView.tsx                    Imperative Leaflet + markercluster integration; plain-DOM
                                  marker popups with delete buttons; bounds auto-fit with a
                                  redundant-fit guard; empty-state hint
    TimelineStrip.tsx              Custom canvas density-heatmap timeline component with an
                                  "Unknown date" bucket for photos with no datetime
    PhotoThumbStrip.tsx            Chronological thumbnail strip (marker popups and
                                  timeline-filtered results)
    FullSizeViewer.tsx             Full-size photo view; datetime-only overlay banner; delete
                                  action
    (each *.tsx has a matching *.css)
  main.tsx, App.tsx, App.css, index.css, vite-env.d.ts
test/
  fixtures/                      Real sample JPEGs (and one HEIC) with deliberate EXIF
                                  characteristics — see "Testing" below
  *.test.ts / *.test.tsx         Vitest unit/integration tests (see "Testing" below)
public/                          Static assets served as-is by Vite
index.html, vite.config.ts, tsconfig.json, package.json, .gitignore, README.md
docs/                            product.md, architecture.md, code.md, plans.md,
                                  original_prompts.md (this documentation set)
first_research.md, photomap_prompt.md   Original background-research reference files
```

Notes on layout vs. the original plan (kept here so the docs don't silently diverge from
reality): `lib/db/` and `lib/ingest/` are small directories (`schema.ts`/`photoRepository.ts`/
`index.ts`, and `ingest/index.ts`) rather than single flat files — this follows the more detailed
`PhotoRepository`-interface seam described in the plan's Architectural Impact section. Coordinate
rounding lives in `lib/grouping.ts` (there is no separate `lib/geo/` directory; geocoding itself
is omitted entirely in Phase 1, so there was nothing else to put there). The `folders` IndexedDB
store is declared in the schema but not yet read from or written to anywhere — it was called out
in the plan as "a UX nicety, not load-bearing for correctness" and left unwired to keep scope
tight; a future change can wire it up if it's decided to be worth it.

## Data model

`PhotoRecord` (`src/types.ts`) is the shared domain type, field-named to closely mirror the
concepts planned for a future Phase 2 `photos` database table (`lat`, `lon`, `takenAt`,
`cameraMake`, `cameraModel`, camelCase vs. the DB's future snake_case).

IndexedDB (`photomap-guest` database) has three object stores:
- `photoMeta` — small records: id (stable per-file hash), EXIF fields, groupKey. Queried on
  every load.
- `photoBlobs` — id → `{ thumbnail, preview }` blobs. Loaded lazily on demand, not eagerly for
  the whole set. Original file bytes are never stored.
- `folders` — reserved for a future "last-opened folder name" UX nicety; declared but unwired
  (see above).

## Known, documented Phase 1 characteristics (not bugs)

- Thumbnails/previews only, never original file bytes — the full-size viewer is not
  pixel-perfect against the original file.
- HEIC/HEIF: EXIF metadata used fully; thumbnail/preview image rendering falls back to a
  placeholder icon on browsers other than Safari (no in-browser HEIC decode support there yet).
- No delete "tombstone": caching is per-file, not per-folder, so re-selecting the same folder
  after deleting a photo re-adds that photo.
- GPS coordinates of exactly `(0, 0)` ("Null Island") are treated as no-GPS.
- If IndexedDB fills up mid-import, remaining not-yet-processed files in that batch stop being
  persisted (surfaced in the status panel) but continue to be parsed/shown for the session.
- No EXIF-orientation-based pixel rotation is applied to generated thumbnails/previews; the
  `orientation` field is captured and stored but unused for rendering. Not required by any
  acceptance criterion for this change; flagged as a possible future improvement.
- The synthetic HEIC test fixture (`test/fixtures/with-gps-and-datetime.heic`, produced via
  ImageMagick) round-trips correctly through `exiftool` but `exifr` cannot parse its EXIF box
  ("Malformed EXIF data") — an encoder-conformance quirk of that specific synthetic file, not a
  real-world code path. The HEIC extraction test mocks `exifr.parse()`'s output instead; the
  fixture file itself is kept in the repo for documentation/manual-testing purposes.

## Testing

Vitest (jsdom environment) + Testing Library for React component tests. Run via `npm test`
(single run) or `npm run test:watch`. As of this change: 9 test files, 75 tests, all passing.

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
- `exifWorkerPool.test.ts` — work distribution, progress tracking, cancellation.
- `db.test.ts` — IndexedDB repository behavior, including quota-exceeded handling and
  no-tombstone re-add after delete (uses `fake-indexeddb`).
- `ingest.test.ts` — cache-hit skips re-parsing unchanged files; changed files re-parse.
- `photoStore.test.ts` — Zustand store state transitions.
- `stableId.test.ts` — deterministic per-file cache-key hashing.
- `components.test.tsx` — thumbnail strip sorting/deletion, full-size viewer, status panel,
  privacy note, inert login placeholder.

Not practical to automate in this environment, left as a manual checklist instead: real
cross-browser drag-and-drop/folder-picker behavior, Leaflet map bounds-fitting in a live
browser, large-set (1000+ photos) performance, and visual heatmap density inspection. See the
Phase 1 plan's Testing information section in `docs/plans.md` for the full manual checklist.

Also verified for this change: `npx tsc --noEmit` clean; `npm run build` succeeds and produces a
separately-chunked `exifWorker` bundle (confirms Vite splits the worker out correctly); `npm run
dev` boots and serves the app; a manual grep of `src/` confirms no `fetch`/`XMLHttpRequest`/
`axios` calls exist anywhere outside Leaflet's own OSM tile requests.

# Backend (Phase 2 — accounts, PHP + MySQL)

A completely standalone project at `backend/`, with its own `composer.json`, its own tests, and
its own README. Nothing here is reachable from or referenced by the frontend project above yet.

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
the full API table, and a copy-pasteable curl walkthrough.

Other scripts:

```bash
composer test               # phpunit — 92 tests (46 Unit + 46 Feature)
bash scripts/smoke-test.sh http://localhost:8000   # runnable curl walkthrough (requires curl, jq)
```

An optional `docker-compose.yml` (`backend/docker/Dockerfile`, `backend/docker/init.sql`) is
included purely as dev/test convenience for environments without native PHP/MySQL — it is not
part of the documented/required way to run this project, which is the plain `php -S` command
above against a local MySQL instance.

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
  public/index.php                 Front controller — the only web-root-reachable file
  src/
    Config.php                     Reads/validates .env-derived settings
    Database.php                   PDO connection factory (ERRMODE_EXCEPTION, no emulated prepares)
    Session.php                    Native PHP session bootstrap; HttpOnly/SameSite=Lax cookie,
                                    Secure gated by APP_ENV=production; CSRF token seeding
    Bootstrap.php                  Wires dependencies and routes together
    Http/
      Request.php, Response.php, JsonResponse.php
    Routing/
      Router.php                   Hand-rolled method+regex path matcher -> handler
    Middleware/
      AuthMiddleware.php            Rejects unauthenticated requests to protected routes
      CsrfMiddleware.php            Verifies X-CSRF-Token via hash_equals() on every
                                    POST/PUT/PATCH/DELETE route, including register/login
    Controllers/
      AuthController.php           register, login, logout, csrfToken, me
      AccountController.php        DELETE /api/account (transactional row+file cascade delete)
      PhotosController.php         index, store (upload pipeline), destroy
      MediaController.php          Signed-URL image/thumbnail byte streaming
      ShareLinksController.php     store (rotate: revoke-old-then-create-new), destroy (revoke)
      ShareController.php          Public show(token) — read-only, respects revoked_at
      GeocodeController.php        Cache-first Nominatim proxy
    Repositories/
      UserRepository.php, PhotoRepository.php, ShareLinkRepository.php,
      GeocodeCacheRepository.php, LoginAttemptRepository.php   (all parameterized PDO)
    Services/
      ImageProcessor.php           GD: EXIF-orient, resize <=2000px q85, thumbnail 320px q80,
                                    no-upscale, alpha-flatten-to-JPEG, corrupt-image rejection
      FileValidator.php            finfo real-content-type + size checks (never trusts extension
                                    or client-supplied MIME type)
      StorageQuotaService.php      Row-locked reserveAndInsert() — quota check + photo insert in
                                    one transaction, race-safe under concurrent uploads
      RateLimiter.php              Failed-login throttling, per-account + per-IP
      SignedUrl.php                HMAC sign/verify for owner (15 min) and share (10 min)
                                    context media URLs
      NominatimClient.php          ext-curl client with a proper User-Agent
      GeocodeClientInterface.php   Interface NominatimClient implements; tests use a fake instead
      NominatimRateLimiter.php     DB row-lock (SELECT ... FOR UPDATE) global 1 req/sec spacing,
                                    using a DOUBLE (microtime) timestamp column for sub-second
                                    precision (see "Deviations" in the Phase 2 plan)
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
    smoke-test.sh                  Runnable copy of the README's curl walkthrough
  tests/
    bootstrap.php, FakeGeocodeClient.php
    fixtures/                      Real sample images: corrupted, non-image-as-.jpg, small/large/
                                    tiny JPEGs, a WebP, a PNG with alpha
    Unit/                          CsrfMiddleware, FileValidator, GeocodeController, ImageProcessor,
                                    NominatimClient, NominatimRateLimiter, RateLimiter, SignedUrl,
                                    StorageQuotaService (46 tests)
    Feature/                       Auth, Csrf, Geocode, Ownership, Photos, ProductionCookie,
                                    Quota, RateLimit, SecurityFeature, ShareLinks (46 tests) — each
                                    boots a real `php -S` subprocess and drives it over real HTTP
    Support/                       ServerProcess (subprocess lifecycle), HttpClient/HttpResponse
                                    (curl wrapper), DatabaseTestCase/FeatureTestCase (base classes),
                                    FakeHttpServer, concurrent_upload_worker.php (real multi-process
                                    concurrency test for the quota row-lock),
                                    nominatim_lookup_worker.php
  composer.json, composer.lock
  .env.example, .env.test, .gitignore
  README.md                        Standalone run instructions, API table, curl walkthrough
  docker/ (Dockerfile, init.sql), docker-compose.yml   Optional dev/test convenience only
```

## Data model (MySQL)

- `users` — id, `email` (unique), `password_hash`, `created_at`.
- `photos` — id, `user_id` (FK, `ON DELETE CASCADE`), `storage_path`, `thumbnail_path`,
  `file_size_bytes` (backs the quota `SUM()` query), `lat`/`lon` (nullable), `taken_at`
  (nullable), `camera_make`, `camera_model`, `created_at`; indexed on `user_id`.
- `share_links` — id, `user_id` (FK, `ON DELETE CASCADE`), `token` (unique), `created_at`,
  `revoked_at` (nullable); indexed on `user_id` and `token`.
- `geocode_cache` — PK `(lat_rounded, lon_rounded)`, `place_name` (nullable — caches an explicit
  "no result" too), `fetched_at`.
- `login_attempts` — id, `email`, `ip_address`, `succeeded`, `created_at`; indexed on
  `(email, created_at)` and `(ip_address, created_at)`. Backs failed-login rate limiting.
- `nominatim_rate_limit` — single sentinel row; `last_request_at` is a `DOUBLE` (microtime), not
  a `DATETIME`, for sub-second precision (a deliberate deviation from the plan — see
  `docs/plans.md`).

File paths are `SELECT`ed inside the same transaction as a DB delete, and files are `unlink()`'d
only after the transaction commits.

## Known, documented Phase 2 characteristics (not bugs)

- Account deletion ends only the current session; it does not invalidate other active sessions
  for the same account elsewhere (no cross-session store exists in this design).
- The session cookie's `Secure` flag is gated by `APP_ENV=production`; `APP_ENV=local` (needed
  for plain-HTTP `php -S`) is a documented dev-only exception.
- No orphan-file cleanup job; `unlink()` failures are best-effort, with the DB row treated as
  authoritative.
- `X-Forwarded-For` is not trusted for the login rate limiter's IP address — out of scope, since
  the deliverable is explicitly local-dev/direct-connection only.
- `PATCH /api/photos/{id}` (drag-to-reassign location) is not implemented — explicitly deferred
  to Phase 3 per the original request's own text.
- WebP uploads are rejected at runtime with `422 webp_unsupported` (not a crash) if the GD build
  lacks WebP support; JPEG/PNG are unaffected either way.
- `scripts/migrate.php` does not wrap each migration in a PDO transaction, since MySQL DDL causes
  an implicit commit that makes an explicit transaction a no-op (and previously caused a spurious
  rollback error); a failed migration aborts the script before being recorded as applied.

## Testing

PHPUnit 10. Run via `composer test` from `backend/`. As of this change: **92 tests, 213
assertions, 0 failures** (46 Unit + 46 Feature), run twice for confirmation including once after
a from-scratch container/database rebuild.

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
  enforcement on every state-changing endpoint, upload validation, cross-account ownership
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
  unauthenticated-401 path for that endpoint.
- Also verified: `php scripts/migrate.php` is idempotent and works against a genuinely fresh
  database; `bash scripts/smoke-test.sh` passes all 12 steps against a real `php -S` dev server
  (register -> login -> upload-with-metadata -> list -> signed preview URL serves real JPEG bytes
  -> create share link -> fetch share + its image with zero cookies -> delete photo -> revoke
  share link (confirms 404 on the share, 403 on its previously-fetched image URL) -> delete
  account (confirms subsequent `/api/me` is 401) -> confirm `storage/` is not web-reachable);
  `php -l` clean on every `src/`, `tests/`, `scripts/`, `public/` file.
