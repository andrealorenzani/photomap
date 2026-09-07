# Photomap — Architecture

## Current state

Photomap now consists of two projects that are wired together at runtime, deployed and run
independently:

- A frontend project (TypeScript + Vite + React) at the repo root, implementing both guest mode
  (Phase 1) and account mode (wired in Phase 3), a hand-rolled three-route router (`/`,
  `/share/:token`, and — new in Phase 5/v1.0.0 — `/admin`), a treasure-map basemap style,
  filter/search, drag-to-reassign, a calendar-axis drill-down layer on the timeline, a fully
  separate admin console page/store, and — new in Phase 6 — a map-dominant two-region layout, an
  offline client-side countries-visited panel, and world-repeat prevention on the map.
- A standalone backend project (PHP 8.x + MySQL) at `backend/`, implementing the accounts API
  (Phase 2), a `PATCH /api/photos/{id}` endpoint and optional CORS support (Phase 3), a
  generic shared-hosting deployment path (Phase 4), registration approval status,
  admin-configurable storage quotas, a separate `/api/admin/*` API, GPS-required account-mode
  uploads, and email notifications (Phase 5/v1.0.0), and — new in Phase 6 — registration
  anti-spam hardening (honeypot, timing check, per-IP rate limit, disposable-domain blocklist).

They remain two independently deployable projects with no shared code — the frontend talks to
the backend only over its JSON HTTP API (`fetch`, `credentials: 'include'`), never anything
tighter. In both the native dev setup and the Docker whole-stack setup, a reverse proxy (Vite's
dev proxy, or nginx in Docker) puts them on the same browser-visible origin, so no CORS
configuration is needed for either — CORS/`SameSite` configurability exists specifically for a
production topology where the frontend static host and backend host are genuinely different
origins.

## Phase 1 — guest mode frontend

The frontend implements guest mode entirely client-side. There is no backend call and no network
traffic involving photo data in guest mode; the only network traffic it generates is
OpenStreetMap basemap tile requests (inherent to the mandated Leaflet + OSM stack) and ordinary
dev tooling traffic (npm, Vite HMR).

### High-level shape (guest mode)

```
Browser
├── React UI (TopBanner, UploadControl, StatusPanel, MapView, TimelineStrip,
│             PhotoThumbStrip, FullSizeViewer, PrivacyNote, FilterBar,
│             UnlocatedPhotosPanel, MapStyleToggle)
├── Zustand store (photoStore) — photos, ingest status, timeline filter, search filters,
│   selection; auth store (authStore) — session status, current user
├── Ingest pipeline (lib/ingest) — folder-picker/drop input -> per-file cache check
│   -> dispatch to worker pool -> write results to store + repository (+ client/server id
│   reconciliation, see Phase 3 below)
├── Worker pool (lib/exifWorkerPool) — 2-4 Web Workers running exifWorker.ts
│   (exifr EXIF/GPS/datetime parsing + createImageBitmap/OffscreenCanvas thumbnail +
│   preview generation, with EXIF-orientation correction applied), off the main thread
├── PhotoRepository interface (lib/db) — a swappable active implementation
│   (IndexedDbPhotoRepository or ApiPhotoRepository, see Phase 3 below)
└── Leaflet + Leaflet.markercluster (map rendering) <-- OpenStreetMap tile server (network)
```

### Module boundaries and the seam later phases used

- `PhotoRecord` (in `src/types.ts`) is the shared domain model. Its fields were deliberately
  named to closely mirror the concepts in the backend's `photos` database table (`lat`, `lon`,
  `takenAt`, `cameraMake`, `cameraModel`, camelCase vs. the DB's snake_case), which made mapping
  to the backend's JSON API in Phase 3 close to 1:1 in practice.
- `PhotoRepository` (in `src/lib/db/`) is an interface, not just a concrete class.
  `IndexedDbPhotoRepository` (guest mode) and `ApiPhotoRepository` (account mode, added in
  Phase 3) both implement it, and the rest of the app (store, components) never needs to know
  which one is active — see "Phase 3" below for how the swap works at runtime.
- The ingest pipeline, worker pool, and grouping/timeline math are pure client-side concerns with
  no awareness of accounts or a backend; they operate purely on `PhotoRecord`s regardless of
  where those records ultimately come from or get persisted to.
- No shared code exists between the frontend and the backend project — they are two independent
  projects (different language/runtime) that communicate only over the backend's JSON HTTP API.

### Key architectural decisions (Phase 1, still true)

- **Two data layers, not one**: `groupKey` (~50m latitude-corrected grid bucketing, in
  `lib/grouping.ts`) folds photos taken at the same spot into one logical marker; Leaflet's
  `markercluster` plugin then visually clusters those location-markers as the map zooms. These
  are distinct concerns and are not conflated in the implementation.
- **Never cache original file bytes**: only a ~200px thumbnail and a ~1600-1800px/quality-80
  preview are generated (in the worker) and persisted per photo. This keeps storage usage
  bounded for large personal libraries; the full-size viewer is therefore not pixel-perfect
  against the original file — an accepted, documented tradeoff.
- **Per-file cache identity, not per-folder**: browsers give no stable folder identity from
  `<input webkitdirectory>` or drag-and-drop, so "have I seen this file before" is answered by a
  deterministic id (`hash(relativePath, size, lastModified)`, `lib/stableId.ts`) checked against
  IndexedDB before dispatching to the worker pool. This degrades gracefully to per-file
  granularity for partial folder changes, at the accepted cost that deleting a photo and later
  reopening the same folder will re-add it (no tombstone/exclusion list exists) — a guest-mode-
  only concept; account mode has no folder-reselection flow.
- **Web Worker owns the whole per-photo pipeline**, not just EXIF parsing: metadata extraction
  *and* thumbnail/preview image generation both happen in `exifWorker.ts`, off the main thread,
  which is what actually keeps the UI responsive on large folders. A small worker pool (2-4
  workers) bounds concurrency and batches progress updates rather than firing every file at once.
- **Zustand over React Context** for global state: photo counts can run into the hundreds or
  thousands with frequent progress updates, and selector-based subscriptions avoid re-rendering
  the map/timeline on every tick.
- **EXIF-orientation correction is applied when generating thumbnails/previews** (added in
  Phase 3, `exifWorker.ts`): `createImageBitmap(file, { imageOrientation: 'from-image' })`, with
  a manual canvas-transform fallback for orientations 2-8 on browsers that don't support the
  option. Previously this was a documented gap (orientation captured in EXIF but never applied to
  the rendered thumbnail/preview); it was fixed once account-mode uploads began persisting this
  same pre-resized, EXIF-stripped preview permanently server-side, which would otherwise have
  escalated it from a session-scoped rendering artifact into a permanent data-quality bug. Fixed
  for both modes at once, since both go through the same worker.
