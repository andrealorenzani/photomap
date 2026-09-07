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

---

# Dreamhost / Shared-Hosting Deployment Support - 2026-09-05 21:29 BST

## Context of the changes

### What already exists vs. what's being asked for

`docs/product.md` and the README already claim the product is deployable outside Docker: the frontend builds to a static `dist/` + a runtime `public/config.js`, and the backend is "a plain PHP 8.1+/MySQL project... deployable to any static host or plain PHP+MySQL host." That claim is real for the pieces taken in isolation, but checking the repo confirms it has never been packaged or proven as a single combined deployment:

- There is no `.htaccess` anywhere in the repo — the SPA-fallback rewrite for routes like `/share/:token` is described in prose in the README but not shipped.
- Backend config (`backend/src/Config.php`) is built entirely around `vlucas/phpdotenv` reading a `.env` file plus environment variables (`backend/.env.example`), not a hand-edited `config.php`.
- The frontend's `dist/` and the backend's `backend/public/` are documented as two separate web roots, which assumes either two separate hosting slots or a reverse proxy (nginx in Docker, Vite's dev proxy locally) to unify them under one origin. Dreamhost shared hosting maps exactly **one** directory to a domain — there is no reverse-proxy layer the user controls, so "same origin" has to be achieved by literally interleaving frontend static files and a backend PHP front controller inside one directory tree with `.htaccess` rewrite rules, which doesn't exist today.
- `vendor/` is correctly gitignored (`/vendor/` in `backend/.gitignore`) and does not currently exist as a directory in the working tree; it is a build-time artifact only, produced by `composer install`, never committed.

So this request is not a doc-polish task — it's a real new deployment target requiring: (1) a combined single-directory artifact layout, (2) an `.htaccess`-based router that serves the SPA for normal routes and hands `/api/*` (or similar) to the backend's front controller, and (3) a new, simpler configuration mechanism (`config.php`) that a non-technical deploy step (SFTP upload + one edit) can drive, sitting alongside — not replacing — the existing `.env`/Docker-based local dev story.

### What this means for guest mode

Nothing changes for guest mode. It is fully client-side and ships as static files in `dist/`; it doesn't care whether those static files sit at a shared host's docroot, a CDN, or behind Docker/nginx. The only guest-mode-relevant risk is the SPA-fallback rewrite: if `.htaccess` isn't correct, a deep link or refresh on any client-side route (including the guest-mode app itself if bookmarked mid-session) could 404 on Apache instead of falling through to `index.html`. This is part of the acceptance criteria, not just the account-mode share link.

### What this means for account mode

Account mode is where all the real complexity of this change lives, since it depends on the PHP/MySQL backend:

- **Database**: Dreamhost provisions MySQL/MariaDB with a host/db/user/password the user gets from their control panel. Entering those four values plus an app secret and a storage path into one file, then running the migration script once via SSH, is sufficient — no manual schema editing, no separate "create tables" instructions beyond that one script.
- **File storage privacy property**: `docs/product.md` documents storing uploaded photos "outside its web root, under randomized filenames, served only via short-lived signed URLs" as a security/privacy property of the product, not an implementation detail. On Dreamhost this still holds — "outside the web root" means outside the domain's mapped public directory (a sibling directory under the same shell user's home), which Dreamhost supports.
- **Same-origin by construction**: because Dreamhost gives one directory per domain, the natural outcome of this change is a same-origin deployment (frontend and API under one domain via `.htaccess` routing), which means the existing `CORS_ALLOWED_ORIGINS` / `SESSION_COOKIE_SAMESITE=None` split-origin machinery is unnecessary for this specific path and defaults to the simple same-origin settings already documented for the Docker/dev-proxy cases.
- **Composer/vendor**: `vendor/` is built locally (or in CI) via `composer install --no-dev --optimize-autoloader` before packaging, never committed to git, and uploaded as part of the deploy payload — composer is a build-time-only tool, not something Dreamhost itself needs to run. (SSH + `composer install` remains a documented fallback for users who prefer it or whose local machine lacks PHP/composer.)

### Fit with existing product definition and prior phases

This is consistent with the product's existing "Deployment and privacy, at a glance" section, which already frames Docker as "a local-use convenience... distinct from a real production deployment" and frames the static frontend/PHP backend as the actual production target. This change is the natural next step: turning that long-stated intention into a concretely buildable, single-artifact, Dreamhost-shaped deployment path. It does not change any user-facing feature, mode behavior, or privacy property — it's exclusively an operational/deployment change. The existing Docker path and native (non-Docker, multi-terminal) dev setup stay exactly as-is for local development; this is purely additive.

### Product-level risks and inconsistencies flagged during planning

