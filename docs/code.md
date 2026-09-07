# Photomap — Code

## Status
The frontend (guest mode + account mode, at the repo root) and the backend (PHP + MySQL accounts
API, at `backend/`) are both implemented and, as of Phase 3, wired together over the backend's
JSON HTTP API. They remain two separately runnable/deployable projects with no shared code — the
frontend has no build-time dependency on the backend and vice versa. As of v1.0.0, both projects
also include a registration-approval/admin-console feature set (a separate `/admin` frontend page
and a separate `/api/admin/*` backend API, both structurally isolated from the main
user-facing app/API), GPS-required account-mode uploads, and a calendar-axis drill-down layer on
the timeline. As of this change (Phase 6), the deploy tooling is de-branded and gained an opt-in
automated upload path, the frontend gained a map-dominant two-region layout (fixing a real
`StatusPanel`/`MapStyleToggle` overlap) and an offline countries-visited feature, and the backend
gained registration anti-spam hardening. This document covers the frontend project first, then
the backend project, then the root-level Docker/deployment tooling that spans both.

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
  Router.tsx                   Hand-rolled path matcher: `/` -> App, `/share/:token` -> SharePage,
                                `/admin` -> AdminPage (not react-router-dom — see
                                docs/architecture.md)
  state/
    photoStore.ts               Zustand store: photos (Map), ingest status, timeline dateFilter,
                                 searchFilters (date range/camera/has-location), selected-photo
                                 id; hydrateFromDB/upsertPhoto/removePhoto/reconcileId/
                                 reassignLocation/setSearchFilters etc.
    authStore.ts                 Zustand store: session status ('idle'|'checking'|
                                 'authenticated'|'guest'), current user; restoreSession/register/
                                 login/logout/deleteAccount; swaps the active PhotoRepository via
                                 lib/db on every status transition
    adminStore.ts                 Separate Zustand store for the admin console (never touches
                                 photoStore/authStore): session states 'idle'|'checking'|
                                 'authenticated'|'anonymous'; restoreSession/login/logout/
                                 clearError; reuses resetCsrfTokenCache() on logout
  lib/
    config.ts                    Reads runtime public/config.js (window.__PHOTOMAP_CONFIG__)
                                  layered over build-time VITE_* defaults; exposes
                                  getApiBaseUrl()/getMapConfig()
    api/
      http.ts                    Shared fetch client: CSRF-token-once-per-session,
                                  credentials:'include', typed ApiError (distinguishes
                                  413 quota_exceeded/422 from generic failures)
      authApi.ts, photosApi.ts, shareLinksApi.ts, accountApi.ts, shareApi.ts
                                  Thin per-resource wrappers over http.ts; (Phase 6) authApi's
                                  register() takes honeypot/formRenderedAt params, sent as
                                  `website`/`formRenderedAt` in the POST /api/register body
      adminApi.ts                  Thin wrappers over http.ts for every /api/admin/* endpoint
                                  (login/logout/me, users list/activate/disable, settings
                                  get/update, stats)
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
    countryLookup.ts               (Phase 6) loadCountryBoundaries() fetches/caches the bundled
                                  public/data/countries-110m.geo.json once; findCountryForPoint()
                                  is a hand-rolled ray-casting point-in-polygon test (Polygon/
                                  MultiPolygon with holes), bounding-box-pre-checked per country
                                  for performance — no new npm dependency, zero network calls
                                  beyond the one-time bundled-asset fetch
    countries.ts                   (Phase 6) computeCountryVisits() reuses computeMarkerGroups()
                                  so one country lookup runs per marker group, not per photo;
                                  dedups distinct {year, month} visits per country and returns a
                                  country-name-sorted CountryVisit[]; formatVisitDate() for
                                  display (e.g. "Jun 2019")
    timeline.ts                   Pure binning/domain/intensity/hit-testing logic for the
                                  timeline strip; plus (v1.0.0) computeYearBins/
                                  computeMonthBins/computeDayBins, yearsPresent, MONTH_LABELS,
                                  and an optional `label` field on TimelineBin, backing the
                                  calendar-axis drill-down layer
    adminUsers.ts                  Pure admin-console helpers: buildAdminUsersQuery,
                                  nextSortState, formatShareLinkStatus (existence+timestamp
                                  only, never a URL/token), formatUserStatusLabel, formatBytes
    exifWorkerPool.ts             Round-robin 2-4 Web Worker pool with progress tracking and
                                  cancellation
    stableId.ts                   FNV-1a hash of (relativePath, size, lastModified) — the
                                  per-file cache key
    dropFiles.ts                  Recursive folder drag-and-drop resolution
                                  (webkitGetAsEntry)
    objectUrlCache.ts / useObjectUrl.ts   LRU cache of blob object URLs with explicit
                                  revocation on delete
    format.ts                     Small display-formatting helpers; gained
                                  formatServerDateTime() (v1.0.0, used by the admin console)
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
                                  logged in; (Phase 6) the register form carries a hidden
                                  off-screen honeypot field (`website`, aria-hidden, tabIndex=-1)
                                  and captures `formRenderedAt` once per register-mode-entry
                                  (not reset on keystrokes), both passed through to
                                  authStore.register()
    AccountNotice.tsx              Persistent "you're logged in — photos are stored on the
                                  server" notice, visible for the whole authenticated session;
                                  mutually exclusive with PrivacyNote
    PrivacyNote.tsx                Persistent "Guest mode: your photos never leave this
                                  device." note; hidden while authenticated
    RegistrationNoticeModal.tsx     (v1.0.0) Shown when submitting the registration form, before
                                  the account is created: admin-approval gate, private-by-default
                                  sharing, email-as-notification-address, Guest Mode uploads
                                  nothing; only explicit acknowledgement calls register()
    UploadControl.tsx              Folder picker + drag-and-drop zone
    StatusPanel.tsx                Live processed/with-GPS/"Discarded (No GPS)" counts + progress
                                  bar; renders an optional gpsRequiredNotice alert (v1.0.0) when
                                  an account-mode upload was rejected for missing GPS
    FilterBar.tsx                  Date-range/camera make-model/has-location filter controls,
                                  writing to photoStore's searchFilters slice
    UnlocatedPhotosPanel.tsx       Panel of GPS-less photos, draggable onto the map to assign
                                  a location for the first time
    CountriesPanel.tsx              (Phase 6) Collapsible panel (same toggle convention as
                                  UnlocatedPhotosPanel) listing every country a photo was taken
                                  in with its distinct visit month/year(s), computed via
                                  lib/countries.ts's computeCountryVisits(); mounted in App.tsx's
                                  side region and in SharePage.tsx
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
                                  `photos`/controlled `dateFilter` props for the share view; gained
                                  (v1.0.0) a `density|year|month|day` calendar-axis navigation
                                  level with breadcrumbs and an HTML axis-label row under the
                                  canvas, drilling down at year/month and applying the existing
                                  date-filter behavior at day level (the original density mode is
                                  unchanged and remains the default view)
    PhotoThumbStrip.tsx            Chronological thumbnail strip (marker popups and
                                  timeline-filtered results); optional `photos`/`readOnly` props
    FullSizeViewer.tsx             Full-size photo view; datetime-only overlay banner; delete
                                  action; optional `photos`/`readOnly` props
    (each *.tsx has a matching *.css)
  components/admin/                 (v1.0.0) Admin-console-only components, never importing
                                  photoStore/authStore:
    AdminLoginForm.tsx               Username/password form for the separate adminStore session
    AdminUsersPanel.tsx              Search/status-filter/sort-by-email-or-registration-date/
                                  pagination; per-row activate-with-quota and disable-with-
                                  confirmation; share-link column renders existence+timestamp
                                  only via lib/adminUsers.ts's formatShareLinkStatus, never a URL
    AdminSettingsPanel.tsx           Default storage quota, global upload on/off toggle, and
                                  stats (counts by status, total photos, total bytes) from
                                  GET /api/admin/stats
  pages/
    SharePage.tsx                  Public read-only `/share/{token}` view: fetches
                                  GET /api/share/{token} into local component state (never the
                                  global store's photo data), reuses only UI-only global-store
                                  slots (selectedPhotoId, dateFilter); renders MapView/
                                  TimelineStrip/PhotoThumbStrip/FullSizeViewer with
                                  `photos`/`readOnly` set; no upload/delete/login affordances;
                                  filters and the map-style toggle remain available
    AdminPage.tsx                  (v1.0.0) `/admin` route: login gate (AdminLoginForm) then
                                  Users/Settings tabs (AdminUsersPanel/AdminSettingsPanel);
                                  fetches the global default quota once on mount so the Users
                                  tab's activate-quota prefill works regardless of tab order;
                                  entirely separate from photoStore/authStore, mirroring
                                  SharePage's separation pattern
  main.tsx, App.tsx, App.css, index.css, vite-env.d.ts
                                  (Phase 6) App.tsx/App.css restructured into a two-region
                                  flex layout: `.app__map-region` (the map, `flex: 3`) and
                                  `.app__side-region` (`flex: 0 0 300px`, normal document flow)
                                  holding StatusPanel/UnlocatedPhotosPanel/CountriesPanel —
                                  replacing the previous flat flow where StatusPanel was an
                                  absolutely-positioned overlay child sharing MapStyleToggle's
                                  corner (see docs/architecture.md's Phase 6 section)
test/
  fixtures/                      Real sample JPEGs (and one HEIC) with deliberate EXIF
                                  characteristics — see "Testing" below
  *.test.ts / *.test.tsx         Vitest unit/integration tests (see "Testing" below)
public/                          Static assets served as-is by Vite, including config.js
                                  (window.__PHOTOMAP_CONFIG__ runtime override for apiBaseUrl/
                                  map settings — a plain file, editable post-build with no
                                  rebuild), and (Phase 6) data/countries-110m.geo.json —
                                  bundled Natural Earth 1:110m country boundaries (trimmed to
                                  {name, geometry} per feature, ~250KB, 177 countries) backing
                                  the countries-visited feature; confirmed present in
                                  `npm run build`'s dist/ output
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
(single run) or `npm run test:watch`. As of this change (Phase 6): **28 test files, 193 tests, all
passing** (up from 24 files / 173 tests as of v1.0.0).

Fixtures (`test/fixtures/`) are real sample images with deliberately varied EXIF: GPS +
datetime; datetime-only/no GPS; GPS without an offset-time tag; a HEIC sample; a corrupted/
truncated JPEG; a non-image file renamed `.jpg`; a pair of JPEGs just inside/outside the ~50m
grouping radius (haversine-verified); a JPEG with GPS exactly `(0, 0)` for the Null Island rule.

Coverage, grouped by area (see the test files themselves under `test/` for exact names/cases —
this is a map of what's covered, not a file-by-file index):
- **Ingest pipeline**: EXIF parsing against real fixtures (GPS+datetime, datetime-only, Null
  Island, corrupted/non-image handling, missing offset-time tag, HEIC via mocked `exifr.parse()`
  output — see "Known characteristics" above), orientation-aware thumbnail/preview generation
  including the manual canvas-transform fallback, worker-pool distribution/progress/cancellation,
  per-file cache-key hashing, cache-hit/changed-file re-parse behavior, client/server id
  reconciliation.
- **Pure domain logic**: coordinate-grouping boundary cases (haversine-verified, high-latitude
  correctness), timeline binning/intensity/range-selection including the calendar-axis
  `computeYearBins`/`computeMonthBins`/`computeDayBins` layer, date-range/camera/has-location
  filter predicates, Detailed/Treasure Map preset config + `localStorage` persistence.
- **State/repositories**: IndexedDB repository behavior (quota-exceeded, no-tombstone re-add),
  `ApiPhotoRepository` against a mocked backend (quota-exceeded, no-op
  `estimateUsage()`/`requestPersistence()`), Zustand store transitions (`photoStore` including
  searchFilters/reconcileId/reassignLocation, `authStore` session/register/login/logout/
  delete-account and the repository swap it triggers, `adminStore` session transitions), the
  shared HTTP client's CSRF-once-per-session/`credentials:'include'`/typed `ApiError` (413/422)
  behavior.
- **Components/pages**: map view (tile-layer switching, draggable markers, drop-target
  reassignment, `readOnly` disabling both, and — Phase 6 — the `minZoom`/`maxBounds`/
  `maxBoundsViscosity`/`noWrap` world-repeat-prevention options passed to Leaflet), drag-to-
  reassign optimistic-update/rollback in both repository implementations, hand-rolled router
  matching (`/`, `/share/:token`, `/admin`, trailing-slash/encoded-token cases), `SharePage`
  (renders from local component state only — asserts the global store's `photos.size` stays 0
  throughout — plus `readOnly` behavior), thumbnail strip/full-size viewer/status panel/privacy
  note/`TopBanner` states, the registration-notice modal gate and "Discarded (No GPS)" label, the
  `gps_required`-triggered notice, the timeline's `density|year|month|day` drill-down navigation
  with breadcrumbs/axis labels, and (Phase 6) a dedicated layout test confirming `StatusPanel` is
  no longer inside the map's absolute-overlay DOM subtree and lives in the new side region
  instead.
- **Admin console** (v1.0.0): pure helper coverage (query building, sort-state cycling, share-link
  status formatting as existence+timestamp only never a URL, status labels, byte formatting),
  login gate + Users/Settings tab switching, search/filter/sort/pagination, and
  activate-with-quota/disable-with-confirmation flows.
- **Countries-visited** (Phase 6): `countryLookup.test.ts` resolves known landmark coordinates
  (Eiffel Tower, Tokyo, NYC, Sydney, Rome) against the real bundled GeoJSON asset, a mid-ocean
  null case, and coastal near-border cases (Nice/France vs. Italy, Vancouver/Canada vs. the US);
  `countries.test.ts` covers `computeCountryVisits()`'s grouping/dedup/multi-country-sort logic
  with synthetic fixtures; `countriesPanel.test.tsx` covers render/toggle behavior.
- **Registration anti-spam** (Phase 6, frontend side): `TopBanner`'s honeypot field is asserted
  genuinely inaccessible via keyboard/assistive-tech (never reachable via `getByRole('textbox')`,
  `tabIndex=-1`, `aria-hidden`), and `formRenderedAt` is asserted to be captured once per
  register-mode-entry (unaffected by subsequent keystrokes) and forwarded through
  `authStore.register()`/`authApi.register()` unchanged.

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
composer test               # phpunit — 180 tests, 481 assertions
bash scripts/smoke-test.sh http://localhost:8000   # runnable curl walkthrough (requires curl, jq)
bash scripts/package-for-deploy.sh          # assembles a release/ artifact for shared-hosting deploy
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
- PHP's built-in `mail()` for notification emails (v1.0.0), behind a `MailerInterface` so tests
  never send real mail
- Dev: `phpunit/phpunit` ^10

## Project layout

```
backend/
  public/index.php                 Front controller — the only web-root-reachable file;
                                    CorsMiddleware runs first, before Session::start()
  src/
    Config.php                     Reads/validates settings; checks for a root-level config.php
                                    first (shared-hosting deploy path — a plain PHP
                                    file returning an associative array, values populate
                                    $_ENV/putenv()), falling back to the pre-existing .env/
                                    phpdotenv behavior when no config.php exists; throws if
                                    config.php doesn't return an array; resetForTesting() (test-
                                    only) flips the internal loaded flag for multi-scenario tests
    Database.php                   PDO connection factory (ERRMODE_EXCEPTION, no emulated prepares)
    Session.php                    Native PHP session bootstrap; HttpOnly cookie, Secure gated
                                    by APP_ENV=production, SameSite configurable
                                    (SESSION_COOKIE_SAMESITE, default Lax); CSRF token seeding
    Bootstrap.php                  Wires dependencies and routes together, including
                                    PATCH /api/photos/{id} and (v1.0.0) every /api/admin/* route;
                                    resolveDefaultMailer() picks FakeMailer (MAIL_TRANSPORT=fake,
                                    used by tests) or PhpMailMailer otherwise
    Http/
      Request.php, Response.php, JsonResponse.php   JsonResponse's json_encode() call now passes
                                    JSON_PRESERVE_ZERO_FRACTION (v1.0.0 fix — a whole-number float
                                    like lat/lon 12.0 no longer silently round-trips as an int)
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
      AccountStatusMiddleware.php   (v1.0.0) Blocks a request based on the session user's live
                                    `status`; wired twice — broad (blocks `disabled`) on every
                                    authenticated route, narrow (blocks `disabled`+`pending`) on
                                    POST /api/photos only, so pending accounts can do everything
                                    except upload
      AdminAuthMiddleware.php       (v1.0.0) Checks a distinct $_SESSION['admin'] flag (never
                                    $_SESSION['user_id']); returns 503 admin_not_configured if
                                    ADMIN_USERNAME/ADMIN_PASSWORD_HASH are unset, 401 otherwise
    Controllers/
      AuthController.php           register (inserts status='pending', best-effort emails
                                    ADMIN_NOTIFY_EMAIL — v1.0.0; Phase 6: validation chain gains
                                    honeypot -> timing -> per-IP-rate-limit -> disposable-domain
                                    checks, each its own error code, before the pre-existing
                                    email-format/password-length/uniqueness checks), login,
                                    logout, csrfToken, me
      AccountController.php        DELETE /api/account (transactional row+file cascade delete)
      PhotosController.php         index, store (upload pipeline; v1.0.0: rejects with
                                    422 gps_required if the photo has no usable GPS, for
                                    account-mode uploads only), update (PATCH — lat/lon only,
                                    404-not-403 ownership), destroy
      MediaController.php          Signed-URL image/thumbnail byte streaming
      ShareLinksController.php     store (rotate: revoke-old-then-create-new), destroy (revoke)
      ShareController.php          Public show(token) — read-only, respects revoked_at
      GeocodeController.php        Cache-first Nominatim proxy
      AdminAuthController.php      (v1.0.0) login (password_verify(), rate-limited, timing-safe
                                    dummy-hash comparison on username mismatch), logout, me
      AdminUsersController.php     (v1.0.0) index (search/filter/sort/paginate; share-link column
                                    is existence+timestamp only, never the token), activate
                                    (optional per-user quota override, sends activation email),
                                    disable (sends disable email)
      AdminSettingsController.php  (v1.0.0) show/update — default_storage_quota_bytes,
                                    uploads_enabled
      AdminStatsController.php     (v1.0.0) show — counts by status, total photos, total bytes
    Repositories/
      UserRepository.php, PhotoRepository.php (now includes updateLocation()),
      ShareLinkRepository.php, GeocodeCacheRepository.php, LoginAttemptRepository.php
      (all parameterized PDO); UserRepository gained (v1.0.0) status/quota/search/sort/filter/
      count methods and countByStatus(); ShareLinkRepository gained (v1.0.0)
      findActiveCreatedAtForUser() — selects only `created_at`, never `token`, so the raw
      share URL is structurally unreachable from the admin code path
      AppSettingsRepository.php    (v1.0.0) Reads/writes the singleton app_settings row
      RegistrationAttemptRepository.php  (Phase 6) countRecentByIp()/record() against
                                    registration_attempts — mirrors LoginAttemptRepository's
                                    shape but records every POST regardless of outcome (no
                                    "succeeded" concept to filter on)
    Services/
      ImageProcessor.php           GD: EXIF-orient, resize <=2000px q85, thumbnail 320px q80,
                                    no-upscale, alpha-flatten-to-JPEG, corrupt-image rejection
      FileValidator.php            finfo real-content-type + size checks (never trusts extension
                                    or client-supplied MIME type)
      StorageQuotaService.php      Row-locked reserveAndInsert() — quota check + photo insert in
                                    one transaction, race-safe under concurrent uploads; resolves
                                    a per-user quota (v1.0.0: the user's own storage_quota_bytes
                                    if set, else app_settings.default_storage_quota_bytes) instead
                                    of a flat constant; retries up to 3 times with backoff on a
                                    genuine MySQL deadlock (SQLSTATE 40001)
      RateLimiter.php              Failed-login throttling, per-account + per-IP; reused as-is
                                    for admin login
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
      AppSettingsService.php       (v1.0.0) Thin service wrapping AppSettingsRepository
      MailerInterface.php          (v1.0.0) send(to, subject, body): void
      PhpMailMailer.php            (v1.0.0) Production implementation, PHP's mail(); every call
                                    site wraps sends in catch-and-log, never blocking the
                                    triggering action
      DisposableEmailDomainList.php  (Phase 6) Static, hardcoded list of ~50 well-known
                                    disposable-email domains; isDisposable() matches
                                    case-insensitively, including subdomains; not
                                    admin-configurable in this release
  storage/                          OUTSIDE public/, never web-reachable
    photos/{user_id}/{random32hex}.jpg
    thumbnails/{user_id}/{random32hex}.jpg
  migrations/
    0001_create_users.sql, 0002_create_photos.sql, 0003_create_share_links.sql,
    0004_create_geocode_cache.sql, 0005_create_login_attempts.sql,
    0006_create_nominatim_rate_limit.sql, 0007_add_user_status_and_quota.sql (adds
    users.status/storage_quota_bytes/approved_at, grandfathers pre-existing rows to 'active'),
    0008_create_app_settings.sql (singleton app_settings row, seeded with a 100MB default),
    0009_add_registration_attempts.sql (Phase 6 — registration_attempts table, indexed on
    (ip_address, created_at))
  scripts/
    migrate.php                    CLI runner; idempotent, tracks applied filenames in a
                                    schema_migrations table it creates automatically
    smoke-test.sh                  Runnable copy of the README's curl walkthrough, including
                                    a PATCH /api/photos/{id} step
    package-for-deploy.sh           Shared-hosting packaging helper: runs `npm run build` +
                                    `composer install --no-dev --optimize-autoloader`, then
                                    assembles release/photomap-backend/ (curated: public/, src/,
                                    migrations/, scripts/, fresh vendor/, composer.json/.lock,
                                    .htaccess, config.php/.example, storage dirs — excludes
                                    tests/, docker/, .env*, docker-compose.yml, phpunit.xml) and
                                    release/domain.com/ (frontend dist/ + the shared-hosting
                                    .htaccess/api/index.php stub from deploy/shared-hosting/);
                                    includes a hardcoded-path/URL grep sweep as a warning
    deploy.sh                       (Phase 6) Runs package-for-deploy.sh, then either automates
                                    upload+migrate over SSH (rsync, falling back to scp) when a
                                    fully-configured, key-auth-only deploy.config.json is present
                                    at the repo root (auto-chmod 600'd), or prints a concrete
                                    numbered manual fallback checklist; password-based automation
                                    is deliberately never attempted — reachable as `npm run deploy`
  config.php.example                Template array of every setting .env.example documents, with
                                    shared-hosting-specific inline guidance (DB host convention,
                                    HTTPS/APP_ENV ordering pitfall, same-origin CORS/cookie
                                    defaults) and (Phase 6) RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS/
                                    RATE_LIMIT_REGISTRATION_WINDOW_SECONDS/
                                    REGISTRATION_MIN_FORM_SECONDS; copy to config.php and fill in
                                    real values
  .htaccess                         Deny-all (Require all denied, Apache 2.2 fallback) shipped
                                    inside backend/ itself — defense-in-depth against
                                    mod_userdir-style exposure of the private backend directory
                                    on shared hosting
  tests/
    bootstrap.php, FakeGeocodeClient.php
    fixtures/                      Real sample images: corrupted, non-image-as-.jpg, small/large/
                                    tiny JPEGs, a WebP, a PNG with alpha
    Unit/                          CsrfMiddleware, FileValidator, GeocodeController, ImageProcessor,
                                    NominatimClient, NominatimRateLimiter, RateLimiter, SignedUrl,
                                    StorageQuotaService, Config (config.php/.env precedence),
                                    AdminAuthController (v1.0.0), MailNotifications (v1.0.0),
                                    UserRepository (v1.0.0), DisposableEmailDomainList (Phase 6 —
                                    case-insensitivity, subdomain matching, non-disposable
                                    domains) — see "Testing" below
    Feature/                       Auth, Cors, Csrf, Geocode, Ownership, Photos, PhotoUpdate,
                                    ProductionCookie, Quota, RateLimit, SecurityFeature,
                                    ShareLinks, AdminAuth (v1.0.0), AdminUsers (v1.0.0 — includes
                                    a dedicated test asserting the share-link indicator is
                                    existence-only, never the raw token), GpsRequired (v1.0.0),
                                    RegistrationApproval (v1.0.0), RegistrationHardening
                                    (Phase 6 — honeypot/timing/per-IP-rate-limit/disposable-domain
                                    checks plus a control-case success, run with its own tightened
                                    envOverrides()) — each boots a real `php -S` subprocess and
                                    drives it over real HTTP
    Support/                       ServerProcess (subprocess lifecycle; its .env.test quote-
                                    stripping parser was fixed in v1.0.0 to handle single-quoted
                                    values, not just double-quoted), HttpClient/HttpResponse
                                    (curl wrapper, now with patchJson()/options()),
                                    DatabaseTestCase/FeatureTestCase (base classes),
                                    FakeHttpServer, concurrent_upload_worker.php (real multi-process
                                    concurrency test for the quota row-lock),
                                    nominatim_lookup_worker.php, FakeMailer/FailingFakeMailer
                                    (v1.0.0 — MAIL_TRANSPORT=fake test doubles for MailerInterface)
  composer.json, composer.lock
  .env.example, .env.test, .gitignore   .env.example documents CORS_ALLOWED_ORIGINS,
                                    SESSION_COOKIE_SAMESITE, (v1.0.0) ADMIN_USERNAME/
                                    ADMIN_PASSWORD_HASH/ADMIN_NOTIFY_EMAIL/MAIL_* settings (with
                                    inline admin-hash-generation instructions), and (Phase 6)
                                    RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS/
                                    RATE_LIMIT_REGISTRATION_WINDOW_SECONDS/
                                    REGISTRATION_MIN_FORM_SECONDS. .env.test deliberately loosens
                                    the registration rate-limit/timing defaults (effectively
                                    unlimited attempts, timing check disabled) since dozens of
                                    unrelated test classes register accounts as ordinary setup —
                                    RegistrationHardeningFeatureTest overrides these back to tight
                                    values via its own envOverrides()
  README.md                        Standalone run instructions, API table (including PATCH and
                                    the /api/admin/* routes), CORS/cross-origin-cookie section,
                                    curl walkthrough, and an "Admin console" section with a
                                    copy-pasteable password_hash() one-liner
  docker/ (Dockerfile, init.sql), docker-compose.yml   Backend-only dev/test convenience,
                                    distinct from the root docker-compose.yml
```

## Data model (MySQL)

- `users` — id, `email` (unique), `password_hash`, `status` (v1.0.0: `ENUM('pending','active',
  'disabled')`, default `pending`; indexed), `storage_quota_bytes` (v1.0.0: nullable — `NULL`
  means "use `app_settings.default_storage_quota_bytes`"), `approved_at` (v1.0.0, nullable),
  `created_at` (indexed, v1.0.0 — backs the admin user list's sort-by-registration-date).
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
- `app_settings` (v1.0.0) — a singleton row (`id` fixed to `1` via a `CHECK` constraint):
  `default_storage_quota_bytes`, `uploads_enabled`, `updated_at`. Seeded by migration 0008 with a
  100MB default and uploads enabled.
- `registration_attempts` (Phase 6) — id, `ip_address`, `created_at`; indexed on
  `(ip_address, created_at)`. A dedicated table, not a reuse of `login_attempts` — every
  registration POST is recorded regardless of outcome (no "succeeded" concept to filter on).

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
- (v1.0.0) A `pending` account can log in and use every feature except uploading; only a
  `disabled` account is blocked from everything. Migration 0007's grandfathering `UPDATE` runs
  exactly once, at migration time — it cannot affect a genuinely new registration made after the
  migration has already run, since new registrations always insert `status='pending'` explicitly.
- (v1.0.0) Leaving `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` unset does not break anything else: every
  `/api/admin/*` route returns `503 admin_not_configured`, and every other route is unaffected.
- (v1.0.0) All admin/registration/activation/disable emails are sent best-effort — a mail failure
  (including via `FailingFakeMailer` in tests) is caught and logged, never surfaced to or blocking
  the triggering user/admin action.
- (v1.0.0) `StorageQuotaService::reserveAndInsert()` retries up to 3 times with backoff on a
  genuine MySQL deadlock (SQLSTATE `40001`), verified with repeated runs of a dedicated
  multi-process concurrency test; this is a robustness fix made during this change's own test
  audit, not a change in the quota's semantics.
- (Phase 6) No third-party CAPTCHA is implemented for registration — a deliberate decision (see
  `docs/architecture.md`'s Phase 6 section), revisitable if spam signups persist in practice.
  `DisposableEmailDomainList` is a hardcoded, static list, not wired into the admin
  settings UI/API in this release.

## Testing

PHPUnit 10. Run via `composer test` from `backend/`. As of this change (Phase 6): **180 tests, 481
assertions, 0 failures** (81 Unit + 99 Feature), confirmed deterministic across independent clean
runs via Docker (MySQL + php:8.3) — up from 173 tests / 456 assertions as of v1.0.0.

- **Unit tests** (`tests/Unit/`): CSRF token comparison logic; image resize/EXIF-orientation/
  no-upscale/corrupt-image-rejection behavior; finfo-based file-type sniffing; quota math
  including a genuine **multi-process** concurrency test (`tests/Support/
  concurrent_upload_worker.php`) proving the row-lock correctly serializes concurrent uploads
  against the quota; rate-limiter threshold logic; `NominatimRateLimiter` spacing; `SignedUrl`
  sign/verify/expiry/tamper-detection; `NominatimClient`'s wire behavior against a local fake
  socket server (`FakeHttpServer`); geocode rounding/caching via `FakeGeocodeClient` (real
  Nominatim is never called in any automated test); **`ConfigTest.php`** (new) — 7 tests covering
  `config.php`-only, `.env`-only (regression), both-present precedence (`config.php` wins),
  neither-present (defaults/`require()` throws), a malformed (non-array-returning) `config.php`,
  a `config.php` with a genuine PHP parse error, and an end-to-end `Database::connect()` check
  picking up `config.php`-sourced real test-DB credentials; **(v1.0.0) `AdminAuthControllerTest`**
  (password_verify() success/failure, timing-safe dummy-hash comparison on username mismatch),
  **`MailNotificationsTest`** (registration/activation/disable emails sent via the fake mailer,
  including a failing-mailer case proving the triggering action still succeeds),
  **`UserRepositoryTest`** (status/quota/search/sort/filter/count queries), and
  **(Phase 6) `DisposableEmailDomainListTest`** (case-insensitivity, subdomain matching,
  non-disposable domains passing through, malformed-email handling).
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
  URLs from it," session cookie security attributes (`ProductionCookieFeatureTest`), confirming
  `storage/` itself is not web-reachable, and (new) `SecurityFeatureTest::
  testNoStrayConfigPhpShadowsEnvTestFixtures()` — asserts no stray `config.php` sits in the
  backend root during the Feature suite (which would silently shadow `.env.test` for every test
  in the suite) and that `.env.test`'s dedicated test-only session cookie name is genuinely the
  one in use; **(v1.0.0) `AdminAuthFeatureTest`** (login/logout/me over real HTTP, rate limiting,
  `admin_not_configured` when unset), **`AdminUsersFeatureTest`** (search/filter/sort/pagination,
  activate/disable end-to-end including the resulting emails, and a dedicated test asserting the
  share-link indicator is existence-only and never returns the raw token), **`GpsRequiredFeatureTest`**
  (account-mode upload with no GPS rejected with `422 gps_required`), and
  **`RegistrationApprovalFeatureTest`** (a newly-registered account can log in but not upload
  until activated; a disabled account is blocked entirely; the migration-time grandfathering
  behavior), and **(Phase 6) `RegistrationHardeningFeatureTest`** (honeypot rejection, sub-
  threshold-timing rejection including a missing-`formRenderedAt` case, per-IP throttle tripping
  after N attempts then resetting after the window expires, every attempt recorded regardless of
  outcome, disposable-domain rejection, and a control-case legitimate registration still
  succeeding — run with its own tightened `envOverrides()` since the shared `.env.test` defaults
  are deliberately loosened for the rest of the suite).
- Not covered by the automated Feature tier: cache-hit/miss/rounding/rate-limiting-spacing
  behavior of `GET /api/geocode` against a live server, since the live server always wires the
  real `NominatimClient` and the plan requires never calling real Nominatim in tests — that
  behavior is instead covered at the Unit tier via `GeocodeController` + `FakeGeocodeClient`
  directly (a tier-placement choice, not a coverage gap); the Feature tier only checks the
  unauthenticated-401 path for that endpoint. Live two-real-origin cookie/CORS behavior (a
  genuine split-origin browser round-trip) is a documented manual/staging concern, not covered by
  the automated suite, which checks header/config-level correctness only.
- Also verified: `php scripts/migrate.php` is idempotent and works against a genuinely fresh
  database (re-verified against MariaDB in addition to MySQL); `bash scripts/smoke-test.sh`
  passes all steps (including the PATCH step) against a real `php -S` dev server; `php -l` clean
  on every `src/`, `tests/`, `scripts/`, `public/` file, including all new/modified files for this
  change.
- **(v1.0.0) Test-infrastructure fixes made during this change's own audit** (not feature-logic
  bugs — see `docs/architecture.md`'s Phase 5 section for the full root-cause writeup): fixed
  `tests/Support/ServerProcess.php`'s `.env.test` quote-stripping to handle single-quoted values
  (previously broke `password_verify()` for every admin Feature test); added a deadlock-retry loop
  to `StorageQuotaService::reserveAndInsert()`; fixed an `AdminUsersFeatureTest` case that reused
  one HTTP client/cookie jar across two logged-in users, invalidating a CSRF token; and added
  `JSON_PRESERVE_ZERO_FRACTION` to `JsonResponse.php` globally (a pre-existing, unrelated latent
  bug newly exposed by round-number-coordinate test fixtures).
- **Shared-hosting deploy verification** (on-demand tooling, not wired into default CI):
  `deploy/shared-hosting/verify-apache-routing.sh` runs a Docker-based `php:8.3-apache` container
  (`mod_rewrite` enabled, `AllowOverride All`) against a packaged `release/` artifact and checks
  SPA-root rendering, `/share/:token` SPA fallback, `/api/*` routing to PHP, direct static-asset
  serving, and directory-traversal blocking. A separate manual check pointed a plain Apache
  container's docroot directly at `release/photomap-backend/` and confirmed
  `GET /config.php.example` returns 403 via the shipped deny-all `.htaccess` (the `mod_userdir`
  exposure mitigation). `backend/scripts/package-for-deploy.sh` was also run end-to-end and its
  output's curated scope and `vendor/autoload.php` loadability verified. A full
  `docker compose down -v && docker compose up --build` regression (root whole-stack Docker path)
  confirmed no impact from the `config.php`-first check on `Config::load()`.

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

Neither Docker path is the "required" way to run the project — the documented paths are native
dev (three processes: MySQL, `php -S`, Vite), the whole-stack Docker path above, and two flavors
of genuine production deployment: a split-origin plain PHP+MySQL host (`CORS_ALLOWED_ORIGINS`/
`SESSION_COOKIE_SAMESITE` configured for that case) and, new in this change, a same-origin
shared-hosting deploy. See the root `README.md` for the full breakdown and the complete
environment-variable reference tables for both the frontend and the backend.

## Shared-hosting deployment tooling (`deploy/shared-hosting/`, `backend/scripts/package-for-deploy.sh`, `backend/scripts/deploy.sh`)

A generic single-directory Apache/PHP/MySQL shared-hosting deployment path, with no dependency on
or naming of any particular hosting provider (the `deploy/dreamhost/` directory name from the
phase that introduced this mechanism was itself renamed to `deploy/shared-hosting/` in Phase 6 —
see `docs/architecture.md`'s "Phase 4" section for the full design (two-tier sibling-directory
layout, `config.php`/`.env` precedence, `mod_userdir` mitigation) and its "Phase 6" section for
the deploy-automation addition.

```
deploy/shared-hosting/
  .htaccess                 Domain-docroot .htaccess: rewrites /api/* to api/index.php, falls
                             back to index.html for the SPA (client-side routing incl.
                             /share/:token), with a commented-out opt-in HTTPS redirect
  api/index.php             One-line stub: require __DIR__ . '/../../photomap-backend/public/index.php'
  verify-apache-routing.sh  On-demand, Docker-based (php:8.3-apache, mod_rewrite, AllowOverride
                             All) routing/security check against a packaged release/ artifact;
                             not wired into default CI

backend/
  config.php.example        Template settings array (same keys as .env.example), with
                             shared-hosting-specific inline guidance
  .htaccess                  Deny-all, ships inside backend/ itself as defense-in-depth against
                             mod_userdir-style exposure
  scripts/package-for-deploy.sh   Builds the frontend + a production vendor/, assembles a
                             curated release/photomap-backend/ + release/domain.com/ tree ready
                             to upload over SFTP
  scripts/deploy.sh          (Phase 6) Runs package-for-deploy.sh, then automates upload+migrate
                             over SSH (rsync, falling back to scp) when a fully-configured,
                             key-auth-only deploy.config.json is present at the repo root
                             (auto-chmod 600'd on discovery), else prints a concrete numbered
                             manual fallback checklist; reachable as `npm run deploy`

deploy.config.example.json   (Phase 6, repo root, committed) Template for deploy.config.json:
                             sshHost/sshPort/sshUser/sshKeyPath/remoteBackendPath/
                             remoteFrontendPath/remoteMigrateCommand/postDeployCommands
deploy.config.json           (Phase 6, repo root, gitignored) Real values — never committed;
                             password-based auth is deliberately never supported by the
                             automated path
```

`release/` (the packaging script's output directory) is gitignored at the repo root and is a
transient build artifact, never committed. `backend/config.php` (the user's real, filled-in
settings) is gitignored in `backend/.gitignore`, alongside the pre-existing `.env`/`.env.test`
ignores. `deploy.config.json` (Phase 6) is gitignored at the repo root alongside `deploy.config.
example.json`'s committed template.
