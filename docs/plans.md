# Photomap — Plans

Change plans are appended here in full, most recent last.

---

# Photomap Phase 1 — Guest Mode (Frontend-Only Map & Timeline) - 2026-09-03 23:22 BST

## Context of the changes

Photomap's value proposition is letting someone drop a folder of their own photos onto a map and timeline and immediately see *where* and *when* they were taken, with a strong, explicit privacy guarantee in this first phase: your photo data never leaves the browser. Phase 1 builds the entire guest-mode experience — there is no login, no server, no accounts yet; the username/password fields and Login/Register control in the top banner are purely a visual placeholder for what Phase 2/3 will wire up, and must not pretend to work (no fake success states, no silent no-ops that look like a real login).

The primary user is a single person browsing their own personal photo library (likely one full of camera-roll exports, phone backups, or messaging-app downloads) who wants two connected views of the same data: a map (spatial) and a timeline (temporal), kept in sync with each other — clicking the timeline filters the map, and photos flow between "has GPS" and "no GPS" without ever being deleted from state. The product's honesty about partial data matters here: per first_research.md, a large fraction of real-world photos (WhatsApp/Telegram/Instagram exports, iPhones with location denied) will have a date but no coordinates, so the "N without GPS, still viewable via timeline" behavior is not an edge case to bolt on later — it is core, everyday behavior that must work as well as the GPS path.

Three areas compose a single page: banner (branding + inert auth placeholder), map (the primary surface, with upload affordances and a live status panel), and a bottom timeline strip (a custom-built density heatmap bar, since research confirmed no drop-in widget does exactly this). These three areas are tightly coupled: uploading photos populates both map and timeline from the same underlying photo set; filtering via the timeline narrows what's shown on the map and opens a matching thumbnail strip; deleting a photo from either the marker popup or the full-size view immediately updates both surfaces. IndexedDB caching means a returning user re-opening the same folder should not have to wait through a full re-parse — this is a meaningful UX promise (fast re-open), not just a technical nicety, and testers should verify it materially skips re-parsing rather than just "still works."

Reverse geocoding is deliberately **omitted in Phase 1** (see Deep Dives) — the full-size photo view will show only the datetime overlay, no place name, in this phase. This keeps the guest-mode promise unambiguous: the sole allowed exception to "photos never leave the browser" (an on-demand geocode lookup) is removed entirely for now, and can be revisited once Phase 2's server-side proxy exists to do it properly and compliantly.

**Privacy guarantee — precise scope (resolved during advisor review):** The "your photos never leave this device" guarantee applies specifically to photo data: image bytes, EXIF metadata, filenames, and GPS coordinates are never transmitted anywhere. It does NOT and cannot extend to map basemap tile requests: the spec mandates Leaflet + OpenStreetMap tiles, and any online slippy map inherently issues per-pan/zoom HTTP requests to the OSM tile server to fetch tile images for the current viewport. This is a known, disclosed, unavoidable consequence of the mandated stack, not a violation of the privacy promise — no photo bytes, EXIF, filenames, or coordinates of individual photos are included in a tile request (only generic map tile x/y/z indices for whatever area is currently in view). The on-screen privacy banner text itself ("Guest mode: your photos never leave this device.") remains accurate as-is and unchanged — it is a true statement about photo data. The README/docs should note this tile-request nuance explicitly so it's never mistaken for a bug or scope creep later. All "zero network calls" acceptance criteria below are scoped to "zero network calls involving photo data" — OSM tile fetches for basemap rendering are the sole, expected exception, alongside normal dev-time requests (npm registry, Vite HMR, etc.).

## Acceptance criteria