1. **Two configuration mechanisms living side by side.** `.env` remains the mechanism for local/Docker dev; the new shared-hosting path adds `config.php` as an alternate loader for the exact same settings `Config.php` already knows about — one source of truth for *what* settings exist, two ways of *supplying* them, not a second divergent settings surface.
2. **"Run migrations once" is a promise with an edge**: it implicitly excludes ongoing schema migrations after the first deploy. If the app is updated later (new migrations added), the user needs to re-run `php scripts/migrate.php` again after each upload of new files — a one-time-per-deploy step, not a one-time-forever step. Docs say so plainly.
3. **Directory-layout restructuring is a bigger change than "write a config.php."** Making the frontend build and backend coexist under one Dreamhost-mapped directory with `.htaccess` routing is new architecture, not configuration.
4. **PHP version/extension availability on Dreamhost** (backend requires PHP 8.1+, `ext-pdo_mysql`, `ext-gd`, `ext-fileinfo`, `ext-curl`, `ext-json`, `ext-mbstring`, `ext-exif`) is called out explicitly in the deploy docs as something to confirm/select in the Dreamhost panel before upload.
5. **Storage quota** (100 MB/account) is unrelated to this change but worth a sanity note in the docs for whoever fills in `STORAGE_PATH`.
6. **Scope**: the mechanism built is generic "single-directory Apache/PHP/MySQL shared hosting," not something Dreamhost-proprietary — nothing in the constraints is actually Dreamhost-exclusive. Docs use Dreamhost as the named, worked example (per the user's explicit ask) while the underlying mechanism works for equivalent hosts too.

## Architectural Impact

### DB dialect is not a concern

The backend already targets **MySQL/MariaDB exclusively** — `backend/src/Database.php` builds a `mysql:` PDO DSN, every migration under `backend/migrations/*.sql` and `backend/docker/init.sql` uses MySQL syntax, and `backend/scripts/migrate.php` is plain PDO/PHP with no Postgres-isms anywhere. Dreamhost's shared MySQL/MariaDB is compatible with the existing schema as-is — no dialect migration needed.

### Chosen layout: two-tier deploy, backend kept fully outside the web-reachable tree

Two competing shapes were considered during planning: a merged single-webroot (backend files, including `vendor/`, physically inside the web-reachable directory, protected only by `.htaccess` deny rules) vs. a two-tier, sibling-directory shape (the entire `backend/` project uploaded to a private directory *outside* the Dreamhost domain's mapped docroot, with only a one-line PHP stub and static frontend assets inside the web-reachable docroot).

**The two-tier, sibling-directory shape was adopted.** It matches the project's existing hard security invariant that photo storage must be genuinely non-web-reachable (enforced by `MediaController::serve()` + signed URLs), extends that same "outside the docroot" guarantee to the *entire* backend source tree via the filesystem itself rather than relying solely on `.htaccess`, and requires no changes to `backend/public/index.php` or `backend/scripts/migrate.php` (both resolve their root via their own file's `__DIR__`, unaffected by being `require`d from elsewhere).

Upload layout:

```
~/                                    (Dreamhost account home — never web-served)
├── photomap-backend/                 <- upload the entire backend/ directory here, unmodified internal layout
│   ├── .htaccess                     <- deny-all, defense in depth
│   ├── config.php                    <- the one file the user edits (DB host/name/user/password, app secret, storage path, etc.)
│   ├── vendor/                       <- built locally via `composer install --no-dev --optimize-autoloader` before upload, never committed to git
│   ├── src/, migrations/, scripts/
│   ├── public/index.php              <- UNCHANGED file, still the real front controller
│   └── storage/{photos,thumbnails}/  <- outside the webroot, exactly as required today
└── domain.com/                       <- Dreamhost's Apache DocumentRoot for the domain
    ├── index.html, assets/*.js/css   <- `dist/` contents, uploaded as-is
    ├── config.js                     <- `dist/config.js`, apiBaseUrl left at its existing default '/api' (same-origin)
    ├── .htaccess                     <- API rewrite + SPA fallback + hardening
    └── api/
        └── index.php                <- ~1 line: require the real backend/public/index.php
```

`domain.com/api/index.php`:
```php
<?php
require __DIR__ . '/../../photomap-backend/public/index.php';
```
Because PHP's `__DIR__` inside the *required* file is computed from that file's own real path regardless of who `require`s it, `dirname(__DIR__)` there still correctly resolves to `~/photomap-backend`, so `vendor/autoload.php`/`Config::load($root)` keep working with zero changes to `backend/public/index.php` or `backend/scripts/migrate.php`.

`domain.com/.htaccess`:
```apache
RewriteEngine On
Options -Indexes

RewriteRule ^api/.*$ api/index.php [L]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]

# Optional, opt-in HTTPS redirect (commented out by default)
```

This is the direct Apache equivalent of `docker/frontend/nginx.conf`'s existing `/api/` proxy_pass + SPA `try_files` fallback.

### Security addition from advisor review: defense-in-depth against `mod_userdir`-style exposure

The "sibling directory is non-web-reachable" invariant is only true if nothing else on the shared-hosting account maps `~/` (the account home) to a URL. Shared hosts commonly enable `mod_userdir`, which serves a user's home directory (and sibling directories not otherwise domain-mapped) at `http://<server-hostname-or-ip>/~<username>/...` — a different exposure path than same-domain directory traversal. Mitigation: a deny-all `.htaccess` (`Require all denied`, with an Apache 2.2 `Order deny,allow`/`Deny from all` fallback) ships *inside* `backend/` itself, so it's included in every deploy of the private backend directory regardless of `mod_userdir` settings. The manual verification checklist explicitly tests the `~username` URL path, not just the domain-mapped path.

### `config.php`, integrated into the existing `Config.php` seam

`Config::load()` now checks for `config.php` in the root path first (a plain PHP file `return`ing an associative array of the same keys `.env.example` documents); if present, its values populate `$_ENV`/`putenv()` and `.env`/phpdotenv is never consulted. Falls back to the existing `.env` behavior when no `config.php` exists. This is a strictly additive third path: Docker sets real environment variables directly and never has `config.php` present, so behavior there is unchanged; native dev keeps using `backend/.env` unchanged.

A `.php` file returning an array (rather than JSON/YAML) is a well-understood shared-hosting convention for keeping secrets safe even if the file is ever accidentally placed somewhere briefly web-reachable — PHP executes it rather than serving credentials as plaintext (the deny-all `.htaccess` is defense-in-depth on top of this, not the only layer).

### Frontend API base URL

No new mechanism needed — this is exactly what the existing runtime `public/config.js` layering (from Phase 3) was built for. `getApiBaseUrl()` already defaults to `/api`, a same-origin relative path correct as-is for this deploy shape.

### Migrations against Dreamhost's DB

`backend/scripts/migrate.php` works unmodified over SSH + PHP CLI. As a fallback for accounts without SSH, a straight concatenation of `backend/migrations/*.sql` into one importable `.sql` file is documented as an on-demand, generate-when-needed command (not committed, since a committed copy would go stale) — usable as a phpMyAdmin-import fallback for a first-time deploy, bypassing `schema_migrations` bookkeeping (an "all-at-once, first-time-only" fallback, not a substitute for the PHP script's idempotent behavior on subsequent deploys).

### Other architectural details

- **`vendor/` strategy**: never committed to git; built locally via `composer install --no-dev --optimize-autoloader` before every packaging/upload. SSH + `composer install` remains a documented fallback.
- **PHP version**: `backend/composer.json` requires PHP >=8.1 plus `ext-pdo_mysql`, `ext-gd`, `ext-fileinfo`, `ext-curl`, `ext-json`, `ext-mbstring`, `ext-exif` — standard/enableable via Dreamhost's per-domain PHP-version selector.
- **Upload size limits**: `MAX_UPLOAD_BYTES` (25MB default) may exceed Dreamhost's default PHP-FPM ini values; docs show an optional `domain.com/api/.user.ini` bumping these if needed.
- **File permissions**: `storage/photos/`, `storage/thumbnails/` need to exist and be writable by the account's PHP process; Dreamhost runs PHP as the account's own user, so no special chmod/ownership dance expected.
- **HTTPS and a named silent-failure pitfall**: `Session.php` gates the session cookie's `Secure` flag purely on `Config::isProduction()` (`APP_ENV=production`), with no check that the connection is actually HTTPS. If a user sets `APP_ENV=production` before enabling HTTPS, the browser silently refuses to persist the `Secure`-flagged cookie — login appears to succeed but the session doesn't persist, with no visible error. This is documented as a named troubleshooting note in both README files and the manual verification checklist.
- **Domain root vs. subdirectory deploy**: design and default docs target domain-root deployment; a short docs note covers the `RewriteBase`/relative-path adjustment needed for a subdirectory deploy.
- **Packaging helper's exact file scope**: `backend/scripts/package-for-deploy.sh` does a **curated** copy, not raw recursive copy. Includes `public/`, `src/`, `migrations/`, `scripts/`, freshly-built `vendor/`, `composer.json`/`.lock`, `config.php`/`.example`, and the deny-all `.htaccess`. Excludes `tests/`, `backend/docker/`, `.env`/`.env.test`/`.env.example`, `docker-compose.yml`, `phpunit.xml`, and `.git`-related files.

### Docker: unaffected

Root `docker-compose.yml` and `backend/docker-compose.yml` remain exactly as they are today. `Config::load()`'s new `config.php`-first check is a no-op in both containers (no `config.php` file is ever present there), so behavior is byte-for-byte unchanged.

## Code changes

### Files added
- `backend/config.php.example` — template array of all settings currently in `.env.example`, with Dreamhost-specific inline comments.
- `backend/.htaccess` — deny-all defense-in-depth (`Require all denied` + Apache 2.2 fallback).
- `deploy/dreamhost/.htaccess` — domain-docroot `.htaccess` (API rewrite + SPA fallback + commented-out HTTPS redirect).
- `deploy/dreamhost/api/index.php` — one-line stub requiring `../../photomap-backend/public/index.php`.
- `backend/scripts/package-for-deploy.sh` — runs `npm run build` + `composer install --no-dev --optimize-autoloader`, assembles the curated two-tier `release/` directory tree.
- `backend/tests/Unit/ConfigTest.php` — unit coverage for the `config.php`/`.env` precedence logic.
- `deploy/dreamhost/verify-apache-routing.sh` — on-demand, Docker-based (`php:8.3-apache`, `mod_rewrite`, `AllowOverride All`) routing/security verification tool against a packaged `release/` artifact, not wired into default CI.

### Files modified
- `backend/src/Config.php` — added the `config.php`-first check to `Config::load()`; added `Config::resetForTesting()` for test isolation.
- `backend/.gitignore` — added `/config.php`.
- `.gitignore` (root) — added `release` (packaging script's build output).
- `backend/tests/Feature/SecurityFeatureTest.php` — added a test asserting no stray `config.php` shadows `.env.test` fixtures during the Feature suite.
- Root `README.md` — new "Deploying to Dreamhost (shared hosting)" section; updated project-layout listing.
- `backend/README.md` — full "Deploying to Dreamhost" section (layout diagram, step-by-step, HTTPS-ordering pitfall, `mod_userdir` pitfall, subdirectory-deploy note), `config.php` pointer in "Setup", updated "Testing" section.

### Files explicitly NOT changed
`backend/public/index.php`, `backend/scripts/migrate.php`, `backend/src/Database.php`, `backend/src/Bootstrap.php`, `backend/src/Session.php`, all Controllers/Repositories/Services, `backend/migrations/*.sql`, `vite.config.ts`, `src/lib/config.ts`, `public/config.js`.

## Testing information

### Effect on existing tests
Frontend suite (135 tests) unaffected. Backend Feature suite (63 tests, `php -S`-based) already boots via `Config::load($root)`, so it's a free regression guard for the `.env` fallback path, with one new explicit assertion added that no stray `config.php` shadows test fixtures. Backend Unit suite gained `ConfigTest.php` (previously no coverage of `Config` in isolation). `migrate.php` re-verified against MariaDB in addition to MySQL.

### New test coverage
1. `backend/tests/Unit/ConfigTest.php` — config.php-only, .env-only (regression), both-present precedence (config.php wins), neither-present (defaults / `require()` throws), malformed config.php (fails loudly), end-to-end `Database::connect()` picking up config.php-sourced values.
2. Apache-rewrite routing behavior (`deploy/dreamhost/verify-apache-routing.sh`, Docker-based, on-demand, not in default CI): SPA root, SPA fallback for client routes, `/api/*` routed to PHP, static assets served directly, directory-traversal blocked.
3. Migrations against MySQL and MariaDB: idempotency (second run reports no new migrations) with a privilege-limited DB user.
4. Packaging artifact self-containment and curated scope: no hardcoded dev paths, loadable `vendor/autoload.php`, deny-all `.htaccess` present, dev-only files genuinely excluded.
5. Docker regression: full `docker compose down -v && docker compose up --build` smoke test confirming no impact from the `config.php`-first check.

### Manual, one-time checklist against a real Dreamhost account (documented, not automated)
Confirm PHP version/extensions match `composer.json`; confirm `.htaccess`/`mod_rewrite` behaves as simulated once uploaded; confirm the sibling `photomap-backend/` directory is not web-reachable from the live domain **and** explicitly test the `http://<server-hostname-or-IP>/~<username>/photomap-backend/config.php` path (mod_userdir risk) returns 403; confirm `config.php` + one-time `php scripts/migrate.php` run works; confirm upload→thumbnail→share-link flow end-to-end; confirm session cookie behavior over real HTTPS, specifically that HTTPS/Let's Encrypt was enabled *before* setting `APP_ENV=production`.

# Deep Dives

(All questions raised by product-owner, architect, developer, and tester briefings were resolved internally — either from facts already present in another agent's briefing, or via a coordinator design decision consistent with the user's explicit request — without needing to ask the user. The advisor's one substantive concern, the `mod_userdir` exposure gap, was resolved by adding the deny-all `backend/.htaccess` and expanding the manual checklist, both implemented. Two clarifying advisor points — the packaging script's curated file scope, and the HTTPS/`APP_ENV` ordering pitfall — were also folded into the plan and implemented. Full Q&A record:)

- Config.php additive vs. replacing .env everywhere → Additive; `.env`/Docker paths unchanged.
- Commit vendor/ vs. composer install over SSH → Built locally via `composer install --no-dev`, never committed, uploaded as part of the deploy payload; SSH install remains a documented fallback.
- Docs-only vs. packaging script → Packaging script included (`package-for-deploy.sh`), matching the user's literal ask to just "upload the files."
- Generic shared-hosting vs. Dreamhost-specific → Generic Apache/PHP/MySQL mechanism, Dreamhost as the named worked example in docs.
- Does "everything should work" include share-link/geocode paths → Yes, full existing feature scope; already covered by the `/api/*` + SPA-fallback routing design.
- Should Docker mirror the new .htaccess routing → No; Docker's nginx routing stays as-is, independently implementing the same logical contract.
- Where should config.php.example live → `backend/` root, co-located with `.env.example`.
- Commit the migration SQL-concatenation fallback file → No, generated on demand only (would go stale otherwise).
- Backend under `/api/` specifically → Yes, matches the existing hardcoded default in `public/config.js`.
- Sibling private directory vs. everything in one webroot behind `.htaccess` deny → Sibling private directory, plus a deny-all `.htaccess` inside it as defense-in-depth (added after advisor review).
- Domain root vs. subdirectory deploy → Domain-root by default; subdirectory adjustment documented as a note.
- HTTP→HTTPS redirect in `.htaccess` vs. Dreamhost panel → Commented-out, opt-in block in `.htaccess`; plus a named doc pitfall about `APP_ENV=production`/HTTPS ordering.
- Should config.php's real DB/secret values be generated as part of this change → No, purely a manual step the user performs with their own Dreamhost-provided values.
- Shape of config.php → Plain PHP file `return`ing an associative array, merged into `$_ENV`/`putenv()`.
- Storage outside docroot vs. behind `.htaccess` deny → Outside docroot entirely, plus the deny-all `.htaccess` as a second layer.
- Apache-simulation container: permanent CI job vs. on-demand tool → On-demand, documented script, not wired into default CI.
- Does "everything should work" confirm same-origin (no-CORS) path → Yes; `CORS_ALLOWED_ORIGINS` stays empty, `SESSION_COOKIE_SAMESITE` stays `Lax` for this deploy path.
- (Advisor) mod_userdir exposure gap → Mitigated with deny-all `backend/.htaccess` + expanded manual checklist.
- (Advisor) packaging script file scope → Curated include/exclude list, specified and implemented.
- (Advisor) HTTPS/APP_ENV ordering pitfall → Documented as a named troubleshooting note in both READMEs and the manual checklist.

---

# Registration Approval, Admin Console, GPS-Required Uploads, and Calendar Heatmap Timeline (v1.0.0) - 2026-09-06

## Context of the changes
Photomap is moving from open self-service registration to an admin-approval model. New accounts can log in and use the app immediately but cannot upload until an admin activates them. Existing pre-1.0.0 users are grandfathered to active status so nobody already using the app is locked out. A secret `/admin` console lets a trusted operator activate/disable accounts, set per-user storage quotas, see (existence + timestamp only, never the raw link) whether a user has an active share link, search/filter/sort the user list (including by registration date), and manage global settings (default quota for new users, global upload on/off toggle, basic usage stats). Registration triggers a notification email to a configurable admin address; account activation/disable triggers a notification email to the affected user (the user's existing account email doubles as this notification address — no separate field was added). A registration-time popup sets accurate expectations: approval is required before uploads work, photos are private by default (no public listing/search, shared only via a link the user controls — deliberately not "publicly visible on the internet" as originally requested, since that phrasing overstated exposure relative to the app's actual private-by-default + revocable share-link architecture), and Guest Mode uploads nothing so it can't be shared with friends. Separately, logged-in/account-mode uploads that lack GPS data are now discarded outright rather than accepted as ungeotagged (guest mode is unaffected, since guest mode never reaches this server-side check); the UI label "Without GPS" becomes "Discarded (No GPS)". Finally the timeline view has been redesigned around a calendar axis (year/month/day) combined with a photo-density heatmap.

## Architectural Impact
New `users.status` (pending/active/disabled) and `users.storage_quota_bytes` columns (migration 0007, which also flips any row still 'pending' at migration time to 'active' for grandfathering — new post-migration registrations insert 'pending' explicitly and are unaffected by that one-time backfill). New singleton `app_settings` table (migration 0008) holding `default_storage_quota_bytes` and `uploads_enabled`. Admin authentication is entirely separate from user authentication: a single operator identity (username + `password_hash()`/bcrypt hash) stored in the config file (`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`), verified with `password_verify()`, with a distinct `$_SESSION['admin']` key so admin and user sessions never conflate, rate-limited, and using a timing-safe dummy-hash comparison when the username doesn't match to avoid username enumeration via timing. Two `AccountStatusMiddleware` instances: a broad one blocking `disabled` accounts on all authenticated routes, and a narrow one additionally blocking `pending` accounts specifically on the upload route (pending users can do everything except upload). Share-link privacy: the admin-facing repository method (`ShareLinkRepository::findActiveCreatedAtForUser()`) only ever SELECTs `created_at`, never the token — the raw shareable URL/token is architecturally unreachable from the admin code path (backend) and never requested or rendered by the admin frontend, not merely filtered before serialization. A `MailerInterface` abstraction with a real `PhpMailMailer` (PHP `mail()`) implementation and test doubles (`FakeMailer`/`FailingFakeMailer`) lets tests substitute fakes (wired via `MAIL_TRANSPORT=fake` in test env, resolved in `Bootstrap::resolveDefaultMailer()`); email sends are always best-effort (caught/logged, never block the triggering user or admin action). On the frontend, the admin console is a fully separate page/component tree (`src/pages/AdminPage.tsx`, `src/components/admin/*`, `src/state/adminStore.ts`, `src/lib/api/adminApi.ts`) reached via a third route (`/admin`) in the existing hand-rolled `Router.tsx`, mirroring how `/share/:token` (`SharePage.tsx`) is already kept separate from the main app/global photo-viewing state — the admin section never touches `photoStore`/`authStore`. The timeline component (`TimelineStrip.tsx` + `lib/timeline.ts`) was evolved rather than rewritten: the pre-existing canvas-based density-heatmap rendering remains the default view, with a new `density → year → month → day` navigation/drill-down layer added on top (breadcrumbs, axis labels, `computeYearBins`/`computeMonthBins`/`computeDayBins`).

## Code changes
Backend (all in `backend/`): migrations `0007_add_user_status_and_quota.sql`, `0008_create_app_settings.sql`; new `Controllers/AdminAuthController.php`, `AdminUsersController.php`, `AdminSettingsController.php`, `AdminStatsController.php`; new `Middleware/AdminAuthMiddleware.php`, `AccountStatusMiddleware.php`; new `Repositories/AppSettingsRepository.php`, updates to `UserRepository.php` (status/quota/search/sort/filter) and `ShareLinkRepository.php` (existence/timestamp-only lookup); new `Services/AppSettingsService.php`, `MailerInterface.php`, `PhpMailMailer.php`, updates to `StorageQuotaService.php` (per-user quota resolution plus a deadlock-retry wrapper around the row-locking transaction, retrying on SQLSTATE 40001 up to 3 times with backoff); updates to `AuthController.php` (registrations insert as 'pending', admin-notify email on register) and `PhotosController.php` (422 gps_required rejection for account-mode uploads missing GPS); route wiring for all `/api/admin/*` endpoints in `Bootstrap.php` (CSRF on state-changing routes, `AdminAuthMiddleware` on everything but login); config additions in `config.php.example`/`.env.example` with inline step-by-step admin-hash-generation instructions, mirrored in `backend/README.md`'s "Admin console" section (including a copy-pasteable `php -r 'echo password_hash(...);'` one-liner). A shared `JsonResponse.php` fix added `JSON_PRESERVE_ZERO_FRACTION` so whole-number floats (e.g. lat/lon) no longer silently collapse to ints over the wire — a latent, pre-existing contract bug newly exposed by new tests using round-number coordinates.

Frontend (all in `src/`): third route `/admin` in `Router.tsx` → `AdminPage.tsx`; new `state/adminStore.ts` (separate Zustand store, session states `idle|checking|authenticated|anonymous`); new `lib/api/adminApi.ts` (thin wrappers over the existing CSRF/`apiRequest` mechanism for all `/api/admin/*` endpoints); new `lib/adminUsers.ts` (pure helpers: query building, sort-state cycling, share-link status formatting as existence+timestamp only, user-status labels, byte formatting); `lib/format.ts` gained `formatServerDateTime`; new `pages/AdminPage.tsx` (login gate + Users/Settings tabs) and `components/admin/AdminLoginForm.tsx`, `AdminUsersPanel.tsx` (search/status-filter/sort-by-email-or-registration-date/pagination, per-row activate-with-quota and disable-with-confirmation), `AdminSettingsPanel.tsx` (default quota, global upload toggle, stats). New `components/RegistrationNoticeModal.tsx`, wired into `TopBanner.tsx`'s registration form so submitting shows the modal (covering admin-approval gate, private-by-default sharing, email-as-notification-address, and guest-mode-uploads-nothing) and only explicit acknowledgement creates the account. `StatusPanel.tsx` label rename "Without GPS" → "Discarded (No GPS)"; `types.ts` gained `IngestStatus.gpsRequiredNotice`; `lib/ingest/index.ts` catches `ApiError` with `code === 'gps_required'` distinctly, mirroring the existing quota-exceeded pattern rather than adding a new counter (to avoid touching ~8 existing test files that construct literal `IngestStatus` objects). `lib/timeline.ts` gained `yearsPresent`, `computeYearBins`, `computeMonthBins`, `computeDayBins`, `MONTH_LABELS`, an optional `label` field on `TimelineBin`; `TimelineStrip.tsx` gained the `density|year|month|day` navigation level with breadcrumbs and an axis-label row, drilling down at year/month levels and applying the date filter at day level (or unchanged density mode).

## Testing information
Backend: full PHPUnit suite (166 tests) run via Docker (`docker compose run --rm --no-deps php composer test` from `backend/`, matching the documented CI-equivalent path since `DB_HOST=mysql`/`STORAGE_PATH=/app/storage` only resolve inside the Docker network). New Feature tests: `AdminAuthFeatureTest`, `AdminUsersFeatureTest` (including a dedicated test asserting the share-link indicator is existence-only and never the raw token), `GpsRequiredFeatureTest`, `RegistrationApprovalFeatureTest`; new Unit tests: `AdminAuthControllerTest`, `MailNotificationsTest`, `UserRepositoryTest`; new test doubles `FakeMailer`/`FailingFakeMailer`. Final state: 166 tests, 440 assertions, 0 failures/errors, confirmed deterministic across multiple independent clean runs.
Frontend: Vitest suite, new/extended test files `adminUsers.test.ts`, `adminStore.test.ts`, `adminPage.test.tsx`, `adminUsersPanel.test.tsx`, `timelineStrip.test.tsx`, plus extensions to `timeline.test.ts`, `router.test.tsx`, `ingest.test.ts`, `components.test.tsx` (registration-notice gating, label rename). Final state: 24 test files, 173 tests, all passing; `tsc --noEmit` clean; `vite build` succeeds with no type errors.

# Deep Dives
Q: Is the "notification email" mentioned in the plan a separate field from the account's login email?
A: No. The backend schema has no separate column for it; it reuses the existing account/registration email. The registration popup explains this rather than adding a new input.

Q: Does "replace the timeline" mean discarding and rebuilding the existing density-heatmap logic from scratch?
A: No. The existing canvas-based density-heatmap rendering (already correct) was kept as the default view; a calendar-axis (year/month/day) navigation/drill-down layer was added on top of/alongside it.

Q: Should the admin section share the guest-mode store or main app state?
A: No. It is a fully separate page/component tree, following the existing pattern of the `/share/:token` page, and never touches `photoStore`/`authStore`.

Q: (Raised during implementation) Why did the backend test suite show non-deterministic failure counts across runs on first audit?
A: Root-caused to three backend test-infrastructure bugs, all now fixed: (1) `tests/Support/ServerProcess.php`'s `.env.test` parser stripped only double quotes, leaving literal single-quote characters attached to `ADMIN_PASSWORD_HASH` and breaking `password_verify()` for every admin-auth Feature test; (2) `StorageQuotaService::reserveAndInsert()` had no handling for genuine MySQL deadlocks (SQLSTATE 40001) under concurrent same-user uploads, now wrapped in a retry-with-backoff loop; (3) one Feature test (`AdminUsersFeatureTest::testShareLinkIndicatorIsExistenceOnlyNeverTheRawToken`) reused a single cookie-jar/HTTP client across two logged-in users, invalidating an earlier CSRF token; fixed by using independent HTTP clients per user, matching the pattern already used elsewhere in the suite. A fourth, unrelated latent bug (`JsonResponse.php` collapsing whole-number floats to ints over JSON, e.g. lat/lon `12.0` → `12`) was also found and fixed globally rather than patched around in one test. None of these were feature-logic defects in the new admin/quota/mail/GPS code itself, which was independently verified correct.

Q: Is the admin credential a reversible/encrypted secret or a one-way hash?
A: One-way `password_hash()`/`password_verify()` (bcrypt via `PASSWORD_DEFAULT`) — this was a deliberate, correct choice since it's a login credential, not a value needing recovery. Verified: never stored, logged, or compared as plaintext anywhere in code or config. `backend/README.md` and `config.php.example` both contain clear step-by-step instructions, including a copy-pasteable `php -r 'echo password_hash(...);'` one-liner, for generating the hash.

---

# Process tooling: release script, crash-resumability, agent-pipeline consolidation, doc compaction (v1.1.0) - Sun Sep 6 10:43:21 BST 2026

## Context of the changes
Photomap is built by a multi-agent workflow (coordinator → product-owner/architect/developer/tester → advisor → implementer → documenter). Two real problems surfaced from actually operating this workflow: (1) when a session hit its rate limit mid-implementation on the v1.0.0 release, there was no structured way to resume — a human had to manually reconstruct plan state from `git status`; (2) the 4-parallel-briefings + advisor + implementer + documenter pipeline burns a lot of tokens re-reading `docs/product.md`, `docs/architecture.md`, and `docs/code.md` redundantly (product.md read by product-owner AND advisor; architecture.md read by architect AND advisor; code.md read by developer AND tester AND advisor). This release fixes both, plus makes the release-build story explicit, plus trims documentation bloat. No end-user-facing product behavior changes in this release — it is entirely internal tooling/process.

## Architectural Impact
This release touches only: (a) a new top-level release-build convenience entry point, (b) the `.claude/agents/*.md` agent definitions that drive future coordinator runs, (c) a new small piece of on-disk state used only for crash/session-limit recovery of an in-progress change, (d) `docs/*.md` content (trimmed, not restructured). It does not touch the running application (frontend or backend) at all.

## Code changes

### 1. Make the release-build step explicit and well-documented
A release-packaging script already exists at `backend/scripts/package-for-deploy.sh` (builds the frontend, installs backend prod deps, assembles `release/photomap-backend/` and `release/domain.com/`) and is documented in the root `README.md`'s "Deploying to Dreamhost" section. Verify this actually satisfies "run one script, then just copy files and optionally run the DB migration script" end to end — read the script and the README section in full before changing anything, since duplicating a working thing would be wasted work. Likely gaps to close:
- There is no top-level `npm run release` (or similar) convenience command — a user has to already know the script lives under `backend/scripts/`. Add one (e.g. an npm script in the root `package.json` that runs `bash backend/scripts/package-for-deploy.sh`).
- The script and its documentation are framed entirely under "Deploying to Dreamhost," even though the script's own header comment says it isn't Dreamhost-specific. Rework the README so there's a clearly-labeled, host-agnostic "Building a release" step (run the script → get `release/photomap-backend/` and `release/domain.com/`) followed by a separate "upload + migrate" step, with the Dreamhost section narrowing down to host-specific upload/config details rather than owning the whole release story.
- Confirm the migration step is clearly and separately documented as "run after copying files, only if there are new/pending migrations" (it already should be `php scripts/migrate.php` per the existing script comments — verify, don't reinvent).
- Fix anything broken along the way (e.g. run the script for real and confirm it still produces a working `release/` tree with the current codebase).

### 2. Crash/session-limit resumability for the coordinator pipeline
Introduce a durable, on-disk checklist mechanism so any future coordinator-driven change can resume after a killed session (rate limit, crash, interrupt) instead of a human having to manually reconstruct state from `git status` and memory (which is literally what happened after v1.0.0's implementer got killed).

- Add a single fixed-path state file, e.g. `.claude/state/current-change.md` (create the `.claude/state/` directory; add it to `.gitignore` — this is transient working scaffolding, not project history, and must never collide with or replace `docs/plans.md`, which remains the append-only *finished* record).
- The file holds: the full finalized plan text, plus an ordered, numbered checklist of every concrete step needed to deliver the change **including the documentation-update steps** (this is the key link to item 3 below — documentation is not a separate afterthought step anymore, it's checklist items like every other step). Each checklist item is a markdown checkbox (`- [ ]` / `- [x]`).
- Whichever agent is doing the work (see item 3 — this becomes the merged implementer agent) creates this file at the start of a change (if it doesn't already exist) and checks off (`- [x]`) each item immediately after completing it — not in a batch at the end — so the file always reflects true current progress even if the process is killed mid-step.
- When every item is checked off (implementation, tests, AND all doc updates), the same agent deletes `.claude/state/current-change.md` as its last action — its job is done and `docs/plans.md`/`docs/original_prompts.md` are now the permanent record.
- The coordinator's process must gain a step 0, run before anything else: check whether `.claude/state/current-change.md` exists. If it does, this invocation is a **resume**, not a new change — skip analysis entirely (don't re-run the analyser), hand the existing state file's content straight to the implementer with an instruction to resume from the first unchecked item, and continue. If it doesn't exist, proceed with the normal new-change flow.
- Design the exact checklist granularity and file format with your own engineering judgment — the goal is that a fresh agent with zero memory, reading only this one file, can tell exactly what's done and what's left, without needing to re-derive it from `git status` the way a human had to yesterday.

### 3. Consolidate the agent pipeline to cut redundant analysis token spend
Currently a single coordinator run makes 4 parallel briefing calls (product-owner, architect, developer, tester) + 1 advisor call + 1 implementer call + 1 documenter call = 7 subagent invocations, several of which re-read the same docs (`docs/product.md`, `docs/architecture.md`, `docs/code.md`) from scratch. Consolidate to exactly 2 subagent types:

- **`analyser`** (new agent, replacing product-owner + architect + developer + tester + advisor): a single agent that reads `docs/product.md`, `docs/architecture.md`, and `docs/code.md` **once each**, produces the same overall plan structure the coordinator currently composes from four briefings (Context of the changes / Architectural Impact / Code changes / Testing information / Deep Dives), and performs the advisor's self-sanity-check internally before returning (i.e., it should critique and, if needed, revise its own draft plan before returning it as final — don't just skip that quality gate, fold it in). It also produces the ordered, numbered checklist described in item 2 (implementation steps + doc-update steps, in delivery order) as part of its output, since the coordinator no longer composes the plan from multiple pieces itself. Tools: same read-only set the current analysis agents have (Read, Grep, Glob, Bash) — no Write/Edit, it never touches code.
- **`implementer`** (rewritten, absorbing the current `documenter` agent's job): implements the code change, runs tests, AND updates `docs/product.md`, `docs/architecture.md`, `docs/code.md`, appends to `docs/plans.md` and `docs/original_prompts.md` — all as steps in the same checklist from item 2, in the same invocation/session of work (not literally one unbroken tool-call sequence necessarily, but one logical agent responsible end-to-end, so a killed session resumes into the same agent role rather than needing a handoff). It owns creating, updating, and finally deleting `.claude/state/current-change.md` as described in item 2. Tools: Read, Write, Edit, Bash, Grep, Glob (the union of the current implementer's and documenter's tool sets — already identical).
- Delete the now-superseded agent definition files: `.claude/agents/product-owner.md`, `.claude/agents/architect.md`, `.claude/agents/developer.md`, `.claude/agents/tester.md`, `.claude/agents/advisor.md`, `.claude/agents/documenter.md`.
- Rewrite `.claude/agents/coordinator.md` end to end: its process becomes: step 0 (check for an in-progress state file, per item 2), step 1 (call `analyser` once with the full change request), step 2 (resolve any open questions from the analyser's Deep Dives — answer from context yourself where possible, otherwise ask the user via AskUserQuestion, exactly as it does today), step 3 (call `implementer` once with the finalized plan+checklist), step 4 (report to the user). Keep the existing "every subagent starts with zero memory, restate everything verbatim" discipline, and the existing final user-report style (concise, pointer to `docs/plans.md`, not a full dump). Update the coordinator's frontmatter `description` to match the new 2-agent process.
- Preserve behavior/quality bar: nothing about the actual planning rigor (questions raised, deep-dives resolved, advisor-equivalent scrutiny, security requirements called out for the PHP/MySQL backend, silent focused implementation, doc accuracy) should get worse just because it's fewer agent hops — this is a token/latency optimization via de-duplicated doc reads and fewer hops, not a quality cut.

### 4. Documentation compaction pass
Review `docs/product.md` (260 lines), `docs/architecture.md` (754 lines), and `docs/code.md` (786 lines) for content that made sense as a blow-by-blow of early development but is now redundant, superseded, or over-detailed relative to what a fresh analysis agent actually needs to ground itself. These three files are each read in full by at least one (soon: the single `analyser`) agent on every future coordinator run, so their size is a direct, recurring token cost — unlike `docs/plans.md` and `docs/original_prompts.md`, which are write-only history nothing currently reads back in. Where you find superseded narrative (e.g. describing an intermediate state later changed by a subsequent phase, or restating something now better said once in the current-state description), tighten it to reflect current reality concisely, without losing information a future analyser would actually need (constraints, decisions with non-obvious rationale, current data model, current architecture). Do not touch `docs/original_prompts.md` at all — verified append-only, working as intended, is the literal verbatim historical record and must never be summarized or edited. Leave `docs/plans.md` as append-only for entries prior to and including this one; if you judge older entries in it are pure token bloat with no read consumer, note that as an observation in your report rather than silently rewriting a document explicitly specified elsewhere as append-only-forever — that's a call for the user, not silent cleanup.

## Testing information
- After building the release-script/docs changes, actually run `bash backend/scripts/package-for-deploy.sh` (or the new npm wrapper) and confirm it completes and produces a sane `release/` tree.
- After the agent-pipeline consolidation, there's no automated test for markdown agent-definition files — instead, sanity-check the new `analyser.md` and rewritten `implementer.md`/`coordinator.md` for internal consistency (tool lists match what's actually used, process steps reference the right agent names, frontmatter descriptions accurate) by reading them back after writing.
- Run the existing backend and frontend test suites (`composer test` or equivalent under `backend/`, `npm test` at root) to confirm this release touched nothing that broke them — it shouldn't have, since no application code changes, but confirm rather than assume.
- No new application-level tests are needed since no product behavior changed.

# Deep Dives
- Q: Should `.claude/state/current-change.md` be committed to git? A: No — it's transient in-progress scaffolding for the currently-running change, not project history; add `.claude/state/` to `.gitignore`. `docs/plans.md` remains the permanent, committed historical record, written once a change completes.
- Q: What if a coordinator run starts while `.claude/state/current-change.md` already exists but the user is actually asking for a brand-new, unrelated change? A: Surface this to the user rather than guessing — this is exactly the kind of case where asking is warranted (two genuinely different changes can't both be "the" in-progress state file). Use your judgment on exact wording when you write the coordinator's step 0 instructions.
- Q: Does the analyser still run an advisor-equivalent "revise if needed" loop, or just one pass? A: One pass is fine (draft the plan, then critique your own draft against the same concerns the old advisor agent checked for — feasibility, security requirements on the PHP/MySQL backend, consistency with current docs — and fix issues before returning), since the old advisor's realistic value was mostly catching things the four separate briefings missed by not talking to each other; a single agent with the full picture already avoids most of that failure mode.
- Q: (Raised during implementation) Did the release-packaging script actually still work end to end against the current codebase? A: Yes, after fixing an unrelated pre-existing local-environment issue: `backend/vendor/` contained files left root-owned by an earlier session's Docker run, which made `composer install --no-dev` (part of `package-for-deploy.sh`) fail mid-uninstall. Fixed with a one-off `chown` via a throwaway Docker container (not a code or plan change), then `npm run release` produced a correct `release/photomap-backend/` + `release/domain.com/` tree; dev dependencies (removed by the `--no-dev` install) were restored afterward so the backend test suite could still run.
- Q: (Raised during implementation) How much should the documentation-compaction pass (item 4) actually cut? A: A conservative, safe pass — the clearest redundancy only (a ~104-line "Resolved architecture questions" Q&A section in `docs/architecture.md` that fully duplicated rationale already stated in the phase narratives above it, condensed to a one-line-per-decision index; a per-file frontend test list in `docs/code.md` condensed into grouped by-area summaries) — rather than a deeper rewrite, since the risk of silently losing information a future analyser needs outweighs further token savings within this change's scope. Noted as an observation for the user (not acted on): the phase-by-phase narrative in `docs/architecture.md`/`docs/code.md`, and some older `docs/plans.md` entries, likely have further compaction headroom if wanted later.

---

# Registration Hardening, Deploy Automation, UI/Map Layout Fixes, Countries-Visited Feature, and Dreamhost De-Branding - Sun Sep  6 21:05:16 BST 2026

## Context of the changes

This release bundles six independent but simultaneously-requested changes on top of v1.1.0 (process/tooling) and the prior v1.0.0 (admin/registration-approval/GPS-discard/timeline-heatmap) and Phase 4 (shared-hosting deploy) releases. None of them change the core map+timeline value proposition; they are a mix of de-branding, deploy tooling, layout bugfixes, and two small net-new features (a countries-visited view, registration anti-spam hardening).

1. **De-brand deploy docs/scripts.** The user deploys to Dreamhost personally but does not want the product's own committed docs/scripts to name that host. Everything under `docs/*.md`, `README.md`, `backend/README.md`, `backend/config.php.example`, code comments, and the `deploy/dreamhost/` directory name itself currently advertise "Dreamhost" as the worked example, even though the mechanism was always documented as generic Apache+PHP+MySQL shared hosting. This is pure de-branding — no behavior changes.

2. **Deploy automation.** `npm run release` today only builds the local `release/` artifact; the user still has to manually SFTP two directories and SSH in to run the migration script. This adds an opt-in automated upload+remote-migrate path, gated behind a gitignored, chmod-600, key-auth-only config file, with a concrete numbered manual fallback always available.

3. **UI overlap bugfix.** Confirmed in the actual CSS (not hypothetical): `StatusPanel` (`top: 0.75rem; right: 0.75rem; z-index: 1000`) and `MapStyleToggle` (`top: 0.6rem; right: 0.6rem; z-index: 1000`) are both absolutely positioned in the exact same top-right corner of the same `position: relative` ancestor (`.upload-control` → `.map-view`), with near-identical offsets and identical stacking level — they visually overlap by construction, not just "at certain viewport sizes." This is a real, reproducible layout bug, not a hypothetical one.

4. **Map zoom-out world-repeat + layout share.** `MapView.tsx` creates the Leaflet map with no `minZoom`, no `maxBounds`, no `noWrap` — standard Leaflet behavior at low zoom is therefore to repeat the world horizontally. Separately, the product wants the map to visually dominate the viewport (large majority) while controls live in a genuine side region rather than floating over it — which also fixes part of item 3's overlap problem architecturally, not just cosmetically.

5. **Countries-visited feature.** New client-derived view: for every photo with usable GPS, resolve which country it was taken in and which month/year(s) photos exist for that country. The existing `geocode_cache`/Nominatim path is account-mode-only, requires a login session, and stores an unstructured `place_name` display string (not a structured country field) — using it would (a) not work in guest mode at all, since guest mode must never transmit GPS coordinates off-device (violating the core "your photos never leave this device" guarantee, which explicitly includes GPS coordinates, not just photo bytes), and (b) require parsing English place-name strings for country, which is unreliable. The correct fit is a new, fully client-side, offline country-boundary lookup (bundled simplified world-country polygon data + point-in-polygon), reusable identically by both modes and the share view, with zero network calls and zero backend involvement.

6. **Registration anti-spam hardening.** Checked the actual code: `AuthController::register()` today has zero throttling, no honeypot, no timing check, no disposable-domain check — only email-uniqueness and an 8-char password minimum, plus the CSRF requirement every state-changing endpoint already has. Login already has per-account/per-IP rate limiting (`RateLimiter`/`login_attempts`); registration has none of that. Since v1.0.0 already gates uploads behind admin approval, this closes the gap one step earlier — stopping bot signups from ever reaching that admin queue.

None of these six items change guest-mode's "photos never leave the browser" guarantee, and none require login/backend to work in guest mode except item 6 (registration is inherently account-mode/backend-only) and item 2 (backend-adjacent deploy tooling).

## Architectural Impact

Frontend-only: items 3, 4, 5. Backend-only: item 6 (plus doc/script items 1 touches both). Deploy-tooling-only (root + `backend/scripts/`, `deploy/`): items 1, 2. No new frontend/backend runtime coupling is introduced by any of these.

Item-by-item architectural notes:

- **Item 1** touches no runtime code paths at all — pure renames/rewording across `deploy/dreamhost/` → `deploy/shared-hosting/`, doc prose, and script comments. `docs/plans.md` and `docs/original_prompts.md` are explicitly append-only historical records (per the v1.1.0 plan's own resolved decision and the coordinator process rules) and must **not** be rewritten — they record what a past change was actually called and did. Resolution recorded in Deep Dives below: scope the removal to every current-state/forward-looking document and script, not the historical log.
- **Item 2** adds one new script (`backend/scripts/deploy.sh`) and one new gitignored+example config pair. No new language runtime dependency: reuses `jq` (already a documented `smoke-test.sh` dependency) for config parsing, and `rsync`/`ssh`/`scp` (already-present OpenSSH client tooling) for transfer/execution — consistent with the project's established minimal-dependency posture (hand-rolled router, hand-rolled rate limiter, raw `ext-gd`, no ORM).
- **Item 3/4** are pure frontend layout changes: `App.css`/`App.tsx` gain a real two-region CSS grid/flex layout (map region + side-panel region) instead of every panel being absolutely positioned over the map; `MapView.tsx` gains `minZoom`, `maxBounds` (world bounds) + `maxBoundsViscosity: 1.0`, and `noWrap: true` on the tile layer.
- **Item 5** adds one new static data asset (bundled, MIT/public-domain country boundary GeoJSON, simplified 110m resolution) and one new pure-logic module, reusing the existing `computeMarkerGroups()` grouping (one point-in-polygon test per marker group, not per photo, for performance) — no new npm dependency, no backend involvement, works identically in guest mode, account mode, and (optionally) the read-only share view.
- **Item 6** adds one migration (`registration_attempts` table), one new repository/service pair mirroring the existing `LoginAttemptRepository`/`RateLimiter` pattern, a static disposable-domain list service, and extends `AuthController::register()`'s validation chain — no change to the CSRF/session/password-hashing machinery, which already meets the backend security bar.

## Code changes

### Item 1 — De-brand deploy docs/scripts

- `deploy/dreamhost/` → **renamed** to `deploy/shared-hosting/` (`.htaccess`, `api/index.php`, `verify-apache-routing.sh`), with every internal comment referencing "Dreamhost" reworded to generic "shared host"/"your host's panel" language.
- `backend/scripts/package-for-deploy.sh` — update the two `cp` lines and header/footer comments that reference `deploy/dreamhost/*` and "Dreamhost" to `deploy/shared-hosting/*` and generic wording.
- `backend/config.php.example` — reword every Dreamhost-specific inline comment (DB host convention, HTTPS/APP_ENV ordering pitfall, disk-quota note, mail() note, SSH note) to generic shared-hosting language.
- `backend/.htaccess`, `backend/src/Config.php`, `backend/src/Services/PhpMailMailer.php` — reword comments only, no logic changes.
- `backend/tests/Unit/ConfigTest.php`, `backend/tests/Feature/SecurityFeatureTest.php` — reword doc-comments only (no test-behavior changes).
- `README.md` (root) and `backend/README.md` — rename the "Deploying to Dreamhost (shared hosting)" sections to "Deploying to a shared host (Apache + PHP + MySQL)", reword all body prose, update the project-layout listing (`deploy/dreamhost/` → `deploy/shared-hosting/`), update the manual-verification-checklist header wording.
- `docs/product.md` — reword the "Shared-hosting deployment (e.g. Dreamhost)…" bullet block under "Deployment and privacy, at a glance" to generic shared-hosting language.
- `docs/architecture.md` — rename "Phase 4 — shared-hosting (Dreamhost) deployment support" → "Phase 4 — shared-hosting deployment support"; reword every inline Dreamhost mention (layout diagram's `~/` comment, `domain.com` comment, "Dreamhost gives one directory per domain" etc.) to generic language; add one line noting the directory was renamed from `deploy/dreamhost/` to `deploy/shared-hosting/` as part of this later change (so the historical layout diagram doesn't silently mismatch reality).
- `docs/code.md` — rename the "Shared-hosting deployment tooling (`deploy/dreamhost/`…)" section header and its content to `deploy/shared-hosting/`, reword remaining Dreamhost mentions.
- **Not touched**: `docs/plans.md`, `docs/original_prompts.md` (append-only historical record — see Deep Dives). You WILL still append new entries to these two files for this change itself, per the normal process — you just must not retroactively edit their existing historical entries to remove "Dreamhost".
- Final verification: `grep -ril dreamhost .` (case-insensitive, excluding `.git/`, `docs/plans.md`, `docs/original_prompts.md`) must return empty.

### Item 2 — Deploy automation

- New `deploy.config.example.json` (repo root, committed): template with `sshHost`, `sshPort`, `sshUser`, `sshKeyPath`, `remoteBackendPath`, `remoteFrontendPath`, `remoteMigrateCommand`, optional `postDeployCommands: []`. Explicit inline comment: "password-based auth is not supported by the automated path for security reasons — see deploy.sh's fallback instructions if you only have password auth."
- New, **gitignored** `deploy.config.json` (repo root — real values, never committed): add `/deploy.config.json` to root `.gitignore` in the same change that introduces it. Do NOT create a real populated `deploy.config.json` with real credentials — only the `.example` template is shipped.
- New `backend/scripts/deploy.sh`:
  1. Runs `package-for-deploy.sh` first (reused, not duplicated) to produce `release/`.
  2. Looks for `deploy.config.json` at the repo root. If found, `chmod 600` it immediately (auto-enforced, logged — not left for the user to remember) and validates required fields via `jq`.
  3. **Automation path** (only when `sshHost`/`sshUser`/`sshKeyPath`/`remoteBackendPath`/`remoteFrontendPath` are all present and `sshKeyPath` points to a readable file): `rsync -az -e "ssh -i <key> -p <port>" release/photomap-backend/ <user>@<host>:<remoteBackendPath>/` and the same for the frontend docroot directory → `<remoteFrontendPath>/`, falling back to `scp -r` if `rsync` isn't on `PATH`; then `ssh -i <key> -p <port> <user>@<host> "<remoteMigrateCommand>"` plus any `postDeployCommands`, printing each command's real output.
  4. **Fallback path** (config missing, incomplete, or only a password field is set — password-based automation is deliberately never attempted): prints an exact, numbered, step-by-step manual checklist using whatever concrete values the config file *does* specify (or the same concrete example paths already used throughout the README when no config exists at all), e.g. "1. Upload `release/photomap-backend/` via SFTP to `~/photomap-backend/`… 2. Upload the contents of the frontend release directory via SFTP to `~/yourdomain.com/`… 3. SSH in and run `cd ~/photomap-backend && php scripts/migrate.php`."
- `package.json` — add `"deploy": "bash backend/scripts/deploy.sh"` alongside the existing `"release"` script.
- Root README.md's new (post-item-1) "Deploying to a shared host" section gets a new "Automating the upload" subsection documenting `npm run deploy`, the config file, the key-auth-only decision, and the always-available fallback instructions.
- Verify: `deploy.config.json` is git-ignored (never appears in `git status` after being created locally for testing — delete any local test copy before finishing); config file gets `chmod 600` automatically when present.

### Item 3/4 — UI overlap fix + map zoom-out/layout

- `src/App.css` / `src/App.tsx`: replace the current flat-flow layout (where `UploadControl` wraps `MapView` + `StatusPanel` as absolutely-positioned overlay children) with a real two-region layout — a CSS grid/flex row: a `.app__map-region` (the map, taking the large majority of width, e.g. `flex: 3` or `grid-template-columns: 1fr 300px`) and a `.app__side-region` (containing `StatusPanel`, `UnlocatedPhotosPanel`, and the new `CountriesPanel` — moved out of absolute-over-map positioning into normal document flow in this side column). `UploadControl.tsx`'s drag-and-drop zone stays scoped to the map region only.
- `src/components/StatusPanel.css`: remove `position: absolute`/`top`/`right`/`z-index`; becomes a normally-flowed block in the side region.
- `src/components/UnlocatedPhotosPanel.css`: move into the side region's flow (confirm it slots cleanly into the new side region instead of wherever it lives today).
- `src/components/MapStyleToggle.css`: remains the **only** on-map absolute overlay (a small, genuinely map-native control, same convention as Leaflet's own zoom controls) — kept at top-right, since `StatusPanel` no longer shares that corner.
- `src/components/UploadControl.css`: `.upload-control__panel` (folder-select button) stays as the one other legitimate on-map overlay (top-left, opposite corner from `MapStyleToggle`) — no collision.
- `src/components/MapView.tsx`: map-creation `useEffect` gains `minZoom: 2`, `maxBounds: L.latLngBounds([-90, -180], [90, 180])`, `maxBoundsViscosity: 1.0`; the tile-layer-creation effect adds `noWrap: true` to `L.tileLayer(...)` options for both Detailed and Treasure Map styles — do not touch `maxZoom` or the existing treasure-map zoom-cap decision documented in docs/architecture.md, only add the world-repeat prevention.
- Do NOT restructure `TopBanner`, `PrivacyNote`, `AccountNotice`, `FilterBar`, or `TimelineStrip` — confirmed already in normal document flow, not overlapping anything; out of scope for this change.
- New/updated test coverage: `mapView.test.tsx` assertions on the tile layer's `noWrap`/map's `minZoom`/`maxBounds` options; a layout/component test confirming `StatusPanel`'s rendered DOM is no longer inside the map's absolute-overlay tree.

### Item 5 — Countries-visited feature

- New static asset `public/data/countries-110m.geo.json` (Natural Earth 1:110m admin-0 country boundaries, public domain, simplified — ~150-250KB) bundled and served as-is (same pattern as `public/config.js`). If you cannot fetch an actual Natural Earth dataset in this environment, use your judgment to source or construct a reasonably accurate simplified world country boundary GeoJSON sufficient for correct point-in-polygon country resolution for common test cases (e.g. major cities/landmarks) — accuracy at coastlines/disputed borders is not required to be perfect, but common-case correctness (e.g. Eiffel Tower → France, Tokyo → Japan) must work.
- New `src/lib/countryLookup.ts`: `loadCountryBoundaries()` (fetches/caches the bundled GeoJSON once), `findCountryForPoint(lat, lon): string | null` (hand-rolled ray-casting point-in-polygon supporting `Polygon`/`MultiPolygon` with holes, with a cheap per-country bounding-box pre-check before the full ray-cast) — no new npm dependency.
- New `src/lib/countries.ts`: `computeCountryVisits(photos: PhotoRecord[]): CountryVisit[]` — reuses `computeMarkerGroups()` from `lib/grouping.ts` to do exactly one lookup per marker group (not per photo), maps each group's photos' timestamps into distinct `{year, month}` pairs per country, and returns a sorted `{ countryName: string; visits: { year: number; month: number }[] }[]`.
- New `src/components/CountriesPanel.tsx` + `.css`: a toggle-triggered panel (same UX convention as `UnlocatedPhotosPanel`'s collapsible toggle) listing every country with its month/year visit(s) (e.g. "France — Jun 2019, Aug 2021"), rendered from `computeCountryVisits(allPhotos)`.
- `src/App.tsx`: mounts `CountriesPanel` in the new side region (from item 3/4's layout), driven by the same all-photos data already computed there.
- Optional, low-risk extension: `src/pages/SharePage.tsx` also renders `CountriesPanel` with its local photos state — your call, not required for sign-off but nice to have if low-risk.
- New tests: `countryLookup.test.ts` (known lat/lon fixtures — e.g. Eiffel Tower → France, Tokyo → Japan, a mid-ocean point → null — verified against the bundled GeoJSON), `countries.test.ts` (grouping/dedup/sort logic with synthetic photo record fixtures spanning multiple countries and repeat visits in different years), `countriesPanel.test.tsx` (renders expected list, toggle open/closed).

### Item 6 — Registration anti-spam hardening

- New migration `backend/migrations/0009_add_registration_attempts.sql`: `registration_attempts` table (`id`, `ip_address`, `created_at`, indexed on `(ip_address, created_at)`) — a dedicated table, not reusing `login_attempts` (different semantics: every registration POST counts, not just failures against an existing account).
- New `backend/src/Repositories/RegistrationAttemptRepository.php` (mirrors `LoginAttemptRepository`'s shape: `countRecentByIp()`, `record()`).
- New `backend/src/Services/DisposableEmailDomainList.php`: a static, hardcoded, curated list of ~30-50 well-known disposable-email domains (mailinator.com, guerrillamail.com, 10minutemail.com, yopmail.com, tempmail.com, throwawaymail.com, sharklasers.com, maildrop.cc, dispostable.com, getnada.com, trashmail.com, fakeinbox.com, etc.) with an `isDisposable(string $email): bool` helper (case-insensitive domain match, including subdomain matching).
- `backend/src/Controllers/AuthController::register()` — extended validation chain, in this order, each with its own distinct error code (consistent with the app's existing typed-error-code convention — `email_taken`, `gps_required`, `webp_unsupported`, etc.):
  1. **Honeypot**: a hidden, off-screen (not `display:none`, to defeat bots that skip hidden fields) form field, e.g. `website`; non-empty → `422 bot_detected` (logged via `error_log`, no account created).
  2. **Timing**: request body carries `formRenderedAt` (epoch ms, captured client-side when the registration form first mounts/switches into register mode); if `now - formRenderedAt < REGISTRATION_MIN_FORM_SECONDS * 1000` (default `2`, env-configurable, `0` disables the check) → `422 bot_detected`.
  3. **Per-IP rate limit**: `RegistrationAttemptRepository::countRecentByIp()` against `RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS`/`RATE_LIMIT_REGISTRATION_WINDOW_SECONDS` (new env vars, defaults e.g. `5`/`3600`) → `429 too_many_attempts` (same code login already uses for the analogous case). Every registration POST is recorded via `RegistrationAttemptRepository::record()` regardless of outcome, mirroring `login_attempts`' "record everything" pattern.
  4. **Disposable email domain**: `DisposableEmailDomainList::isDisposable($email)` → `422 disposable_email`, with a clear user-facing message.
  5. Existing checks unchanged (email format, password length, email-uniqueness).
- `backend/.env.example` / `backend/config.php.example` — document `RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS`, `RATE_LIMIT_REGISTRATION_WINDOW_SECONDS`, `REGISTRATION_MIN_FORM_SECONDS`.
- `backend/src/Bootstrap.php` — wire the new repository/service into `AuthController`'s constructor.
- Frontend: `src/components/TopBanner.tsx` — the register-mode form gains a hidden honeypot input (`autoComplete="off"`, `tabIndex={-1}`, `aria-hidden="true"`, positioned off-screen via CSS rather than `display:none`) and captures `formRenderedAt` (a `useRef`/`useState` timestamp set when `mode` first becomes `'register'`); `src/lib/api/authApi.ts`'s `register()` and `src/state/authStore.ts`'s `register` action both extend their signature to pass `honeypot`/`formRenderedAt` through.
- New/updated tests: `RegistrationHardeningFeatureTest.php` (honeypot rejection, timing rejection, per-IP throttling, disposable-domain rejection, and a control case proving a normal legitimate registration still succeeds unaffected), `DisposableEmailDomainListTest.php` (Unit), extended `authStore`/`TopBanner`/`authApi` frontend tests for the new fields (asserting the honeypot field is never visible/tabbable and `formRenderedAt` is sent).

**IMPORTANT — decision on third-party CAPTCHA (this was the one open question, now resolved):** Do NOT implement any third-party CAPTCHA service (no Cloudflare Turnstile, no reCAPTCHA, no hCaptcha) in this release. Ship only the no-dependency stack described above (honeypot + timing check + per-IP rate limit + disposable-email-domain blocklist). This decision was made because the AskUserQuestion tool was unavailable to the coordinator in this run, so the coordinator adopted the analyser's own well-reasoned recommendation rather than leaving it unresolved; it will be flagged clearly to the user in the final report as a decision they can revisit later if spam signups persist in practice. Record this Q&A resolution explicitly in docs/architecture.md's Deep Dives / resolved-questions material for this change, including the fact that it was resolved by the coordinator adopting the analyser's recommendation (AskUserQuestion was unavailable), not by direct user confirmation, so it's clearly flagged as revisitable.

### Cross-cutting docs updates (all items)

- `docs/product.md` — new "Countries visited" bullet under whichever mode sections apply (likely a small subsection since it's shared by guest and account mode); update the de-branded Dreamhost bullet (item 1) to generic shared-hosting language; add a one-line registration-hardening note under the existing registration/admin-approval description; a one-line mention that the map now takes up most of the viewport with controls in a side region.
- `docs/architecture.md` — new phase section covering: the de-branding rename (item 1), the deploy-automation script/config precedence (item 2), the layout restructuring (item 3/4, including the Leaflet `noWrap`/`maxBounds` decision), the country-lookup architecture (item 5, including why `geocode_cache`/Nominatim was rejected as the mechanism), and the registration-hardening additions (item 6, mirroring the existing login-rate-limit pattern, and explicitly recording the CAPTCHA decision above). Update the "Resolved architecture questions" index with one-line entries for each new locked decision.
- `docs/code.md` — update the frontend project layout listing (`CountriesPanel.tsx`, `lib/countries.ts`, `lib/countryLookup.ts`, `public/data/countries-110m.geo.json`, App.css layout restructuring), the backend project layout listing (`RegistrationAttemptRepository.php`, `DisposableEmailDomainList.php`, migration `0009`), the deploy-tooling section (`deploy/shared-hosting/`, `deploy.sh`, `deploy.config.example.json`), and the "Testing" sections with the new test files/counts.
- `docs/plans.md` — append this plan's final entry (this document, updated with the CAPTCHA resolution above) once implemented, per the existing append-only convention.
- `docs/original_prompts.md` — append the verbatim original user request (the six-item release request given to the coordinator) as a new entry, per the existing append-only convention (never edit existing entries, only append).

## Testing information

- **Item 1**: no automated test needed (doc/rename only) beyond a repo-wide `grep -ril dreamhost` sweep (excluding `docs/plans.md`/`docs/original_prompts.md`/`.git/`) returning empty, run manually as a verification step; confirm `backend/scripts/package-for-deploy.sh` still runs end-to-end and produces a correct `release/` tree after the path rename (regression check, since this script's `cp` targets changed).
- **Item 2**: `deploy.sh` fallback-instructions path tested by running it with no `deploy.config.json` present and confirming numbered, concrete instructions print; if a local SSH test target is feasible in this sandboxed environment, test the automation path too (otherwise document that it was code-reviewed but not live-tested against a real SSH target, and explain why); confirm `chmod 600` is applied automatically when the config file is found with looser permissions; confirm `deploy.config.json` is listed in `git status` as ignored (never staged) after creating it locally for a test, then delete the local test copy; confirm a password-only config (no `sshKeyPath`) always falls back to manual instructions and never attempts automated auth.
- **Item 3/4**: `mapView.test.tsx` assertions on `minZoom`/`maxBounds`/`noWrap` map/tile-layer options; a component-level layout test confirming `StatusPanel` and `MapStyleToggle` no longer share the same DOM overlay container. Real-browser visual verification of no world-copy repetition and no panel overlap is not feasible in this environment — document that as a manual follow-up item instead of skipping silently.
- **Item 5**: `countryLookup.test.ts` against known-coordinate fixtures (several countries + a mid-ocean null case + a coastal near-border case); `countries.test.ts` for the grouping/date-dedup logic with synthetic multi-country, multi-year photo record fixtures; `countriesPanel.test.tsx` for render/toggle; manual check that the bundled GeoJSON asset is present in `npm run build`'s `dist/` output.
- **Item 6**: `RegistrationHardeningFeatureTest.php` — honeypot-filled rejected, sub-threshold-timing rejected, per-IP throttle triggers `429` after N attempts within the window then resets after the window, disposable-domain rejected, and a full control-case legitimate registration still succeeds with all four new fields correctly populated/absent as expected; `DisposableEmailDomainListTest.php` (Unit) — case-insensitivity, subdomain matching, non-disposable domains pass; extended frontend tests confirming the honeypot field is genuinely inaccessible to assistive tech/keyboard tabbing and that `formRenderedAt` is captured once per register-mode-entry, not reset on every keystroke.
- Full regression: run `composer test` (backend) and `npm test` (frontend) after all six items land, confirming nothing existing broke — no item here should touch login, upload, sharing, or admin-console logic at all. Report exact pass/fail counts for both suites in your final summary.

## Delivery checklist

1. Create `.claude/state/current-change.md` with this full plan and this checklist (per the v1.1.0 resumability process).
2. **Item 1**: rename `deploy/dreamhost/` → `deploy/shared-hosting/` (git mv the three files).
3. Update `backend/scripts/package-for-deploy.sh`'s two `cp` lines + comments to reference `deploy/shared-hosting/`.
4. Reword all Dreamhost mentions in: `backend/config.php.example`, `backend/.htaccess`, `backend/src/Config.php`, `backend/src/Services/PhpMailMailer.php`, `backend/tests/Unit/ConfigTest.php`, `backend/tests/Feature/SecurityFeatureTest.php`.
5. Reword `README.md` and `backend/README.md`'s "Deploying to Dreamhost" sections to generic shared-hosting language (rename headers, reword body, update layout listings).
6. Run `grep -ril dreamhost .` (excluding `docs/plans.md`, `docs/original_prompts.md`, `.git/`) and confirm empty.
7. Regenerate `release/` via `npm run release` and confirm it still completes and produces a correct tree after the path rename.
8. **Item 2**: add `deploy.config.example.json` (committed) and add `/deploy.config.json` to root `.gitignore`.
9. Write `backend/scripts/deploy.sh` (build → check config → automate via rsync/ssh if fully configured with key auth, else print numbered concrete fallback instructions; auto-`chmod 600` the config file when present).
10. Add `"deploy": "bash backend/scripts/deploy.sh"` to root `package.json`.
11. Test the fallback path (no config) and, if a local SSH test target is feasible in this environment, the automation path; verify `deploy.config.json` never appears in `git status`.
12. Add an "Automating the upload" subsection to the root README's shared-hosting deploy section.
13. **Item 3/4**: restructure `src/App.tsx`/`App.css` into a map-region + side-panel-region layout; move `StatusPanel`, `UnlocatedPhotosPanel`, and the new `CountriesPanel` into the side region's normal document flow.
14. Strip absolute positioning from `StatusPanel.css`; confirm `MapStyleToggle` and the folder-select button remain the only two on-map overlays, in opposite corners.
15. Add `minZoom`, `maxBounds` (world bounds), `maxBoundsViscosity: 1.0` to the Leaflet map instantiation in `MapView.tsx`; add `noWrap: true` to both tile-layer configs.
16. Update/add `mapView.test.tsx` assertions for the new map/tile-layer options; add a layout test confirming `StatusPanel` is no longer in the map's absolute-overlay DOM subtree.
17. Document the real-browser manual verification steps needed (no world-copy repetition at min zoom; no panel overlap at several viewport widths with multiple panels/popups open) as a follow-up note since it can't be automated in this environment.
18. **Item 5**: source and add `public/data/countries-110m.geo.json` (public domain world country boundaries, reasonably accurate for common-case point-in-polygon lookups).
19. Write `src/lib/countryLookup.ts` (bounding-box-accelerated ray-casting point-in-polygon over the bundled data) and its tests.
20. Write `src/lib/countries.ts` (`computeCountryVisits`, reusing `computeMarkerGroups`) and its tests.
21. Write `src/components/CountriesPanel.tsx`/`.css` and its tests; mount it in `App.tsx`'s side region (and optionally `SharePage.tsx`).
22. Confirm the bundled GeoJSON asset appears in `npm run build`'s `dist/` output.
23. **Item 6**: write migration `backend/migrations/0009_add_registration_attempts.sql`.
24. Write `backend/src/Repositories/RegistrationAttemptRepository.php` and `backend/src/Services/DisposableEmailDomainList.php` (+ its Unit test).
25. Extend `backend/src/Controllers/AuthController::register()` with honeypot, timing, per-IP-throttle, and disposable-domain checks, in that order, each with its own error code; wire new dependencies in `Bootstrap.php`. Do NOT implement any third-party CAPTCHA — see explicit decision above.
26. Document new env vars (`RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS`, `RATE_LIMIT_REGISTRATION_WINDOW_SECONDS`, `REGISTRATION_MIN_FORM_SECONDS`) in `backend/.env.example`/`config.php.example`.
27. Write `backend/tests/Feature/RegistrationHardeningFeatureTest.php` covering all four new checks plus a control-case success.
28. Update `src/components/TopBanner.tsx` (hidden honeypot field + `formRenderedAt` capture), `src/lib/api/authApi.ts`, `src/state/authStore.ts` to pass the new fields through; extend their tests.
29. Run full regression: `composer test` (backend) and `npm test` (frontend); confirm 0 failures and no regressions to existing login/upload/share/admin flows. Report exact counts.
30. Update `docs/product.md` (countries-visited feature, de-branded deploy bullet, registration-hardening note, map/layout note).
31. Update `docs/architecture.md` (new phase section covering all six items' architectural decisions, including the explicit CAPTCHA-decision resolution; update the resolved-questions index).
32. Update `docs/code.md` (new files/dirs across frontend and backend, deploy-tooling section, updated test counts).
33. Append this finalized plan (with CAPTCHA resolution folded in) to `docs/plans.md`.
34. Append the verbatim original six-item request to `docs/original_prompts.md`.
35. Delete `.claude/state/current-change.md` as the final step once every item above is checked off and verified.

## Deep Dives

**Q: Does "remove all mentions of Dreamhost from every document" include `docs/plans.md` and `docs/original_prompts.md`?**
A: No — scoped to every current-state/forward-looking document and script (product/architecture/code docs, READMEs, scripts, the `deploy/` directory name), not the append-only historical logs, which must never be retroactively edited.

**Q: Full SFTP/SSH automation vs. numbered-instructions-only fallback for deploy — which, and is it safe?**
A: Both — automation when a fully-populated, key-auth-only config is present; always-available numbered fallback otherwise. Password-based automation is deliberately never implemented. `chmod 600` is auto-enforced by the script itself, and `/deploy.config.json` is added to `.gitignore` as part of this change.

**Q: SFTP protocol literally, or rsync/scp over SSH?**
A: rsync-over-ssh (scp as fallback if rsync unavailable) — same security properties (SSH key auth, encrypted transport), more robust for repeated deploys (delta transfer), no new dependency.

**Q: Third-party CAPTCHA for registration — implement it?**
A: **Resolved: No, not in this release.** See explicit note under Item 6 above — this is the one question that was genuinely left to the user's judgment, but since the AskUserQuestion tool was unavailable to the coordinator in this run, the coordinator adopted the analyser's own recommendation (ship the no-dependency stack; revisit CAPTCHA only if spam persists in practice) rather than blocking indefinitely. This must be flagged clearly in docs/architecture.md as a decision the user can revisit, and the coordinator will flag it prominently in its final report to the user.

**Q: Should the disposable-email-domain list be hardcoded or admin-configurable?**
A: Hardcoded for this change (a `Services/DisposableEmailDomainList.php` constant array), not wired into the admin settings UI/API — reasonable future extension point, not required for this request.

**Q: Registration timing/honeypot false-positive risk for legitimate fast users?**
A: Accepted and mitigated via a conservative, tunable default (`REGISTRATION_MIN_FORM_SECONDS=2`, env-configurable down to `0`) and an off-screen (not `display:none`) honeypot field with `aria-hidden`/`tabIndex={-1}` so no legitimate keyboard/screen-reader user can trigger it.

**Q: Should the countries-visited feature call the existing `GET /api/geocode`/Nominatim path instead of building a new client-side lookup?**
A: No — would violate guest mode's GPS-never-leaves-the-browser guarantee, requires unreliable string-parsing of Nominatim's `display_name`, and is a poor fit for bulk all-photos-at-once computation against a shared 1-req/sec rate limit. A bundled offline client-side country-boundary lookup is strictly better on privacy, reliability, and performance, and works identically in guest mode, account mode, and the share view.

**Q: Should the new side-panel-region layout also restructure the timeline strip or top banner?**
A: No — scoped narrowly to the confirmed overlap bug (`StatusPanel` vs. `MapStyleToggle`) and the requested map-dominance layout goal. `TopBanner`, `PrivacyNote`, `AccountNotice`, `FilterBar`, and `TimelineStrip` already live in normal document flow and don't overlap anything.
