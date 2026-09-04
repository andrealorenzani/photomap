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