- Top banner shows "Photomap" wordmark on the left; username/password fields and a Login/Register control are visible (or behind a clearly-labeled "coming soon" affordance) on the right but produce no network calls and no functional login state change when interacted with.
- Persistent, visible privacy note reading "Guest mode: your photos never leave this device." is present at all times, not just on first load.
- User can select a folder via `<input type="file" webkitdirectory multiple>` and via drag-and-drop of a folder onto the map area; both trigger the same parsing pipeline.
- EXIF parsing runs off the main thread (Web Worker); a progress bar advances during parsing and the UI (map panning/zooming, other controls) remains responsive while a large folder is being processed.
- Status panel shows, live and updated as parsing proceeds: total photos processed, count with usable GPS, count without usable GPS. Photos without GPS are never removed from application state — only excluded from map markers. Files that fail to parse entirely (corrupted, non-image, unreadable) are excluded from all three counts and are not treated as "without GPS"; they may optionally be surfaced as a small separate "skipped/unreadable" indicator, but this is not required for Phase 1 sign-off.
- GPS validity rule: treat exact `(0, 0)` coordinates ("Null Island") as invalid/no-GPS, not as a real location — some cameras/exporters write zeroed GPS tags as a bug/placeholder rather than omitting them. Any other parsed lat/lon pair is treated as usable GPS.
- Photos with GPS are grouped into one marker per location using ~50m coordinate rounding (using a latitude-corrected grid, not naive fixed-decimal rounding, since longitude degrees shrink with cos(latitude)); a marker's popup shows a thumbnail strip of every photo at that location sorted chronologically, each labeled with its datetime.
- Markers use Leaflet.markercluster so that dense clusters (e.g., many photos in one city) collapse into cluster markers rather than overlapping pins.
- The bottom timeline is a custom canvas/SVG component spanning from the earliest to latest photo date in the current set (or the current year if no photos are loaded), rendering a density heatmap bar (visually denser/taller where more photos exist for that period).
- Clicking a segment of the timeline filters the map to show only markers whose photos fall in that date range, and opens a thumbnail strip of just the matching photos (including ones without GPS, reachable this way).
- Photos with no GPS are reachable and viewable from the timeline/thumbnail strip flow even though they never appear on the map itself.
- Clicking any thumbnail opens a full-size view with a semi-transparent overlay banner showing the photo's datetime. No place name / reverse geocoding in Phase 1 — no raw lat/long is ever shown to the user as a label either.
- Both the thumbnail strip and the full-size view expose a delete action; deleting removes the photo from IndexedDB and in-memory state, and the map and timeline update immediately (marker count/thumbnail strip shrinks, marker removed entirely if it was the only photo there, timeline density bar recalculates). Deletion is a simple removal from the current cache/state — there is no persistent "tombstone" of deleted files; if the user later re-selects the same folder, a previously-deleted file will be re-parsed and reappear, since Phase 1 has no folder-level identity to track exclusions against.
- Map bounds auto-fit to the current set of markers whenever the photo set changes (initial load, delete, or any other mutation) — a pure timeline-filter view fits to the filtered subset rather than the whole set, and should not leave the map static/empty-looking when a filter yields zero mapped photos (implementer's call on exact empty-state treatment, e.g. keep prior view or show a small "no photos with a location in this range" hint).
- Re-opening a previously-parsed folder loads cached metadata/derived images from IndexedDB and visibly avoids a full re-parse (e.g., much faster completion, no full progress-bar sweep) for files already cached (matched by stable per-file id).
- Zero network calls involving photo data (bytes, EXIF, filenames, GPS coordinates) are ever made in this phase. The sole expected network activity is OpenStreetMap basemap tile requests (inherent to the mandated Leaflet+OSM stack) plus normal dev-tooling traffic (npm install, Vite dev server/HMR) — both disclosed in the README.
- HEIC/HEIF files: EXIF metadata (GPS/datetime) is extracted normally via exifr and such photos participate fully in map/timeline placement; thumbnail/preview image rendering may fall back to a generic placeholder icon where browser decode support (createImageBitmap) is unavailable (e.g. Chrome/Firefox), since only Safari can decode HEIC in-browser today. This is a documented Phase 1 limitation, not a bug.
- Storage quota handling: if an IndexedDB write fails with `QuotaExceededError` during ingest, stop persisting further not-yet-processed files in the current batch to IndexedDB, but continue parsing and displaying them in-memory for the current session (map/timeline/status panel keep working), and surface a clear, visible message in the status panel explaining that storage is full and further photos won't survive a page reload.
- Runnable via `npm install && npm run dev`; README includes a short section on how to run it, plus the tile-request privacy nuance noted above.

## Architectural Impact

This is a greenfield build — docs/architecture.md currently only sketches the three-phase shape at a high level and has no code to contradict. This change is the actual foundation: a single Vite + TypeScript + React project at the repo root implementing Phase 1 (guest mode) in a way that leaves clean seams for Phase 2 (PHP/MySQL backend) and Phase 3 (wiring accounts + remaining features) without rework.

**Project layout / module boundaries** (new, under /home/andrea/workspace/photomap/):
- `src/types/photo.ts` — the shared domain model, `PhotoRecord`, deliberately field-named to closely mirror the concepts in the future Phase 2 `photos` table (`lat`, `lon`, `takenAt`/`taken_at`, `cameraMake`/`camera_make`, `cameraModel`/`camera_model` — same concepts, camelCase in TypeScript vs. snake_case in the future DB schema) so mapping to/from the future JSON API in Phase 3 is close to 1:1.
- `src/lib/db/` — the only module allowed to talk to IndexedDB directly (via the `idb` package). Exposes a `PhotoRepository` **interface** (`list()`, `add()`, `remove()`, `updateLocation()`, `getBlob(id, 'thumbnail'|'preview')`) with an `IndexedDbPhotoRepository` implementation. This interface is the seam Phase 3 needs: a future `ApiPhotoRepository` implements the same shape against `GET/POST/DELETE/PATCH /api/photos`, and the rest of the app never notices which one it's using.
- `src/workers/exifWorker.ts` — a dedicated Web Worker (Vite native `new Worker(new URL(...), { type: 'module' })`) that owns the whole per-photo pipeline: `exifr.parse()` for metadata, then `createImageBitmap` + `OffscreenCanvas` to generate a thumbnail (~200px) and a preview (~1600–2000px, quality ~80, deliberately matching Phase 2's planned resize defaults for consistency). Keeping decode/resize in the worker (not just EXIF parsing) is the key decision — it's what actually keeps the main thread responsive on large folders.
- `src/lib/ingest/` — orchestrates folder-picker/drop-zone input into the worker, applies the cache-key check before dispatching work, batches worker messages, and writes results into the repository + store.
- `src/lib/geo/` — coordinate rounding for marker grouping (`groupKey`). (Geocoding client is deferred — omitted entirely in Phase 1.)
- `src/lib/state/` — a Zustand store, chosen over Context because photo counts run into the hundreds/thousands with frequent progress updates, and selector-based subscriptions avoid re-rendering the map/timeline on every tick. Holds `photos: Map<id, PhotoRecord>`, ingest status/progress, the active timeline filter range, and the selected-photo id for the viewer. Marker groups and timeline histograms are derived via memoized selectors, not stored redundantly.
- `src/components/{TopBanner,UploadControl,StatusPanel,MapView,Timeline,PhotoViewer}/` — presentational/interaction components, each depending only on the store and `PhotoRepository`, never on IndexedDB or the worker directly.

**Data model & IndexedDB shape.** Two derived image sizes are stored per photo — `thumbnail` and `preview` — **never the original file bytes**. Original files (especially HEIC/RAW from phones) can be many MB each, and thousands of them would blow through browser storage quotas fast. A resized preview (~1600–2000px, quality ~80, matching Phase 2's future server-side sizing) is what the full-size viewer displays and is visually sufficient for a map/timeline tool; this means the full-size view is not pixel-perfect against the original file, an accepted tradeoff that should be noted as a known characteristic in the README, not a bug. IndexedDB (`photomap-guest` DB) has three stores: `photoMeta` (small, queried on every load — id, EXIF fields, groupKey), `photoBlobs` (id → {thumbnail, preview} blobs, loaded lazily on demand, not eagerly for the whole set), and an optional `folders` store (id → last-opened folder name, purely a UX nicety, not load-bearing for correctness).

**Cache key strategy.** `<input webkitdirectory>` and drag-and-drop give no stable OS-level folder identity, so "reopening the same folder" is detected **per file**, not per folder: `id = hash(webkitRelativePath, file.size, file.lastModified)`. On every pick/drop, this id is computed synchronously (cheap, no bytes read) for every file and checked against `photoMeta` before anything is sent to the worker. This degrades gracefully for partial folder changes (a few new/removed files) rather than requiring an all-or-nothing folder fingerprint match, at the accepted cost of a rare false-cache-hit if a file is edited in place while preserving size and mtime exactly. Because deletion simply removes a record from `photoMeta`/`photoBlobs`, re-selecting the same folder after a delete will recompute the same id, find no cache entry, and re-parse + re-add that file — this is expected, documented behavior, not a bug.

**Marker grouping vs. clustering — two distinct layers.** `groupKey` (rounding lat/lon to ~50m, latitude-corrected) folds multiple photos taken at the same spot into one logical marker with a chronological thumbnail-strip popup — this is our own data-layer concern. `Leaflet.markercluster` then clusters those location-markers visually as the map zooms out. These solve different problems and should not be conflated in implementation.

**Risks specific to Phase 1:**
- **Storage quota.** Thumbnail+preview blobs (no originals) for a few thousand photos should stay well within typical browser IndexedDB quotas, but very large imports (many thousands of photos) can still approach limits, especially on Safari/iOS. Mitigate with `navigator.storage.estimate()` surfaced in the status panel and a `navigator.storage.persist()` request. No hard photo-count cap is enforced in Phase 1; behavior beyond typical personal-library sizes (hundreds to a few thousand photos) is best-effort. See the quota-exceeded handling in Acceptance Criteria.
- **HEIC decode gap.** Handled via placeholder-icon fallback, per acceptance criteria above.
- **Worker message volume / memory spikes.** Thousands of individual postMessage round-trips add overhead; batch progress updates and bound in-flight decodes via a small worker pool (2–4 workers, capped by `navigator.hardwareConcurrency`) rather than firing all files at once.
- **Object URL lifecycle.** Blobs surfaced via `URL.createObjectURL()` for the map/timeline/viewer need explicit revocation on photo deletion and on an LRU basis for the thumbnail strip, or memory grows unbounded during a long session.

## Code changes

Stack / dependency versions:
- `vite` + `@vitejs/plugin-react`, `typescript`, `react` + `react-dom` — latest stable, well-established major versions.
- `exifr` for EXIF/GPS/datetime parsing.
- `leaflet` + `@types/leaflet`, `leaflet.markercluster` (no first-party TS types — small ambient module declaration `src/types/leaflet.markercluster.d.ts`).
- `idb` (thin Promise wrapper over IndexedDB).
- `zustand` for global state.
- Dev: `vitest` for unit tests on non-visual logic (grouping math, timeline binning, worker pool, IndexedDB helpers).

Project scaffold: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `README.md` (with a "Running the frontend" section: `npm install && npm run dev`, noting this is Phase 1 — guest mode only, no backend — plus the tile-request privacy nuance), `src/main.tsx`, `src/App.tsx`, `src/App.css`.

File/module breakdown: `src/types.ts` (`PhotoRecord`, `MarkerGroup`, worker message types), `src/types/leaflet.markercluster.d.ts`, `src/state/photoStore.ts` (zustand), `src/lib/db.ts` (idb wrapper, three stores, `estimateUsage()`, quota handling), `src/lib/stableId.ts` (FNV-1a hash), `src/workers/exifWorker.ts` (exifr + createImageBitmap/OffscreenCanvas, Null Island rule, HEIC fallback), `src/lib/exifWorkerPool.ts` (2–4 worker pool, cancellation), `src/lib/grouping.ts` (latitude-corrected `gridKey`, `computeMarkerGroups`), `src/components/TopBanner.tsx`, `src/components/UploadControl.tsx`, `src/components/StatusPanel.tsx`, `src/components/MapView.tsx` (imperative Leaflet + markercluster), `src/components/TimelineStrip.tsx` (custom canvas heatmap), `src/components/PhotoThumbStrip.tsx`, `src/components/FullSizeViewer.tsx`, `src/components/PrivacyNote.tsx`.

Trickiest implementation details: worker pool progress tracking + cancellation; IndexedDB caching semantics (per-file stable id, not per-folder; previews/thumbnails ARE persisted as blobs so the full app works from IndexedDB alone after a page reload without re-picking a folder — only re-parsing of unchanged files is skipped); latitude-corrected coordinate rounding for grouping; Null Island filtering; canvas timeline hit-testing and adaptive binning; object URL lifecycle management; QuotaExceededError handling mid-batch.

Estimated complexity: Highest — `TimelineStrip.tsx` and `MapView.tsx`. Medium — worker pool + protocol, IndexedDB schema/hydration, grouping math. Low — `TopBanner`, `StatusPanel`, `PrivacyNote`, `UploadControl`.

## Testing information

Vitest (jsdom for DOM-adjacent code, Node for pure logic/exifr parsing) plus Testing Library for React component-level tests. `npm test` added to `package.json` and documented in the README.

Fixtures directory (`test/fixtures/`) of real sample images with varied EXIF: JPEG with GPS+DateTimeOriginal; JPEG with datetime only, no GPS; JPEG with GPS but no OffsetTimeOriginal; a HEIC sample; a corrupted/truncated JPEG; a non-image file renamed `.jpg`; two JPEGs just inside/outside the ~50m grouping radius (haversine-verified); a JPEG with GPS exactly (0,0) for the Null Island rule.

Coverage: EXIF parsing (valid GPS+datetime, datetime-only, Null Island, corrupted/non-image handling, HEIC metadata-with-degraded-thumbnail, missing OffsetTimeOriginal); coordinate grouping (boundary cases via haversine, high-latitude behavior); marker popup/thumbnail strip rendering; no-GPS handling and status-panel count consistency; timeline binning/intensity/range-selection as pure functions plus zero-photos/current-year default and single-day vs. multi-year spans; map bounds fitting behavior; IndexedDB caching (cache-hit skips re-parse, changed file re-parses, no-tombstone re-add after delete, QuotaExceededError graceful degradation); delete flow updating IndexedDB/state/map/timeline immediately; full-size view datetime rendering with no geocoding calls; manual checklist for performance/cross-browser items not executable in a headless environment.

Definition of done: `npm install && npm run dev` runs with no build errors, README documents it plus the tile-request privacy nuance; all three layout areas present and match spec; zero network calls involving photo data anywhere in the app; automated test suite passes; manual checklist run to the extent practical, with gaps noted.

# Deep Dives

**Q (product owner): Should Phase 1 implement a throttled public geocoder call for place names, or omit it entirely?**
A: Omit entirely in Phase 1. Browser `fetch()` cannot set a custom `User-Agent` header (forbidden header per the Fetch spec), which is exactly the header Nominatim's usage policy cares about most — so Phase 1 cannot honor that policy no matter how conservatively it throttles. The full-size view shows datetime only; reverse geocoding is deferred to Phase 2's planned server-side proxy (`GET /api/geocode`).

**Q (product owner / tester): How should HEIC/HEIF photos be handled given they're common on iPhones but not mentioned in the original scope?**
A: Extract EXIF metadata normally (exifr supports HEIC/HEIF metadata parsing across browsers) so these photos participate fully in map placement and timeline inclusion. Thumbnail/preview rendering depends on `createImageBitmap` HEIC decode support, which today only works reliably in Safari; on Chrome/Firefox, fall back to a generic placeholder icon. Documented Phase 1 limitation.

**Q (product owner / architect): Is there a numeric performance/scale target Phase 1 should design and test against?**
A: No hard target. Design for a typical personal photo library (hundreds to a few thousand photos) via Web Worker parsing, a bounded worker pool, and storing only resized thumbnail/preview blobs (never originals). Behavior beyond that scale is best-effort, mitigated by `navigator.storage.estimate()`/`persist()`.

**Q (tester): When the same folder is re-opened after a photo was deleted, should the deleted photo reappear or stay deleted?**
A: It will reappear. Deletion removes the record from IndexedDB; caching is keyed per-file, not per-folder, so there is no exclusion list tracking deliberately-deleted files. Documented, expected Phase 1 behavior.

**Q (tester): What exactly counts as "processed" in the status panel — does it include files that fail to parse entirely?**
A: No. "Processed" = successfully parsed image files, split into withGPS/withoutGPS. Files that fail to parse are excluded from all three counts, caught by the worker's `error` message type.

**Q (tester): What is the concrete grouping rule for "~50m"?**
A: Latitude-corrected grid bucketing: `latStep = cellMeters/111320`, `lonStep = cellMeters/(111320*cos(lat*π/180))`, avoiding the naive-rounding failure mode at higher latitudes.

**Q (tester): What throttling interval/strategy is intended for the geocoder calls?**
A: Moot — geocoding is omitted entirely in Phase 1.

**Q (tester): Is mobile browser support in scope for Phase 1?**
A: Not required. Desktop Chrome/Firefox/Safari only.

**Q (developer / architect): Should IndexedDB cache full-resolution original photo bytes, or only derived thumbnail + preview images?**
A: Thumbnail + preview only — never original bytes, to bound storage growth. Matches Phase 2's planned server-side resize target. Full-size view is not pixel-perfect against the original — an accepted, documented tradeoff.

**Q (advisor): Does the "zero network calls" acceptance criterion contradict the mandated Leaflet + OpenStreetMap tile stack?**
A: Yes — the wording was overbroad and corrected to scope the guarantee to photo data only; OSM basemap tile requests are a disclosed, expected, unavoidable exception.

**Q (advisor): Should exact (0,0) GPS coordinates be treated as valid GPS or as "no GPS"?**
A: Treat as no-GPS ("Null Island" sentinel).

**Q (advisor): What happens to files still queued in the current ingest batch when an IndexedDB write hits QuotaExceededError?**
A: Stop persisting further files in that batch, but keep parsing/displaying them in-memory for the session; surface a clear status-panel message.

---

# Phase 2 — Accounts Backend (PHP + MySQL) - 2026-09-04 (FINAL, revised after advisor review)

This is a standalone Photomap backend build. Photomap Phase 1 (guest mode, frontend-only) already exists at the repo root (`/home/andrea/workspace/photomap/src/`, etc.) and is DONE — frontend code was not touched. This change adds a brand-new, fully self-contained PHP+MySQL backend project at `/home/andrea/workspace/photomap/backend/`. There is NO frontend integration in this phase (that is Phase 3, a separate future change) — this backend works and is tested entirely on its own via curl/PHPUnit.

## Environment note
This sandbox has no PHP, Composer, or MySQL installed natively, and `sudo` requires an interactive password. Docker is installed and works without sudo. The implementer used Docker (php:8.3-cli with pdo_mysql/gd/exif/mbstring extensions, plus mysql:8) to build, run, and test this backend end-to-end. A `docker-compose.yml` at `backend/` is included as optional dev/test convenience, clearly labeled as such — the README's primary documented path remains the plain `php -S localhost:8000 -t public public/index.php` against a local MySQL instance, since that's what's explicitly required for someone with PHP/MySQL natively installed.

## Directory structure (authoritative)

```
backend/
  public/index.php                     # front controller, only web-root-reachable directory
  src/
    Config.php, Database.php, Session.php, Bootstrap.php
    Http/Request.php, Http/Response.php, Http/JsonResponse.php
    Routing/Router.php                 # hand-rolled method+regex path matcher -> handler
    Middleware/AuthMiddleware.php, Middleware/CsrfMiddleware.php
    Controllers/AuthController.php     # register, login, logout, csrfToken, me
    Controllers/AccountController.php  # DELETE /api/account
    Controllers/PhotosController.php   # index, store, destroy
    Controllers/MediaController.php    # signed-URL image/thumbnail streaming
    Controllers/ShareLinksController.php  # store (rotate), destroy (revoke)
    Controllers/ShareController.php    # public show(token)
    Controllers/GeocodeController.php  # geocode proxy
    Repositories/UserRepository.php, PhotoRepository.php, ShareLinkRepository.php, GeocodeCacheRepository.php, LoginAttemptRepository.php
    Services/ImageProcessor.php        # GD: EXIF-orient, resize 2000px q85, thumbnail 320px q80
    Services/FileValidator.php         # finfo real-content-type + size checks
    Services/StorageQuotaService.php   # per-account usage (100MB), row-locked check
    Services/RateLimiter.php           # failed-login throttling, per-account + per-IP
    Services/SignedUrl.php             # HMAC-sign/verify media URLs
    Services/NominatimClient.php, GeocodeClientInterface.php, NominatimRateLimiter.php
    Services/PhotoPresenter.php
  storage/                              # OUTSIDE public/, never web-reachable
    photos/{user_id}/{random32hex}.jpg
    thumbnails/{user_id}/{random32hex}.jpg
  migrations/0001_create_users.sql ... 0006_create_nominatim_rate_limit.sql
  scripts/migrate.php                  # CLI runner, tracks applied filenames in schema_migrations
  tests/
    fixtures/, Unit/, Feature/, FakeGeocodeClient.php, Support/ (ServerProcess, HttpClient, concurrent_upload_worker)
  composer.json, composer.lock
  .env.example, .env.test
  .gitignore
  README.md                            # standalone run instructions + curl smoke script
  docker/ (Dockerfile, init.sql), docker-compose.yml   # OPTIONAL dev/test convenience only
  scripts/smoke-test.sh                # runnable curl walkthrough
```

Naming standardized throughout: env var `MAX_UPLOAD_BYTES` (not `UPLOAD_MAX_BYTES`), storage subdirectory `storage/thumbnails/` (not `storage/thumbs/`), migration runner at `backend/scripts/migrate.php` (not `backend/migrate.php`).

## Dependencies
Router: hand-rolled, not Slim. Image processing: raw `ext-gd`, not Imagick/Intervention. HTTP client for Nominatim: raw `ext-curl` behind a `GeocodeClientInterface` (tests inject a fake — never call real Nominatim in automated tests). `.env` loading: `vlucas/phpdotenv`. Everything else: raw PDO, no ORM, no migration library. Dev: `phpunit/phpunit` ^10.

## Database schema (migrations)
- `users`: id PK, `email UNIQUE`, `password_hash`, `created_at`.
- `photos`: id PK, `user_id` FK CASCADE, `storage_path`, `thumbnail_path`, `file_size_bytes` (added — needed for cheap quota `SUM()`), `lat`/`lon` nullable, `taken_at` nullable, `camera_make`/`camera_model`, `created_at`, index on `user_id`.
- `share_links`: id PK, `user_id` FK CASCADE, `token UNIQUE`, `created_at`, `revoked_at` nullable, indexes on `user_id`/`token`.
- `geocode_cache`: PK `(lat_rounded, lon_rounded)`, `place_name` nullable (caches explicit "no result"), `fetched_at`.
- `login_attempts` (added — needed for rate limiting): id, email, ip_address, succeeded, created_at, indexed on `(email, created_at)` and `(ip_address, created_at)`.
- `nominatim_rate_limit` (added — needed for the global limiter): single sentinel row; implemented with a `DOUBLE` (microtime) timestamp column instead of `DATETIME` for sub-second precision (deviation — see implementer's report).

FKs use `ON DELETE CASCADE`; file paths are SELECTed before DB deletes (inside the same transaction) so physical files can be `unlink()`'d after commit.

## Session, CSRF, auth mechanics
Native PHP sessions; cookie flags HttpOnly, SameSite=Lax, Secure gated by `APP_ENV=production` (documented dev-only exception for plain-HTTP `php -S`). `session_regenerate_id(true)` + CSRF token rotation on login. `GET /api/csrf-token` (public) seeds/returns the session's CSRF token; `X-CSRF-Token` header required via `hash_equals()` on every POST/PUT/PATCH/DELETE route **including register and login** (the original spec requires CSRF on every state-changing call with no exemption). `password_hash(PASSWORD_DEFAULT)`/`password_verify()`, minimum 8-char password, `password_needs_rehash()` on login. Login failures return an identical generic error for unknown-email vs wrong-password, including a dummy `password_verify()` call on unknown emails (timing-based user-enumeration defense). Failed-login rate limiting: 5 failures/account/15min and ~20/hour/IP (both env-configurable), logged to `login_attempts`. Added `GET /api/me` (auth required) so a client with a live session cookie can learn it's authenticated without resubmitting credentials — needed for Phase 3's page-load auth-restore flow, not explicitly in the original endpoint list but necessary.

## Endpoints
`GET /api/csrf-token`, `GET /api/me`, `POST /api/register` (no auto-login), `POST /api/login`, `POST /api/logout`, `DELETE /api/account` (transactional row+file cascade delete; destroys only the current session — does not proactively invalidate other active sessions elsewhere, a documented limitation), `GET /api/photos`, `POST /api/photos` (multipart upload: size check → finfo real-content-type check against JPEG/PNG/WebP allow-list → WebP-runtime-support check with graceful `webp_unsupported` rejection if GD lacks it → EXIF-orientation-corrected resize to ≤2000px/quality 85 + 320px/quality-80 thumbnail, output always normalized to JPEG → race-safe quota check via row-level lock on the user + insert in one transaction, rejecting with `413 quota_exceeded` and no orphaned files if it would exceed the 100MB/account quota computed from actual on-disk bytes), `DELETE /api/photos/{id}` (404 not 403 on mismatched ownership, to avoid confirming other users' ids exist), `POST /api/share-links` (single-active-link "rotate" model: revoke-old-then-create-new, matching the spec's singular "this user's share token" wording), `DELETE /api/share-links/{id}` (soft-revoke only), `GET /api/share/{token}` (public, respects `revoked_at`, omits PII), `GET /api/photos/{id}/file` and `/thumbnail` (added — the signed/expiring-URL byte-serving endpoints required by the security spec; owner-context URLs valid 15 min, share-context URLs valid 10 min and **re-check `revoked_at` live on every fetch**, closing a gap the advisor flagged where a previously-issued share image URL would otherwise keep working for its full TTL after revocation), `GET /api/geocode?lat=&lon=` (requires an authenticated session; rounds to 4 decimals; cache-first with no TTL, including caching explicit "no result"; on a cache miss, serializes outbound Nominatim calls globally via a MySQL row lock — not filesystem `flock()` — so the 1 req/sec limit holds even across multiple PHP-FPM worker processes).

## Explicit decisions locked in (not re-litigated)
`PATCH /api/photos/{id}` (drag-to-reassign location) is explicitly NOT part of Phase 2 per the original request's own text ("it's not required in Phase 2") — deferred to Phase 3. Share-link rotation is single-active-link. Signed/expiring URLs (one of the two options the original spec explicitly names) are the chosen image-serving mechanism. Quota accounting is based on actual on-disk bytes (resized + thumbnail), race-safe under concurrency. GD not Imagick/Intervention. MySQL row lock not `flock()` for the Nominatim limiter. `password_hash(PASSWORD_DEFAULT)` (bcrypt) satisfies "bcrypt/argon2i". No auto-login after registration. Geocode requires auth. Rate-limit defaults 5/account/15min, ~20/hour/IP. Password minimum 8 chars. User-enumeration timing defense required. Thumbnail 320px/q80. Accept JPEG/PNG/WebP input (WebP gracefully rejected if unsupported at runtime), normalize output to JPEG. Orphan-file cleanup jobs and reverse-proxy `X-Forwarded-For` trust are out of scope. Rejected uploads: minimal operational logging only, never persisting rejected bytes/metadata. Account deletion terminates only the current session (documented limitation). The 100MB quota is enforced exactly as specified; whether it's permanent policy is a future product decision outside this phase.

## Deep Dives (open questions raised by product-owner/architect/developer/tester briefings, and by the advisor review, all resolved by the coordinator without needing to ask the user — grounded either in the original request's own literal wording, cross-agent consensus, or straightforward engineering judgment within the phase's stated scope)

1. **Share-link "create/rotate" semantics** — resolved as single-active-link (revoke-old-then-create-new), grounded in the original spec's singular wording "this user's share token."
2. **Image-serving mechanism** — resolved as signed/expiring HMAC URLs, one of two options the original spec explicitly names ("checks ownership (or a signed/expiring URL)"); later hardened per advisor feedback so share-context URLs re-check `revoked_at` live on every fetch rather than only at issuance.
3. **CSRF bootstrap before login/register, and whether register/login themselves need CSRF** — resolved by adding `GET /api/csrf-token` and requiring CSRF on register/login too, since the original spec says CSRF is required "on every state-changing call" with no stated exemption.
4. **Nominatim global rate-limit mechanism** — resolved as a MySQL row lock (`SELECT ... FOR UPDATE`), not filesystem `flock()`, since MySQL is already a hard dependency and a DB lock is correct across multiple PHP processes/workers, unlike `flock()`.
5. **Image-processing library** — resolved as raw `ext-gd`, not Imagick/Intervention/Image, to match the project's established minimal-dependency posture; EXIF orientation handled manually via `exif_read_data()`/`imagerotate()`.
6. **Does `password_hash(PASSWORD_DEFAULT)` satisfy "bcrypt/argon2i"?** — yes, it currently resolves to bcrypt and stays forward-compatible.
7. **Auto-login after registration?** — no; register and login are kept as two separate explicit steps, matching the endpoint list's framing.
8. **Does `GET /api/geocode` require authentication?** — yes, consistent with every endpoint except the one the spec explicitly calls "public, no auth" (share); also limits abuse of the shared Nominatim rate budget.
9. **Rate-limit thresholds** (not numerically specified in the original request) — set to 5 failed attempts/account/15min and ~20/hour/IP, both env-configurable.
10. **Password minimum length** (not specified) — set to 8 characters.
11. **User-enumeration timing defense** — required: identical error message plus a dummy `password_verify()` call for unknown emails.
12. **Nominatim contention behavior** — resolved as block/wait (via the row lock + `usleep()`), not reject, consistent with "global rate limit... across all users" implying serialization.
13. **Thumbnail dimension** (not specified) — set to 320px long edge, quality 80.
14. **Storage quota accounting basis** — resolved as actual on-disk bytes (resized image + thumbnail), not original upload size, since "storage quota" naturally means disk usage.
15. **Supported input image formats** (not fully specified) — JPEG/PNG/WebP accepted via finfo validation, output always normalized to JPEG.
16. **Orphan file cleanup job** — out of scope for Phase 2; `unlink()` failures are best-effort, DB row is authoritative.
17. **Reverse-proxy IP trust (`X-Forwarded-For`)** — out of scope; deliverable is explicitly local-dev only.
18. **Should failed/rejected uploads retain metadata for debugging?** — no; zero special retention, consistent with the product's privacy-conscious posture from Phase 1.
19. **Should account deletion invalidate other active sessions elsewhere, not just the current one?** — no, same-session-only for Phase 2; documented limitation given no cross-session store exists in this design.
20. **Is the 100MB quota permanent policy or a placeholder?** — enforced exactly as specified for this phase; permanence is a future product decision outside this phase's scope.

Advisor review raised additional concerns, all resolved before implementation:
21. **Missing `PATCH /api/photos/{id}`?** — confirmed intentionally out of scope; the original request explicitly says so.
22. **Share-link revocation didn't actually revoke access to already-issued signed media URLs within their TTL** — fixed: share-context signed URLs now embed the share token and re-check `revoked_at` live on every fetch (not just at issuance), and use a shorter 10-minute TTL than owner-context URLs (15 min).
23. **Storage-quota TOCTOU race under concurrent uploads** — fixed: the final quota check and the photo insert are wrapped in one transaction with a row-level lock on the uploading user, verified by a real multi-process concurrency test.
24. **Environment/tooling risk (no PHP/MySQL/Composer installed, sudo needs a password)** — resolved by using Docker (confirmed working without sudo) to build, run, and test; this is dev/test tooling only, not a requirement for someone with PHP/MySQL natively installed, and is clearly labeled as such.
25. **GD WebP support not guaranteed** — resolved with a runtime `function_exists('imagecreatefromwebp')` check and a graceful `webp_unsupported` rejection instead of a crash, documented in the README's prerequisites.
26. **Naming inconsistencies between architecture/code sections** — reconciled to one authoritative name/path each (`MAX_UPLOAD_BYTES`, `storage/thumbnails/`, `backend/scripts/migrate.php`).
27. **No session-status endpoint** — added `GET /api/me`.

---

# Photomap Phase 3 — Account Wiring, Deployment/Operability, and Treasure-Map Style - 2026-09-04 19:13 BST

## Context of the changes

Photomap's value proposition is letting someone drop a folder of their own photos onto a map and timeline and immediately see *where* and *when* they were taken. Phase 1 (guest mode, fully client-side) and Phase 2 (a standalone PHP+MySQL accounts backend) are both already built, tested, and documented, but are currently two unconnected projects — a live user today only ever experiences guest mode. This change is Phase 3: it wires the two together, plus three cross-cutting requirements the project owner gave directly (Node-free static deployability, a one-command Docker path, and a fully externalized/documented configuration surface), plus a new opt-in "treasure map" basemap style.

This change request is one coherent unit of work spanning previously-separate docs concerns (photomap_prompt.md's Phase 3 text, the project owner's direct deployment/ops requirements, and the treasure-map feature) and is planned and implemented together, since they share touchpoints (the map component gets both the account-mode data-source switch and the style toggle; the frontend build gets both the API-base-URL externalization and the Docker packaging).

**What this means for users, by mode.**

Guest mode gets no behavioral regression — the new map-style toggle (Detailed/Treasure Map) applies equally in guest mode since it's a pure rendering change to the same OSM tile layer guest mode already uses, with no new network dependency and no photo-data implication; the persistent "your photos never leave this device" guarantee is unaffected. Filter/search by date range, camera make/model, has-location, and drag-to-reassign a marker's location for GPS-less photos ship in **both modes** (see Deep Dives #1) — guest mode via the existing `PhotoRepository.updateLocation()` seam already built in Phase 1, account mode via the new `PATCH /api/photos/{id}` endpoint.

Account mode is where the bulk of user-facing change lands: the top banner becomes real (login/register, then account email + copy-share-link + delete-account), uploads and listing switch to the backend when logged in, and a persistent "your photos are stored on the server" notice is visible for the whole duration of an authenticated session (see Deep Dives #11), distinct from the guest privacy note. The new `/share/{token}` public route lets a link recipient view a read-only map with zero upload/delete/login affordances (filters and the map-style toggle remain available to share viewers — both are non-mutating; see Deep Dives #2). Drag-to-reassign in account mode calls the new `PATCH /api/photos/{id}` endpoint, activating work Phase 2 deliberately deferred here, following the same auth/ownership/CSRF conventions as the sibling endpoints (404-not-403 on mismatched ownership, `X-CSRF-Token`, session auth).

**Deployment/operability requirements — framing.** These elevate Docker from "dev/test convenience only" (Phase 2's explicit framing) to a first-class, clearly-labeled *local-use* path, while making explicit for the first time that the frontend's production artifact is plain static files deployable to any PHP+MySQL host with zero Node process running — Node/npm remain build-time-only tooling, exactly as today (`npm run build` → `dist/`). These are two distinct, separately-documented paths, not a replacement of one by the other. The account-mode private-storage/signed-URL property (photos live outside the web root, served only via time-limited signed URLs) is a Phase 2-built security property that must be verified as a non-regression after this change's wiring, and stated in the README as an explicit security/privacy property, not just an implementation footnote. The "every setting customizable" requirement extends Phase 2's existing `.env`-driven pattern to the frontend (API base URL, map tile/style settings) and documents every setting in one consolidated root README.

**Treasure Map style — product framing.** This satisfies the project owner's stated want (a "less fine grained map but with a better look, like a treasure map") without a new external tile provider/API key: the same OSM Web Mercator tiles, under a CSS filter, with a hard zoom cap. A photo pin lands in the identical place in both styles — only rendering and available zoom range differ. Default is "Detailed" (today's unchanged behavior); "Treasure Map" is purely additive/opt-in. One nuance worth surfacing in the README/UI copy: because the zoom cap is hard, a dense marker cluster in Treasure Map mode can't be zoomed in far enough to visually separate the way Detailed mode allows — inherent to the feature as specified, not a bug.

**Scope/priority note.** Per photomap_prompt.md's own text, trip auto-grouping / route lines / GeoJSON-KML export / heatmap-density mode remain explicitly lower-priority "if time allows" items, not required for sign-off. The core Phase 3 wiring, the deployment/ops requirements, and the treasure-map feature are the hard bar for this change. These nice-to-haves were NOT implemented in this change (see implementer's report).

## Architectural Impact

Frontend (`src/`) and backend (`backend/`) are today two fully unconnected projects. Confirmed against the actual code: `TopBanner.tsx` is exactly the disabled placeholder the docs describe; `PhotoRepository` (in `src/lib/db/photoRepository.ts`) already declares `updateLocation(id, lat, lon)` and `IndexedDbPhotoRepository` already implements it — this seam was pre-built in Phase 1 specifically for this moment. `photoRepository` today is a **module-level singleton** imported directly by `photoStore.ts` and `App.tsx`; this singleton must become swappable at runtime (guest vs. account), which is one of the non-additive changes to existing Phase 1 code this plan makes. `backend/src/Routing/Router.php` already has a `patch()` method wired but unused — no backend routing gap to fill. `backend/src/Session.php` hardcodes `SameSite=Lax`; `backend/src/Bootstrap.php` has no CORS handling anywhere (Phase 2 never needed it). `MapView.tsx` hardcodes a single OSM tile layer with no style abstraction — the treasure-map toggle is a genuinely new piece, not an extension of an existing seam. No routing library exists in the frontend today (single page only).

### Frontend: auth state, repository swap, and routing

Two routes are needed: the main app (`/`) and the public read-only `/share/{token}`. Per Deep Dives #3, this is a small hand-rolled path matcher (not a new `react-router-dom` dependency), consistent with the project's own established minimal-dependency posture (the backend's hand-rolled router is explicitly documented as "consistent with the project's minimal-dependency posture," and only two routes with very different rendering needs are required here). This requires the static host to serve `index.html` for `/share/*` paths (standard SPA-fallback rewrite: Apache `.htaccess`/`FallbackResource`, nginx `try_files`, built into the Docker nginx config) — documented per deployment path in the README (Deep Dives #4).

A new `src/state/authStore.ts` holds `{ user: {email} | null, status: 'idle'|'checking'|'authenticated'|'guest' }`, hydrated on app load via `GET /api/me`. `lib/db/index.ts` changes from exporting a fixed `IndexedDbPhotoRepository` instance to exposing `getActiveRepository()`/`setActiveRepository()` around a module-level `let active: PhotoRepository`; the existing exported `photoRepository` constant becomes a thin proxy delegating to `getActiveRepository()` at call time, so `photoStore.ts`, `objectUrlCache.ts`, and `App.tsx` need no call-site changes. `ingest/index.ts` needs one small, necessary change (see Deep Dives #14 — an advisor-flagged fix): `PhotoRepository.add()`'s signature changes from `Promise<void>` to `Promise<PhotoRecord>`, returning the persisted record with its final id. `ingest/index.ts` awaits this after its existing optimistic `upsertPhoto()` call and, if the returned id differs from the client-generated stable-hash id it optimistically used, calls a new store action `reconcileId(oldId, newRecord)` that removes the old Map entry and inserts the new one under the server-assigned id. Only `authStore.ts` calls `setActiveRepository()`, on login/logout.

`ApiPhotoRepository` implements the same `PhotoRepository` interface against `GET/POST/DELETE/PATCH /api/photos`, backed by a small `src/lib/api/http.ts` client that fetches `GET /api/csrf-token` once per session and attaches `X-CSRF-Token` on every mutating call, uses `credentials: 'include'` throughout, and surfaces `413 quota_exceeded`/`422` errors distinctly (mirroring the existing `StorageQuotaExceededError` pattern).

`TopBanner.tsx` becomes stateful: login/register forms → account email + "copy share link" (`POST /api/share-links`) + "delete account" (`DELETE /api/account`, then logout + revert to guest repository). A new persistent notice component (parallel to `PrivacyNote.tsx`) shows the "uploaded photos are stored on the server..." text for the whole duration of an authenticated session.

`/share/{token}` renders a separate, isolated read-only tree: `GET /api/share/{token}` populates local component state (not the global Zustand store's photo data — photo bytes/records stay local to `SharePage`, though it does share the global store's incidental UI-only slots like `selectedPhotoId`/`dateFilter`, since only one route is ever mounted at a time; see implementer's deviation notes). `MapView`/`TimelineStrip`/`PhotoThumbStrip`/`FullSizeViewer` gain two new optional props, `photos?: PhotoRecord[]` and `readOnly?: boolean` — when `photos` is supplied they use it instead of the global store; when `readOnly` is true they omit delete buttons and disable marker dragging. The existing store-backed usage in `App.tsx` passes neither prop, so guest/account-mode behavior is unchanged.

Filter/search (date range, camera make/model, has-location) extends the store with a `searchFilters` slice, orthogonal to the existing timeline-click `dateFilter` (which continues to drive click-to-open-thumbnail-strip unchanged); both compose (search narrows the base set the timeline itself is built from).

Drag-to-reassign needs a new interaction on `MapView.tsx`: a drop target on the map container (translating a drop point to lat/lon via `map.containerPointToLatLng`) for GPS-less photos dragged from a new `UnlocatedPhotosPanel`, plus `draggable: true` markers with a `dragend` handler for repositioning existing markers — both funnel into a `reassignLocation(id, lat, lon)` store action that calls `getActiveRepository().updateLocation()`. Disabled when `readOnly`.

### Treasure-map style toggle

A new `src/lib/mapStyles.ts` config module defines two presets (`detailed`, `treasure`) sourced from `VITE_MAP_*` env vars (with a runtime override layer). Both presets default to the same OSM tile source — coordinates always line up identically, no new tile provider. Switching styles replaces the active `L.tileLayer` (never mutates the existing photo markers/data). A small on-map `MapStyleToggle` control switches presets; default is Detailed, choice persisted to `localStorage` only (Deep Dives #10).

### Backend: new endpoint, CORS, and the session-cookie cross-origin question

`PATCH /api/photos/{id}` follows `DELETE /api/photos/{id}`'s exact conventions: `AuthMiddleware` + `CsrfMiddleware`, ownership resolved server-side from the session, mismatched ownership → `404` not `403`. Allowed for any photo, not restricted to currently-GPS-less ones (Deep Dives #12).

New CORS support: a `CorsMiddleware` reading an allow-list from `CORS_ALLOWED_ORIGINS`, handling `OPTIONS` preflight before auth/CSRF middleware run, `Access-Control-Allow-Credentials: true` with exact-match echoed origin (never `*`, never substring/suffix matching). `Session.php`'s `samesite` becomes configurable (`SESSION_COOKIE_SAMESITE`, default `Lax`, unchanged for same-origin deployments). Both the local dev path (Vite proxy) and the Docker path (nginx proxy) are same-origin by design and never need these — they only matter for a genuinely split-origin static-host-plus-separate-backend production deployment (Deep Dives #6).

Private storage (signed URLs, `storage/` outside the web root) is unaffected — `PATCH` only touches the `photos` row, never file paths; `MediaController`/`SignedUrl` are untouched.

### API base URL configurability

A small runtime `public/config.js` (`window.__PHOTOMAP_CONFIG__ = { apiBaseUrl: "..." }`, loaded via a `<script>` tag in `index.html` before the bundle) is layered over build-time `VITE_API_BASE_URL`/`VITE_MAP_*` defaults (Deep Dives #5). In the Docker all-in-one path this defaults to a same-origin relative `/api` (nginx proxies it).

## Code changes (as implemented — see implementer's report below for exact file list and any deviations)

### 1. Backend: `PATCH /api/photos/{id}`
`backend/src/Repositories/PhotoRepository.php` (`updateLocation()`), `backend/src/Controllers/PhotosController.php` (`update()`), `backend/src/Bootstrap.php` (route registration), new `backend/tests/Feature/PhotoUpdateFeatureTest.php`. Removed "PATCH not implemented" limitation lines from backend/README.md, docs/architecture.md, docs/code.md.

### 2. Backend: CORS + configurable cookie SameSite
New `CORS_ALLOWED_ORIGINS`/`SESSION_COOKIE_SAMESITE` env vars, `backend/src/Session.php` updated, new `backend/src/Middleware/CorsMiddleware.php` (exact-match origin allow-list only), `backend/.env.example` documents both, new `backend/tests/Feature/CorsFeatureTest.php`.

### 3. Frontend: API client + auth state
New `src/lib/config.ts`, `public/config.js`, `src/lib/api/http.ts`, `src/lib/api/{authApi,photosApi,shareLinksApi,accountApi,shareApi}.ts`, new `src/state/authStore.ts`.

### 4. Frontend: swappable `PhotoRepository`, including client/server-id reconciliation
`src/lib/db/photoRepository.ts`/`index.ts` — `getActiveRepository()`/`setActiveRepository()`, proxy pattern. `PhotoRepository.add()` signature changed `Promise<void>` → `Promise<PhotoRecord>`. New `src/lib/db/apiPhotoRepository.ts`. `src/lib/ingest/index.ts` updated for id reconciliation (`reconcileId` store action) and surfacing non-quota upload errors instead of swallowing them.

### 4a. Frontend: EXIF orientation correction fix
`src/workers/exifWorker.ts` — orientation-aware thumbnail/preview generation (`createImageBitmap(..., {imageOrientation:'from-image'})` with manual canvas-transform fallback for orientations 2-8). This fixes a previously-documented Phase 1 characteristic ("no EXIF-orientation-based pixel rotation applied") for BOTH guest and account mode — update docs/code.md accordingly (the old bullet is now stale/incorrect).

### 5. Frontend: login/register banner, account controls, upload notice
`src/components/TopBanner.tsx` rewritten (functional login/register/logout/copy-share-link/delete-account). `src/App.tsx` calls `authStore.restoreSession()`. New `src/components/AccountNotice.tsx`. `src/components/PrivacyNote.tsx` now hidden when authenticated (mutually exclusive with AccountNotice).

### 6. Frontend: public `/share/{token}` route
New hand-rolled `src/Router.tsx` (two routes: `/` and `/share/:token`, per Deep Dives #3 — NOT react-router-dom). New `src/pages/SharePage.tsx`. `src/main.tsx`/`src/App.tsx` wired to the router.

### 7. Frontend: filter/search
New `src/lib/filters.ts`, `src/components/FilterBar.tsx`. `photoStore.ts` gained a `searchFilters` slice.

### 8. Frontend: drag-to-reassign location
New `src/components/UnlocatedPhotosPanel.tsx`. `MapView.tsx` gained drop-target handling and draggable markers, funneling into a new `reassignLocation` store action (optimistic update + rollback-on-error).

### 9. Frontend: treasure-map basemap style toggle
New `src/lib/mapStyles.ts` (`detailed` maxZoom 19 unchanged; `treasure` maxZoom 10, CSS filter `sepia(0.65) saturate(1.6) hue-rotate(-8deg) contrast(1.1)` + vignette, both config-driven via `VITE_MAP_*` env vars). `MapView.tsx`/`.css` updated. New `src/components/MapStyleToggle.tsx` (default `detailed`, persisted to `localStorage`).

### 10. Build-time-configurable API base URL, Node-free static deploy
`vite.config.ts` dev proxy (`/api` → `http://localhost:8000` by default). Root `.env.example` (new). `npm run build` → `dist/` confirmed static-only (no Node entry point) by the implementer.

### 11. Docker: whole-stack local compose
New root `docker-compose.yml` (mysql + backend + frontend services), new `docker/frontend/Dockerfile` (multi-stage: `node:20-alpine` build → `nginx:alpine` serve), new `docker/frontend/nginx.conf` (SPA fallback + `/api/` reverse proxy to backend, same-origin). Existing `backend/docker-compose.yml` left as-is (backend-only dev/test convenience). Verified live end-to-end by the implementer (see report).

### 12. Storage privacy confirmation
No regression — confirmed by the implementer; `PATCH` only touches the `photos` row, never file paths.

### 13. README restructuring
Root `README.md` rewritten as the main entry point (what Photomap is, both modes, Docker quick start, dev setup, production deploy, env-var reference tables, private-storage/signed-URL property, privacy notes, known limitations). `backend/README.md` stays as the lower-level backend-only reference, updated with the PATCH endpoint row and CORS section.

### 14. Nice-to-haves
NOT implemented in this change (GeoJSON/KML export, heatmap mode, trip auto-grouping, route lines) — explicitly lower priority per the original request, deferred.

## Testing information (as executed — see implementer's report for full results)
Frontend: Vitest suite extended substantially (new tests for `ApiPhotoRepository`, id reconciliation, CSRF lifecycle, rewritten `TopBanner` tests, mode-switching, `/share/{token}` routing, filters, drag-to-reassign, map style toggle, EXIF orientation, build/deploy checks). Backend: PHPUnit extended with `PhotoUpdateFeatureTest`, `CorsFeatureTest`; full existing suite rerun; `scripts/smoke-test.sh` extended with a PATCH step. Docker compose verified live end-to-end. See implementer's report below for exact counts and results.

# Deep Dives

**Q1 (product owner): Should filter/search (date range, camera make/model, has-location) and drag-to-reassign ship for guest mode too, or account-mode only?**
A: Both modes. Grounded in photomap_prompt.md's own Phase 3 text ("Add remaining 'core' features from the original spec, now that both modes exist") and the fact that Phase 1's `PhotoRepository` interface already includes `updateLocation()`, built specifically for this purpose.

**Q2 (product owner): Should the public `/share/{token}` view also expose filter/search and the map-style toggle, or be strictly minimal?**
A: Filters and the Detailed/Treasure-Map toggle remain available to share viewers — both are non-mutating/read-only-safe. Drag-to-reassign, upload, delete, and login/register remain excluded, per the explicit "no upload/delete/login affordances" requirement.

**Q3 (architect/developer/tester, consolidated — routing mechanism for `/share/{token}`): react-router-dom or hand-rolled?**
A: A small hand-rolled path matcher (two routes only). Resolved a genuine disagreement between the architect briefing (hand-rolled, citing the project's minimal-dependency posture) and the developer briefing (proposed react-router-dom), in favor of hand-rolled: directly grounded in an existing documented architecture decision (the backend's hand-rolled router is explicitly called out in docs/architecture.md as "consistent with the project's minimal-dependency posture").

**Q4 (architect): `/share/{token}` as a literal path route (needs SPA-fallback rewrite) vs. a hash-based route?**
A: Literal path route, matching the original spec's own wording. SPA-fallback rewrite documented per deployment path (nginx `try_files` built into the Docker config; Apache `.htaccess`/`FallbackResource` documented for plain hosting).

**Q5 (architect/developer, consolidated): Runtime-configurable API base URL (`public/config.js`) vs. purely build-time `VITE_API_BASE_URL`?**
A: Runtime `public/config.js`, layered over build-time defaults — still a 100% static file, and the only way to satisfy "same static build, different backend, no rebuild."

**Q6 (architect/developer/tester, consolidated): Cross-origin cookie/CORS strategy — how much automated coverage, and is changing `Session.php` acceptable?**
A: `Session.php`'s `SameSite` becomes configurable (default unchanged: `Lax`), plus a new opt-in `CorsMiddleware`/`CORS_ALLOWED_ORIGINS`. Dev proxy and Docker nginx proxy are both same-origin by design and never touch this. Automated coverage is documented + header/config-level tests only; live two-real-origin cookie behavior is a manual/staging concern.

**Q7 (architect/developer, consolidated): Should logging in migrate/upload existing guest-mode IndexedDB photos into the new account?**
A: No — out of scope for this phase. Guest and account data remain two separate namespaces. Documented as a known limitation.

**Q8 (tester): Should filter/search be client-side only or add server-side query-param filtering?**
A: Client-side only, filtering the already-fetched full list.

**Q9 (architect/developer, consolidated): Treasure Map's exact zoom cutoff and CSS filter recipe?**
A: Locked as `maxZoom: 10` and CSS filter `sepia(0.65) saturate(1.6) hue-rotate(-8deg) contrast(1.1)` plus a subtle inset vignette, both config-driven.

**Q10 (developer/tester, consolidated): Should the map style choice persist per-browser only, or sync to the account across devices?**
A: `localStorage` only for this phase.

**Q11 (tester): Should the "logged in, stored on server" notice track "seen" state, or something simpler?**
A: Rendered as a persistent, non-dismissible banner for the entire duration of an authenticated session — trivially satisfies "before the first upload."

**Q12 (tester): Should `PATCH /api/photos/{id}` be restricted to only currently-GPS-less photos?**
A: Allowed for any photo — strictly more useful, consistent with other photo endpoints' unrestricted-within-ownership design.

**Q13 (developer/tester, consolidated): Should `ApiPhotoRepository`'s `estimateUsage()`/`requestPersistence()` no-op, or should the interface be adjusted?**
A: No-op — both are IndexedDB-specific concepts meaningless for server storage; the quota is surfaced reactively via `413 quota_exceeded`.

**Q14 (advisor): Client-generated vs. server-assigned photo IDs were never reconciled in the plan's original draft — how resolved?**
A: `PhotoRepository.add()`'s signature changed from `Promise<void>` to `Promise<PhotoRecord>`, returning the persisted record with its final id. `ingest/index.ts` reconciles the store entry via a new `reconcileId(oldId, newRecord)` action if the id changed (guest mode: unchanged; account mode: backend's `AUTO_INCREMENT` id replaces the client-generated stable hash).

**Q15 (advisor): Should the backend's EXIF-orientation correction, fed an already-recompressed EXIF-stripped preview, be fixed or documented as a limitation?**
A: Fixed — `exifWorker.ts` now applies orientation correction when generating the thumbnail/preview canvas images, benefiting both modes and removing what would otherwise become a permanent, server-persisted data-quality bug in account mode.

**Q16 (advisor, minor): CORS allow-list matching precision and test coverage.**
A: Exact string equality only (no substring/suffix matching); dedicated test asserts no `Access-Control-Allow-Origin` header at all for a non-matching/near-miss origin.