- **Reverse geocoding is omitted from the frontend UI in both modes**, though the backend
  capability now exists (`GET /api/geocode`, Phase 2): browser `fetch()` cannot set a custom
  `User-Agent` header (a forbidden header per the Fetch spec), which is exactly what a public
  geocoder's usage policy requires — so no in-browser call could ever honor that policy. The
  server-side proxy exists and is tested, but wiring it into the full-size photo view was not
  taken on in Phase 3 and remains a future enhancement.
- **Privacy guarantee is scoped to photo data**: "your photos never leave this device" (guest
  mode) covers photo bytes, EXIF metadata, filenames, and GPS coordinates. It explicitly does not
  (and structurally cannot) cover OpenStreetMap basemap tile requests, an inherent, disclosed
  consequence of using an online slippy map, and carries only generic tile x/y/z indices, never
  photo data.

## Phase 2 — accounts backend

A separate PHP 8.1+ project at `backend/`, with its own dependencies (Composer), its own tests
(PHPUnit), and its own README — independent of the frontend project at the repo root, reachable
only via its JSON HTTP API. Phase 3 added one new endpoint (`PATCH /api/photos/{id}`) and
optional CORS middleware; everything else here is unchanged from Phase 2.

### High-level shape

```
Client (curl/Postman/tests; the Photomap frontend, same-origin via a reverse proxy in both the
        native dev setup and the Docker whole-stack setup; a split-origin static host in a
        production deployment that opts into CORS)
  │  JSON over HTTP, session cookie + X-CSRF-Token header
  ▼
public/index.php (front controller, only web-root-reachable file)
  └── CorsMiddleware (opt-in, exact-match origin allow-list; no-op unless CORS_ALLOWED_ORIGINS set)
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

### Key architectural decisions (Phase 2, still true)

- **Hand-rolled router, not a framework**: consistent with the project's minimal-dependency
  posture; a small regex method+path matcher is sufficient for this endpoint count. Phase 3's
  frontend router (see below) follows the same reasoning.
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
  only once their TTL expires. `PATCH /api/photos/{id}` (Phase 3) only ever touches the `photos`
  row's `lat`/`lon` columns — it never reads or writes storage paths, so this property is
  unaffected by drag-to-reassign.
- **CSRF required on every state-changing endpoint, including register and login**: no bootstrap
  exemption — a public `GET /api/csrf-token` endpoint seeds/returns the session's CSRF token
  before any state-changing call, including the very first one. `PATCH /api/photos/{id}` follows
  the same convention as every other mutating endpoint.
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
- **Ownership is never trusted from the client**: every `/api/photos/*` (including the new
  `PATCH`), `/api/share-links/*`, and `/api/account` operation resolves the target resource's
  owner from the authenticated session server-side; mismatched-ownership operations return `404`
  (not `403`) to avoid confirming another user's resource id exists. `PATCH` is allowed for any
  owned photo, not restricted to currently-GPS-less ones, matching the sibling endpoints'
  unrestricted-within-ownership design.
- **CORS is opt-in and exact-match only** (added Phase 3): `CorsMiddleware` reads a
  comma-separated allow-list from `CORS_ALLOWED_ORIGINS` (default empty — no CORS headers emitted
  at all), handles `OPTIONS` preflight before auth/CSRF middleware run, and echoes back the exact
  matching request origin with `Access-Control-Allow-Credentials: true` and `Vary: Origin` —
  never a wildcard `*`, never substring/suffix matching. A near-miss/non-matching origin gets no
  CORS header at all (dedicated test coverage). `Session.php`'s cookie `SameSite` attribute
  became configurable (`SESSION_COOKIE_SAMESITE`, default `Lax`, unchanged for same-origin
  deployments) alongside this, since a genuinely split-origin deployment typically needs
  `SameSite=None` (which in turn requires `Secure`, i.e. `APP_ENV=production`/HTTPS) for the
  session cookie to be sent at all. Neither the native dev Vite proxy nor the Docker nginx proxy
  ever need either setting, since both put the frontend and backend on the same browser-visible
  origin.
- **Docker is one of two supported local paths, not the primary "required" path**: `backend/
  docker-compose.yml` remains a narrower backend-only dev/test convenience (unchanged since
  Phase 2). The root `docker-compose.yml` (added Phase 3) is a distinct, whole-stack local
  convenience (MySQL + backend + frontend behind nginx, one command, one URL) — see "Phase 3"
  below. Both are explicitly labeled as local-use conveniences, not production deployment
  tooling; the documented production paths are a plain PHP host for the backend and any static
  host for the frontend's `dist/` build.

### Known, documented limitations (Phase 2, still true)

- **Account deletion (`DELETE /api/account`) ends only the current session.** It does not
  proactively invalidate any other active session for the same account elsewhere; such a session
  would only start failing on its next DB-touching request, since the underlying user row is
  gone. No cross-session store exists in this design to do otherwise within this phase's scope.
- **The session cookie's `Secure` flag is gated by `APP_ENV=production`.** Plain-HTTP `php -S`
  (used for local dev and the test suite) cannot meaningfully use `Secure` cookies at all, so
  `APP_ENV=local` is a documented dev-only exception; the `Secure`/`HttpOnly`/`SameSite`
  attributes themselves are always set correctly in the response header regardless.
- **Orphan-file cleanup** (e.g., files left behind by a crash mid-upload) and **trusting a
  reverse proxy's `X-Forwarded-For` header** for the login rate limiter's IP address are both out
  of scope — the deliverable is explicitly local-dev/direct-connection or same-origin
  reverse-proxy, not a hardened multi-hop production topology.
- **`nominatim_rate_limit.last_request_at` is a `DOUBLE` (microtime), not a MySQL `DATETIME`** —
  a deliberate deviation, needed because `DATETIME`'s whole-second resolution made sub-second
  spacing impossible to correctly enforce and test; production behavior at the default 1-second
  interval is unaffected.

## Phase 3 — account wiring, deployment/operability, and treasure-map style

The frontend and backend are now wired together, and the frontend gained a static-deployable
production build story, a whole-stack Docker path, and an opt-in alternate basemap style.

### Frontend: auth state and swappable `PhotoRepository`

`src/state/authStore.ts` holds `{ status: 'idle'|'checking'|'authenticated'|'guest', user:
{email}|null }`, hydrated on app load via `GET /api/me` (`restoreSession()`). `src/lib/db/
photoRepository.ts`/`index.ts` expose `getActiveRepository()`/`setActiveRepository()` around a
module-level `let active: PhotoRepository`; the previously-fixed `photoRepository` export is now
a thin proxy delegating to `getActiveRepository()` at call time, so `photoStore.ts` and
`App.tsx` needed no call-site changes. Only `authStore.ts` calls `setActiveRepository()` — to
`IndexedDbPhotoRepository` on guest/logout, to a new `src/lib/db/apiPhotoRepository.ts`
(`ApiPhotoRepository`, implementing the same interface against `GET/POST/DELETE/PATCH
/api/photos`) on login/register/session-restore-as-authenticated.

`PhotoRepository.add()`'s signature changed from `Promise<void>` to `Promise<PhotoRecord>`,
returning the persisted record with its final id — this closes a gap the plan's original draft
missed (client-generated stable-hash ids vs. the backend's `AUTO_INCREMENT` ids). `src/lib/
ingest/index.ts` awaits this after its existing optimistic `upsertPhoto()` call and, if the
returned id differs from the one it optimistically used, calls a new `reconcileId(oldId,
newRecord)` store action that removes the old Map entry and inserts the new one under the
server-assigned id (a no-op in guest mode, where the id never changes). `ApiPhotoRepository`'s
`estimateUsage()`/`requestPersistence()` are no-ops (IndexedDB-specific concepts meaningless for
server storage); server quota pressure is instead surfaced reactively via a distinct `413
quota_exceeded` error from the API client.

`src/lib/api/http.ts` is the shared client: fetches `GET /api/csrf-token` once per session and
attaches `X-CSRF-Token` on every mutating call, uses `credentials: 'include'` throughout, and
surfaces `413 quota_exceeded`/`422` errors as a typed `ApiError` distinct from a generic network
failure (mirroring the existing `StorageQuotaExceededError` pattern from guest mode). Thin
per-resource modules (`authApi`, `photosApi`, `shareLinksApi`, `accountApi`, `shareApi`) sit on
top of it.

### Frontend: hand-rolled router and the public share view

`src/Router.tsx` is a small hand-rolled path matcher for exactly two routes (`/` → `App`,
`/share/:token` → `SharePage`) — not `react-router-dom`. This was a genuine disagreement between
the architect briefing (hand-rolled) and the developer briefing (proposed `react-router-dom`),
resolved in favor of hand-rolled: directly grounded in the already-documented decision that the
backend's own hand-rolled router is "consistent with the project's minimal-dependency posture,"
and only two routes with very different rendering needs are needed here. `/share/{token}` is a
literal path route (not hash-based), which requires an SPA-fallback rewrite from the static host
(nginx `try_files` in the Docker path; documented Apache `.htaccess`/`FallbackResource` for plain
hosting).

`src/pages/SharePage.tsx` fetches `GET /api/share/{token}` and keeps the returned photo data in
its own local component state — **not** the global Zustand store's `photos: Map` — since that
data must never mix with a logged-in user's own photos or with guest-mode data. It does reuse a
few of the global store's incidental UI-only slots (`selectedPhotoId`, the timeline's
`dateFilter`) via `usePhotoStore`, since only one route is ever mounted at a time and those slots
carry no photo data of their own; this is a narrower reading of the plan's "not the global store"
language (which was about photo data specifically) that the implementer judged reasonable and
covered with an explicit test (`sharePage.test.tsx` asserts `photos.size` stays 0 throughout).
`MapView`, `TimelineStrip`, `PhotoThumbStrip`, and `FullSizeViewer` all gained two optional props,
`photos?: PhotoRecord[]` and `readOnly?: boolean` — supplying `photos` makes them render from that
array instead of the global store; `readOnly` hides delete buttons and disables marker
dragging/drop-to-reassign. `App.tsx`'s existing store-backed usage passes neither prop, so guest/
account-mode rendering is unchanged.

### Frontend: filter/search and drag-to-reassign

`src/lib/filters.ts` + `src/components/FilterBar.tsx` add date-range, camera make/model, and
has-location-vs-not filtering; `photoStore.ts` gained an orthogonal `searchFilters` slice (the
existing timeline-click `dateFilter` still drives click-to-open-thumbnail-strip unchanged; the two
compose). Filtering is client-side only, over the already-fetched full list, in both modes and in
the share view.

Drag-to-reassign is a new interaction on `MapView.tsx`: a drop target on the map container
(translating a drop point to lat/lon via `map.containerPointToLatLng`) accepts GPS-less photos
dragged from a new `src/components/UnlocatedPhotosPanel.tsx`, and existing markers are
`draggable: true` with a `dragend` handler for repositioning. Both funnel into a new
`reassignLocation(id, lat, lon)` store action (optimistic update with rollback-on-error) that
calls `getActiveRepository().updateLocation()` — the same `PhotoRepository` seam Phase 1 built for
this purpose. Disabled entirely when `readOnly` is set (the share view).

### Frontend: treasure-map basemap style toggle

`src/lib/mapStyles.ts` defines two presets (`detailed`, `treasure`), both sourced by default from
the same OSM tile source via `VITE_MAP_*` env vars (config-driven, not hardcoded — see Data
model/settings below). `detailed` keeps the original `maxZoom: 19` and no CSS filter; `treasure`
caps `maxZoom: 10` and applies a CSS `filter: sepia(0.65) saturate(1.6) hue-rotate(-8deg)
contrast(1.1)` plus a subtle vignette to the tile layer. Switching styles in `MapView.tsx` swaps
the active `L.tileLayer`, never touching photo markers/data — coordinates always line up
identically between styles. `src/components/MapStyleToggle.tsx` is a small on-map control;
default is Detailed, choice persisted to `localStorage` only (not synced to the account).

### Frontend: account UI

`src/components/TopBanner.tsx` (rewritten) renders login/register forms when logged out, and
account email + "copy share link" (`POST /api/share-links`) + "delete account" (`DELETE
/api/account`, then logout + revert to the guest repository) when logged in. `src/App.tsx` calls
`authStore.restoreSession()` on mount. A new `src/components/AccountNotice.tsx` shows the
"uploaded photos are stored on the server..." text for the whole duration of an authenticated
session; `PrivacyNote.tsx` is now hidden while authenticated, so the two notices are mutually
exclusive.

### Backend: `PATCH /api/photos/{id}` and CORS

`PATCH /api/photos/{id}` (new controller method on `PhotosController`, new repository method
`PhotoRepository::updateLocation()`) follows `DELETE /api/photos/{id}`'s exact conventions:
`AuthMiddleware` + `CsrfMiddleware`, ownership resolved server-side from the session, mismatched
ownership → `404` not `403`, no mass-assignment (only `lat`/`lon` are ever written). `Bootstrap.
php` registers the route using the `Router`'s pre-existing (previously unused) `patch()` method —
no routing gap existed to fill here.

`CorsMiddleware` (new) is wired directly into `backend/public/index.php` before `Session::
start()`; see "Key architectural decisions" above for its exact-match/opt-in behavior.

### API base URL and frontend configuration

A small runtime `public/config.js` (`window.__PHOTOMAP_CONFIG__ = { apiBaseUrl: "..." }`, loaded
via a `<script>` tag in `index.html` before the bundle) is layered over build-time `VITE_
API_BASE_URL`/`VITE_MAP_*` defaults, read via `src/lib/config.ts`. This is still a 100% static
file — editing it post-build (no rebuild) is what makes "same static build, different backend, no
rebuild" possible, resolving a genuine tension between "static Node-free deploy" and "configurable
API base URL." In the Docker whole-stack path this defaults to a same-origin relative `/api`
(nginx proxies it to the backend container).

### Docker: whole-stack local compose

A new root `docker-compose.yml` (distinct from the pre-existing `backend/docker-compose.yml`)
brings up `mysql` + `backend` + `frontend` services with one command (`docker compose up
--build`, `http://localhost:8080`). `docker/frontend/Dockerfile` is a multi-stage build:
`node:20-alpine` runs `npm ci && npm run build`, and only the resulting `dist/` static output is
copied into a final `nginx:alpine` stage — no Node process ever runs in the built image or in any
real deployment of it. `docker/frontend/nginx.conf` proxies `/api/*` to the backend container
(same-origin from the browser's perspective — no CORS/`SameSite` configuration needed for this
path) and falls back to `index.html` for any other path via `try_files`, which is what makes a
real page load of `/share/:token` work.

Two implementation adjustments made during the Docker path's live verification, both
non-functional robustness/correctness fixes rather than plan deviations of substance:
- The backend service's startup command wraps `php scripts/migrate.php` in a retry loop, since
  MySQL's healthcheck (`mysqladmin ping`) can report healthy a moment before it actually accepts
  application connections on a genuinely fresh volume — the loop self-heals within the same `up`
  invocation rather than requiring a manual second `docker compose up`.
- `NOMINATIM_USER_AGENT`'s default value is quoted in `docker-compose.yml`'s YAML, since the
  unquoted value's `contact: you@...` substring was otherwise parsed as a nested YAML mapping,
  breaking `docker compose config`.

`/storage/`-style paths on the frontend's own nginx origin return `200` (the SPA `index.html`
shell) via `try_files`, not `404` — this is standard SPA-fallback behavior, not a storage leak:
the frontend container has no volume access to `backend/storage/` at all, and the response body
is confirmed to be the app shell, never real file bytes. Forcing a literal `404` for `/storage/`-
shaped paths specifically would require fragile path-pattern-specific nginx rules that aren't how
SPA fallbacks normally behave, so this characteristic is documented rather than special-cased.

### Node-free static production deploy

`npm run build` → `dist/` was already the build command; Phase 3 confirmed and documented (via
`find dist -type f` and a `grep` for hardcoded URLs) that the output is plain static assets with
no Node entry point, deployable to any static host or the same web root as a plain PHP backend.
Node/npm remain build-time-only tooling, unchanged in that respect from Phase 1/2.

## Phase 4 — shared-hosting deployment support

Photomap's documented "static frontend + plain PHP/MySQL backend" production target had never
actually been packaged or proven as a single combined deployment before this phase: there was no
`.htaccess` anywhere in the repo, `Config.php` only knew how to read `.env`, and the frontend's
`dist/` and the backend's `backend/public/` were documented as two separate web roots assuming a
reverse proxy the user doesn't get to control on shared hosting. This phase turns that long-stated
intention into a concretely buildable, single-artifact deployment path, generic to any
single-directory-per-domain Apache/PHP/MySQL shared host. It changes no user-facing feature, mode
behavior, or privacy property — it is exclusively an operational/deployment addition, fully
additive alongside the existing `.env`/Docker/native-dev paths, which are byte-for-byte unchanged.

*(Naming note, added in Phase 6: the `deploy/dreamhost/` directory this phase originally created
was renamed to `deploy/shared-hosting/` in Phase 6's de-branding pass, since the mechanism
documented below was always host-agnostic — the directory name and doc prose just hadn't caught
up yet. The layout diagram and prose below reflect the current `deploy/shared-hosting/` name and
generic wording; this is the same mechanism, unchanged in substance.)

### Chosen layout: two-tier deploy, backend kept fully outside the web-reachable tree

A merged single-webroot shape (backend files, including `vendor/`, physically inside the
web-reachable directory, protected only by `.htaccess` deny rules) was considered and rejected in
favor of a two-tier, sibling-directory shape: the entire `backend/` project is uploaded to a
private directory *outside* the shared-hosting domain's mapped docroot, with only a one-line PHP stub
and the frontend's static assets inside the web-reachable docroot. This extends the project's
existing hard invariant — that photo storage must be genuinely non-web-reachable — to the entire
backend source tree via the filesystem itself, and requires zero changes to
`backend/public/index.php` or `backend/scripts/migrate.php` (both resolve their root via their own
file's `__DIR__`, unaffected by being `require`d from elsewhere).

```
~/                                    (shared-hosting account home — never web-served)
├── photomap-backend/                 <- upload the entire backend/ directory here, unmodified
│   ├── .htaccess                     <- deny-all, defense in depth (mod_userdir exposure)
│   ├── config.php                    <- the one file the user edits (DB/secret/storage settings)
│   ├── vendor/                       <- built locally via `composer install --no-dev`, never committed
│   ├── src/, migrations/, scripts/
│   ├── public/index.php              <- UNCHANGED, still the real front controller
│   └── storage/{photos,thumbnails}/  <- outside the webroot, exactly as before
└── domain.com/                       <- your host's Apache DocumentRoot for the domain
    ├── index.html, assets/*.js/css   <- dist/ contents, uploaded as-is
    ├── config.js                     <- dist/config.js, apiBaseUrl left at its default '/api'
    ├── .htaccess                     <- API rewrite + SPA fallback + optional HTTPS redirect
    └── api/
        └── index.php                <- one line: require ../../photomap-backend/public/index.php
```

Because PHP's `__DIR__` inside a `require`d file is computed from that file's own real path
regardless of who requires it, the stub's `dirname(__DIR__)` still correctly resolves to
`~/photomap-backend` from inside `backend/public/index.php`. `domain.com/.htaccess` rewrites
`/api/*` to `api/index.php` and falls back to `index.html` for any other non-file/non-directory
path — the direct Apache equivalent of `docker/frontend/nginx.conf`'s existing `/api/` proxy_pass
+ SPA `try_files` fallback. Because a typical shared host gives one directory per domain, this shape is
same-origin by construction, so the existing `CORS_ALLOWED_ORIGINS`/`SESSION_COOKIE_SAMESITE=None`
split-origin machinery is unnecessary here and defaults to the same simple same-origin settings
already used by the Docker/dev-proxy paths.

### `config.php`: a second, equivalent way to supply the same settings

`Config::load()` (`backend/src/Config.php`) now checks for a `config.php` file in the root path
*before* falling back to `.env`: if present, it must `return` a plain associative array of the
same setting keys `.env.example` documents; those values populate `$_ENV`/`putenv()` and
`.env`/phpdotenv is never consulted for that process. If `config.php` doesn't return an array, a
`RuntimeException` is thrown (parse errors in the file itself propagate naturally as a
`\ParseError`). If no `config.php` exists, behavior is exactly the pre-existing `.env` path,
unchanged. This is a strictly additive third path: Docker sets real environment variables directly
and never has a `config.php` present; native dev keeps using `backend/.env` unchanged. A test-only
`Config::resetForTesting()` was added (flips the private `$loaded` flag) so a single PHPUnit
process can exercise config.php-vs-.env precedence scenarios without `@runInSeparateProcess`.

A plain-PHP-file-returning-an-array (rather than JSON/YAML) was chosen deliberately: PHP executes
the file rather than serving its contents as plaintext even if it's ever briefly web-reachable by
mistake — defense-in-depth on top of, not instead of, the deny-all `.htaccess` and the two-tier
directory layout.

### Security addition: defense-in-depth against `mod_userdir`-style exposure

The "sibling directory is non-web-reachable" invariant only holds if nothing else on the
shared-hosting account maps `~/` (or directories under it) to a URL. Shared hosts commonly enable
`mod_userdir`, which serves a user's home directory — and any sibling directory not otherwise
domain-mapped — at `http://<server-hostname-or-ip>/~<username>/...`, a different exposure path
than same-domain directory traversal. Mitigation: a deny-all `backend/.htaccess`
(`Require all denied`, with an Apache 2.2 `Order deny,allow`/`Deny from all` fallback) ships
*inside* the backend directory itself, so it's included in every deploy regardless of
`mod_userdir` settings; the documented manual verification checklist explicitly tests the
`~username` URL path returns 403, not just the domain-mapped path.

### Packaging and migrations

`backend/scripts/package-for-deploy.sh` runs `npm run build` and
`composer install --no-dev --optimize-autoloader`, then assembles a `release/` directory with two
curated subtrees: `release/photomap-backend/` (`public/`, `src/`, `migrations/`, `scripts/`, the
freshly-built `vendor/`, `composer.json`/`.lock`, `config.php`/`.example`, `.htaccess`, storage
dirs — explicitly excluding `tests/`, `docker/`, any `.env*` file, `docker-compose.yml`, and
`phpunit.xml`) and `release/domain.com/` (the frontend's `dist/` output plus the shared-hosting
`.htaccess`/`api/index.php` stub). It includes a hardcoded-path/URL grep sweep as a warning check.
`backend/scripts/migrate.php` works unmodified over SSH + PHP CLI against a typical shared host's
MySQL/MariaDB (the schema was always MySQL-dialect-only, so no DB-dialect migration was needed). As a
fallback for accounts without SSH, concatenating `backend/migrations/*.sql` into one importable
file for a phpMyAdmin-based first-time import is documented as an on-demand, generate-when-needed
command, not a committed file (a committed copy would go stale).

### Docker and native dev: unaffected

Root `docker-compose.yml`, `backend/docker-compose.yml`, and native dev both continue to work
exactly as before — `Config::load()`'s new `config.php`-first check is a no-op in all of them,
since no `config.php` file is ever present there.

## Phase 5 — Registration approval, admin console, GPS-required uploads, calendar-heatmap timeline (v1.0.0)

This phase adds an admin-approval gate on top of the existing accounts backend, a fully separate
`/admin` console (backend API + frontend page), a stricter GPS requirement on account-mode
uploads, and a calendar-axis drill-down layer on top of the existing timeline heatmap. It changes
no guest-mode behavior at all, and is additive to every prior phase's design.

### Backend: account status, quotas, and app-wide settings

Migration `0007_add_user_status_and_quota.sql` adds `users.status`
(`ENUM('pending','active','disabled')`, default `pending`), `users.storage_quota_bytes`
(nullable `BIGINT UNSIGNED` — `NULL` means "use the site-wide default"), and
`users.approved_at`, plus indexes on `status` and `created_at` (backing the admin user list's
filter/sort). The same migration runs a one-time `UPDATE users SET status = 'active' WHERE
status = 'pending'` to grandfather every pre-existing row — since new registrations from this
point forward insert `'pending'` explicitly via `AuthController::register()`, this backfill only
ever touches rows that existed before the migration ran, never a genuinely new pending
registration made after it. Migration `0008_create_app_settings.sql` adds a singleton
`app_settings` table (`id` fixed to `1` via a `CHECK` constraint) holding
`default_storage_quota_bytes` and `uploads_enabled`, seeded with a 100MB default and uploads
enabled.

`StorageQuotaService` now resolves a per-user quota (the user's own `storage_quota_bytes` if set,
else `app_settings.default_storage_quota_bytes`) instead of a single flat env-var constant.

### Backend: admin authentication is a structural sibling of user auth, not a variant of it

The admin operator is a single hardcoded identity, not a `users` row: `ADMIN_USERNAME` and
`ADMIN_PASSWORD_HASH` (a `password_hash()`/bcrypt hash — never a reversible/encrypted secret,
since it's a login credential, not a value ever needing recovery) live in the backend
config (`.env` or `config.php`, same precedence as every other setting). `AdminAuthController`
verifies with `password_verify()`, sets a distinct `$_SESSION['admin'] = true` flag (never
`$_SESSION['user_id']`, so an admin session and a user session can never be confused with each
other), is rate-limited the same way login already was, and uses a timing-safe dummy-hash
comparison when the submitted username doesn't match the configured one, so a wrong-username
attempt takes the same time as a wrong-password one (no username-enumeration side channel).
`AdminAuthMiddleware` gates every `/api/admin/*` route except login: if `ADMIN_USERNAME`/
`ADMIN_PASSWORD_HASH` are unset it fails every admin route with `503 admin_not_configured`
(distinguishing "the feature isn't set up" from "your credentials are wrong") without touching
any other route in the app — registration, login, uploads, and sharing all work identically with
no admin configuration present at all.

Routes (`Bootstrap.php`): `POST /api/admin/login` (CSRF only), `POST /api/admin/logout`,
`GET /api/admin/me`, `GET /api/admin/users`, `POST /api/admin/users/{id}/activate`,
`POST /api/admin/users/{id}/disable`, `GET /api/admin/settings`, `PATCH /api/admin/settings`,
`GET /api/admin/stats` (all but login also require `AdminAuthMiddleware`, and all
state-changing ones also require `CsrfMiddleware`, exactly like every other mutating route).

### Backend: two `AccountStatusMiddleware` instances, not one

`AccountStatusMiddleware` is parameterized by a list of statuses it blocks, and is wired twice in
`Bootstrap.php`: a broad instance (`blockedStatuses: ['disabled']`) attached to every existing
authenticated route, and a narrow instance (`blockedStatuses: ['disabled', 'pending']`) attached
only to `POST /api/photos`. A `pending` account can therefore do everything an `active` account
can except upload; a `disabled` account is blocked everywhere. Both run after `AuthMiddleware`
(so a missing session is still a plain 401, not an account-status error) and before
`CsrfMiddleware` (so a blocked request gets its specific `account_pending`/`account_disabled`
error code even if it also lacks a CSRF token).

### Backend: the admin share-link indicator is existence-only by construction, not by filtering

`ShareLinkRepository::findActiveCreatedAtForUser()` — the only method the admin code path ever
calls — `SELECT`s just `created_at` from the active share-link row, never `token`. The raw
shareable URL is therefore architecturally unreachable from `AdminUsersController`: there is no
variable anywhere in that request's lifecycle holding the token value to (mis)serialize, rather
than a token being fetched and then stripped before the JSON response is built. The admin
frontend's `AdminUsersPanel` correspondingly only ever renders "has a link, created at <time>",
never a URL. This was a deliberate closing of a privacy gap identified during planning: showing
the admin the actual link would hand them de facto access to view that account's privately-shared
photos, which the product's private-by-default model does not intend to allow.

### Backend: mailer abstraction

A `MailerInterface` (`send(string $to, string $subject, string $body): void`) has one production
implementation, `PhpMailMailer` (PHP's built-in `mail()` — no SMTP library dependency), and two
test doubles, `FakeMailer`/`FailingFakeMailer`. `Bootstrap::resolveDefaultMailer()` returns the
fake when `MAIL_TRANSPORT=fake` is set in the environment (used by the test suite's
`.env.test`), otherwise the real mailer — guarded with `class_exists()` so a `--no-dev` production
install (where the test-only fake class doesn't exist) can never fatal on this check. Every email
send (new-registration-to-admin, activation-to-user, disable-to-user) is wrapped in a catch-and-
log; a mail failure never blocks the registration, activation, or disable action that triggered
it.

### Backend: GPS-required uploads

`PhotosController::store()` now rejects an upload with `422 gps_required` if the parsed/validated
photo has no usable GPS coordinates, for account-mode uploads only — guest mode never calls this
endpoint at all, so it is structurally unaffected regardless of this change.

### Frontend: admin console is a fully separate page/store/API tree

Mirroring how `SharePage.tsx` is already kept separate from the main app's global photo state, the
admin console never touches `photoStore`/`authStore`: a third route, `/admin` (added to the
existing hand-rolled `Router.tsx`), renders `src/pages/AdminPage.tsx`, backed by its own Zustand
store (`src/state/adminStore.ts`, session states `idle|checking|authenticated|anonymous`) and its
own thin API wrapper module (`src/lib/api/adminApi.ts`, built on the same shared CSRF/`http.ts`
mechanism every other API module uses). `src/components/admin/` holds
`AdminLoginForm.tsx`/`AdminUsersPanel.tsx`/`AdminSettingsPanel.tsx`; `src/lib/adminUsers.ts` holds
pure helpers (query building, sort-state cycling, share-link/status/byte formatting).

### Frontend: registration notice popup

`src/components/RegistrationNoticeModal.tsx` is wired into `TopBanner.tsx`'s registration form:
submitting no longer calls `register()` directly — it opens the modal, and only an explicit
"I understand, create my account" acknowledgement calls `register()`. The modal's content
resolves the plan's two settled ambiguities directly: it never asks for a separate notification
email (there's no such field in the schema — the account's own email is reused), and its privacy
language deliberately says "private by default, shared only via a link you control" rather than
the original request's "publicly visible on the internet" framing, since the latter overstates
this product's actual exposure model.

### Frontend: GPS-required handling and the "Discarded (No GPS)" label

`types.ts` gained an optional `IngestStatus.gpsRequiredNotice: string` field, set by
`lib/ingest/index.ts` when it catches an `ApiError` with `code === 'gps_required'` — handled as
its own distinct branch (mirroring the pre-existing `storageWarning`/quota-exceeded branch)
rather than a new counter, specifically to avoid changing the shape of `IngestStatus` literals
that ~8 pre-existing test files construct directly. `StatusPanel.tsx`'s "Without GPS" counter
label was renamed to "Discarded (No GPS)"; this label is shared by both modes' status panel
(there is only one `StatusPanel` component), even though only account-mode uploads are actually
discarded server-side — guest mode still retains and displays GPS-less photos exactly as before,
just under the renamed label.

### Frontend: timeline calendar-axis drill-down, evolved not rewritten

`lib/timeline.ts` gained `computeYearBins`/`computeMonthBins`/`computeDayBins`, `yearsPresent`,
`MONTH_LABELS`, and an optional `label` field on `TimelineBin` — pure functions alongside the
pre-existing density-binning logic, not a replacement for it. `TimelineStrip.tsx` gained a
`density|year|month|day` navigation level with breadcrumbs and an axis-label row under the
canvas; the original adaptive density-heatmap rendering remains the unchanged default view.
Selecting a bin drills down one level at `year`/`month`, and applies the existing date-filter/
thumbnail-strip behavior at `day` level (or in the original, unchanged density mode) — the same
interaction contract as before, just reachable one level deeper.

### Test-infrastructure fixes found and made during this phase (not feature-logic changes)

An audit of an initially non-deterministic backend test suite root-caused and fixed three
test-infrastructure bugs, none of them defects in the new feature code itself:

- `tests/Support/ServerProcess.php`'s `.env.test` parser only stripped double quotes, leaving a
  literal single-quote character attached to `ADMIN_PASSWORD_HASH` in the spawned test server's
  environment and breaking `password_verify()` for every admin-auth Feature test. Fixed to strip
  either a matching single- or double-quote pair.
- `StorageQuotaService::reserveAndInsert()` had no handling for a genuine MySQL deadlock
  (SQLSTATE `40001`) under concurrent same-user uploads; the transaction body was extracted into a
  private `attemptReserveAndInsert()` and wrapped in a retry-with-backoff loop (up to 3 attempts)
  in the public method.
- One Feature test reused a single HTTP client/cookie jar across two different logged-in users,
  silently invalidating the first user's CSRF token before it was used; fixed with an independent
  `HttpClient` per user, matching the pattern already used elsewhere in the suite.

A fourth, unrelated latent bug was also found and fixed globally rather than patched around in one
test: `Http/JsonResponse.php`'s single shared `json_encode()` call lacked
`JSON_PRESERVE_ZERO_FRACTION`, so a whole-number float (e.g. `lat`/`lon` cast to `(float)` in
`PhotoPresenter`) silently serialized without a decimal point and round-tripped back as an int —
newly exposed by new tests using round-number coordinates, but a pre-existing contract bug
affecting every endpoint that returns a float, not something introduced by this phase's own code.

## Phase 6 — De-branding, deploy automation, layout fixes, countries-visited, and registration hardening

Six independent items bundled into one release on top of v1.1.0 (process/tooling) and Phase 5
(v1.0.0): removing a specific hosting provider's name from committed docs/scripts, adding an
opt-in automated deploy path, fixing a real on-map panel-overlap bug and adding world-repeat
prevention, adding an offline client-side countries-visited feature, and hardening registration
against automated signups. None of them change guest mode's "photos never leave this device"
guarantee, and none of them add new frontend/backend runtime coupling.

### De-branding: `deploy/dreamhost/` → `deploy/shared-hosting/`

Phase 4's deployment mechanism was always generic Apache/PHP/MySQL shared hosting — the
directory name and doc prose just hadn't caught up. This phase renames the directory (`git mv`,
preserving history) and rewords every current-state/forward-looking doc and script (READMEs,
`config.php.example`, code comments, `docs/product.md`/`docs/code.md`) to generic
"shared host"/"your host's panel" language. Scope explicitly excludes `docs/plans.md` and
`docs/original_prompts.md`, which are append-only historical records of what a past change was
actually called and did — retroactively editing them would falsify that history. This is pure
renaming/rewording; no runtime behavior changed.

### Deploy automation: opt-in, key-auth-only, with an always-available manual fallback

`backend/scripts/deploy.sh` (new) wraps `package-for-deploy.sh` (reused, not duplicated) and then
either automates the upload+migrate step over SSH or prints a concrete numbered manual checklist,
depending on a gitignored `deploy.config.json` (template: `deploy.config.example.json`, committed).
Automation only ever runs when `sshHost`/`sshUser`/`sshKeyPath`/`remoteBackendPath`/
`remoteFrontendPath` are all present *and* `sshKeyPath` points to a readable private key file —
password-based automation is deliberately never implemented, so a config with only a password
field always falls through to the manual fallback. When a fully-configured config is found, the
script `chmod 600`s it automatically (never left for the user to remember) before using it. No
new language-runtime dependency: `jq` (already a documented `smoke-test.sh` dependency) parses
the config, and `rsync`-over-SSH (falling back to `scp -r` if `rsync` isn't on `PATH`) handles
transfer — same security properties as SFTP (SSH key auth, encrypted transport), more robust for
repeated deploys (delta transfer). `npm run deploy` is the new root `package.json` entry point.

### Frontend layout: map-dominant two-region layout, replacing floating overlay panels

Confirmed in the actual CSS, not hypothetical: `StatusPanel` (`top: 0.75rem; right: 0.75rem;
z-index: 1000`) and `MapStyleToggle` (`top: 0.6rem; right: 0.6rem; z-index: 1000`) were both
absolutely positioned in the same top-right corner of the same `position: relative` ancestor
(`.upload-control` → `.map-view`), with near-identical offsets and identical stacking level —
a real, reproducible overlap, not a rare-viewport-size edge case. Fixed architecturally, not just
cosmetically: `App.tsx`/`App.css` now use a two-region flex layout — `.app__map-region` (the map,
`flex: 3`) and `.app__side-region` (`flex: 0 0 300px`, normal document flow, `overflow-y: auto`)
holding `StatusPanel`, `UnlocatedPhotosPanel`, and the new `CountriesPanel`. `StatusPanel.css` lost
its `position: absolute`/`top`/`right`/`z-index` entirely — it's a normally-flowed block now.
`MapStyleToggle` (a genuinely map-native control, the same convention as Leaflet's own zoom
buttons) remains the only on-map overlay in that corner; the folder-select button remains the
other legitimate on-map overlay, in the opposite corner — no collision between the two.

Separately, `MapView.tsx`'s Leaflet map instantiation gained `minZoom: 2`,
`maxBounds: L.latLngBounds([-90,-180],[90,180])`, and `maxBoundsViscosity: 1.0`, and both
tile-layer configs (Detailed and Treasure Map) gained `noWrap: true` — standard Leaflet behavior
at low zoom is otherwise to repeat the world horizontally with no `minZoom`/`maxBounds`/`noWrap`
set, which is exactly what was happening before this change. `maxZoom` and the existing
Treasure Map zoom-cap decision (Phase 3) are untouched — this only adds world-repeat prevention,
nothing else about the zoom range. Real-browser visual verification of "no world-copy repetition
at low zoom" and "no panel overlap at various viewport widths" is not feasible in this
environment and is documented as a manual follow-up item rather than silently skipped.

### Countries-visited: fully offline, client-side, shared by both modes

New client-derived view: for every photo with usable GPS, resolve which country it was taken in
and which distinct month/year(s) photos exist for that country, in a collapsible
`CountriesPanel` in the new side region (and optionally in the read-only share view).

**Why not the existing `GET /api/geocode`/Nominatim path**: that path is account-mode-only
(requires a login session), would require transmitting GPS coordinates off-device to compute a
per-photo country — a direct violation of guest mode's "your photos never leave this device"
guarantee, which explicitly includes GPS coordinates, not just photo bytes — and stores an
unstructured `place_name` display string rather than a structured country field, which would
require unreliable English-string parsing to extract a country. It's also a poor fit for a
bulk all-photos-at-once computation against a shared 1-request/second rate limit. A bundled,
offline, client-side country-boundary lookup is strictly better on privacy, reliability, and
performance, and — critically — works identically in guest mode, account mode, and the share
view, none of which need a network call or a login session to compute it.

Implementation: `public/data/countries-110m.geo.json` (Natural Earth 1:110m admin-0 country
boundaries, public domain, trimmed to just `{name, geometry}` per feature — ~250KB, 177
countries) is fetched once and cached in-memory by `src/lib/countryLookup.ts`'s
`loadCountryBoundaries()`. `findCountryForPoint(lat, lon)` does a hand-rolled ray-casting
point-in-polygon test (supporting `Polygon`/`MultiPolygon` with holes), with a cheap per-country
bounding-box pre-check before the full ray-cast. `src/lib/countries.ts`'s
`computeCountryVisits()` reuses `computeMarkerGroups()` (the same ~50m grid-bucketing already
used for map markers) so exactly one country lookup runs per marker group, not per photo — a
folder import can easily contain thousands of photos at a handful of distinct locations. No new
npm dependency; zero backend involvement; zero network calls beyond the one-time bundled-asset
fetch.

### Registration anti-spam hardening: no-dependency stack, no third-party CAPTCHA

`AuthController::register()` previously had zero throttling, no honeypot, no timing check, and no
disposable-domain check — only email-uniqueness and an 8-char password minimum, plus the CSRF
requirement every state-changing endpoint already has. Login already had per-account/per-IP rate
limiting (`RateLimiter`/`login_attempts`); this phase closes the equivalent gap for registration,
mirroring that existing pattern rather than inventing a new one:

- A new `registration_attempts` table (migration `0009`) and `RegistrationAttemptRepository`
  (`countRecentByIp()`/`record()`) — a dedicated table, not a reuse of `login_attempts`, since
  every registration POST counts against the window regardless of outcome (no "succeeded" concept
  to filter on the way login has).
- A new `DisposableEmailDomainList` service: a static, hardcoded, curated list of ~50 well-known
  disposable-email domains, matched case-insensitively including subdomains. Deliberately not
  admin-configurable in this release — a reasonable future extension point, not required now.
- `AuthController::register()`'s validation chain gained four checks, each with its own typed
  error code, in this order: honeypot (`bot_detected`, `422` — a hidden, off-screen-not-
  `display:none` field a bot filling every field would trip, but no legitimate keyboard/screen-
  reader user ever could, via `aria-hidden`/`tabIndex={-1}`), timing (`bot_detected`, `422` —
  `formRenderedAt`, captured once when the frontend's registration form first renders, must be at
  least `REGISTRATION_MIN_FORM_SECONDS` seconds old), per-IP rate limit
  (`too_many_attempts`, `429`, mirroring login's error code for the analogous case), and
  disposable-email-domain (`disposable_email`, `422`). Existing checks (email format, password
  length, email uniqueness) run last, unchanged. Every registration POST is recorded via
  `RegistrationAttemptRepository::record()` regardless of which check (if any) ultimately rejects
  it, mirroring `login_attempts`' "record everything" pattern — a bot retrying past the honeypot
  or timing check still counts toward the throttle. The count used for a given request's own
  threshold decision is read *before* that request's own row is recorded, avoiding an off-by-one.

**Explicit decision: no third-party CAPTCHA (no Cloudflare Turnstile, reCAPTCHA, or hCaptcha) in
this release.** This was the one genuinely open question in the originating plan, deliberately
left to the user's judgment — but since the `AskUserQuestion` tool was unavailable to the
coordinator in the run that produced this change, the coordinator adopted the analyser's own
well-reasoned recommendation (ship the no-dependency stack above; revisit CAPTCHA only if spam
signups persist in practice against the deployed app) rather than blocking indefinitely. This is
recorded here explicitly, flagged as **revisitable** — it was resolved by the coordinator
adopting a recommendation, not by direct user confirmation, and should be revisited if bot
signups turn out to still reach the admin-approval queue in practice.

## Resolved architecture questions

Full rationale for each of these lives in the phase section referenced; this list is a fast index
of the decision itself, not a repeat of the "why."

- "Zero network calls" vs. the mandated Leaflet+OSM stack → scoped to photo data only; tile
  requests are a disclosed exception (Phase 1).
- IndexedDB caches derived thumbnail/preview images only, never original bytes (Phase 1).
- No hard guest-mode performance/scale target — best-effort for typical personal libraries
  (hundreds–thousands of photos), `navigator.storage` used for pressure signals, not a hard cap
  (Phase 1).
- Share links are single-active/"rotate" semantics, not multiple simultaneous links (Phase 2).
- Photo image bytes are protected via signed, time-limited HMAC URLs, not an ownership-checked
  streaming endpoint (Phase 2).
- The global Nominatim rate limit is serialized via a MySQL row lock, not `flock()` (Phase 2).
- Account deletion does not invalidate other active sessions elsewhere — no cross-session store
  exists (Phase 2, still a known limitation).
- The per-account storage quota is admin-configurable at runtime (site-wide default +
  optional per-account override), not a fixed constant, as of v1.0.0 (Phase 5).
- Filter/search and drag-to-reassign apply to both modes (Phase 3), grounded in Phase 1's
  `PhotoRepository.updateLocation()` seam having been built for this purpose.
- The public share view keeps filters and the map-style toggle available (non-mutating); upload,
  delete, and login/register stay excluded (Phase 3).
- `/share/{token}` (and `/admin`) routing is hand-rolled, not `react-router-dom` — consistent with
  the backend's own minimal-dependency router (Phase 3).
- The frontend API base URL is runtime-configurable (`public/config.js` over build-time
  defaults) — the only way to keep a single static build deployable against different backends
  with no rebuild (Phase 3).
- Cross-origin cookie/CORS support (`SameSite` configurability, opt-in `CorsMiddleware`) exists
  only for genuinely split-origin production deployments; both reverse-proxy dev/Docker setups are
  same-origin and never touch it (Phase 3).
- No guest-to-account photo migration on login/logout — two separate namespaces, by design
  (Phase 3, still a known limitation).
- `PATCH /api/photos/{id}` is allowed for any owned photo, not just currently-GPS-less ones,
  consistent with the other photo endpoints (Phase 3).
- Treasure Map's zoom cutoff/CSS filter recipe is locked and config-driven via `VITE_MAP_*`
  (Phase 3); the map style choice is `localStorage`-only, not synced across devices.
- The client-generated vs. server-assigned photo id mismatch (found during Phase 3's own review)
  was fixed via `PhotoRepository.add()` returning the persisted record and a `reconcileId()` store
  action (Phase 3).
- The backend's EXIF-orientation handling (found during Phase 3's own review, since it was fed an
  already-recompressed preview) was fixed in `exifWorker.ts` rather than left as a limitation,
  since account mode now persists that preview permanently server-side (Phase 3).
- Shared-hosting deploy uses a two-tier sibling-directory shape (backend project entirely outside
  the domain's docroot), not a merged single-webroot-plus-`.htaccess`-deny shape (Phase 4);
  the mechanism is generic Apache/PHP/MySQL, with no dependency on any particular hosting provider.
- `config.php` is additive to `.env`, checked first by `Config::load()` when present, never
  replacing the native-dev/Docker paths (Phase 4).
- `vendor/` is never committed — always built locally (or via the documented Docker/SSH fallback)
  immediately before packaging/upload (Phase 4).
- The `mod_userdir` home-directory exposure risk is mitigated by a deny-all `backend/.htaccess`
  shipped inside the private backend directory itself, plus a manual-checklist `~username` URL
  test (Phase 4).
- The admin console is a fully separate frontend page/store/API tree and a structurally distinct
  backend auth check (`$_SESSION['admin']`, never `$_SESSION['user_id']`) — it never shares state
  or a session mechanism with the main user-facing app (Phase 5).
- The admin-facing share-link indicator is existence+timestamp only — `findActiveCreatedAtForUser()`
  never selects `token`, so the raw URL is architecturally unreachable from that code path, not
  merely filtered out afterward (Phase 5) — showing it would give the admin de facto access to a
  user's privately-shared photos.
- The admin credential is a one-way `password_hash()`/`password_verify()` hash, matching user
  passwords, not a reversible/encrypted secret (Phase 5).
- The v1.0.0 timeline change evolved the existing density-heatmap component with an added
  calendar-axis drill-down layer, rather than rebuilding it from scratch (Phase 5).
- The activation/disable "notification email" reuses the account's existing login email — there is
  no separate schema column for it (Phase 5).
- `deploy/dreamhost/` was renamed to `deploy/shared-hosting/`; the mechanism was always generic
  Apache/PHP/MySQL, never provider-proprietary (Phase 6).
- Deploy automation is opt-in and key-auth-only via a gitignored `deploy.config.json`; password-based
  automation is deliberately never implemented, with an always-available numbered manual fallback
  (Phase 6).
- The `StatusPanel`/`MapStyleToggle` on-map overlap was fixed architecturally, via a two-region
  map+side-panel layout, not by nudging offsets (Phase 6).
- The map gained `minZoom`/`maxBounds`/`noWrap` to prevent low-zoom world-repeat, without touching
  `maxZoom` or the Treasure Map zoom-cap decision (Phase 3, unaffected) (Phase 6).
- Countries-visited resolution is fully client-side/offline (bundled country-boundary GeoJSON +
  hand-rolled point-in-polygon), not the existing `GET /api/geocode`/Nominatim path — required to
  preserve guest mode's GPS-never-leaves-the-device guarantee and to work identically in guest,
  account, and share-view contexts (Phase 6).
- Registration anti-spam is a no-dependency stack (honeypot + timing check + per-IP rate limit +
  disposable-domain blocklist), mirroring the existing login-rate-limit pattern; **no third-party
  CAPTCHA was implemented**, a decision resolved by the coordinator adopting the analyser's
  recommendation (`AskUserQuestion` was unavailable), explicitly flagged as revisitable if spam
  persists in practice (Phase 6).
