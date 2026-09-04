# Photomap — Architecture

## Current state

Photomap now consists of two projects that are wired together at runtime, deployed and run
independently:

- A frontend project (TypeScript + Vite + React) at the repo root, implementing both guest mode
  (Phase 1) and account mode (wired in Phase 3), plus a hand-rolled two-route router, a treasure-
  map basemap style, filter/search, and drag-to-reassign.
- A standalone backend project (PHP 8.x + MySQL) at `backend/`, implementing the accounts API
  (Phase 2) plus a new `PATCH /api/photos/{id}` endpoint and optional CORS support (Phase 3).

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

## Resolved architecture questions

- **Does "zero network calls" contradict the mandated Leaflet + OpenStreetMap tile stack?**
  No — the guarantee is scoped to photo data specifically; OSM tile requests are a disclosed,
  expected exception (see above).
- **Should IndexedDB cache original photo bytes or only derived images?** Only derived
  thumbnail + preview images, never originals (see above).
- **Is there a numeric performance/scale target for guest mode?** No hard target; the design
  (worker pool, thumbnail/preview-only storage) targets typical personal libraries (hundreds to
  a few thousand photos) as best-effort, with `navigator.storage.estimate()`/`persist()` used to
  surface quota pressure rather than enforcing a hard cap.
- **Share-link "create/rotate" semantics?** Single-active-link: `POST /api/share-links` revokes
  the existing link (if any) and creates a new one, matching the original spec's singular wording
  "this user's share token."
- **How should uploaded/served photo images be protected — ownership-checked endpoint or
  signed/expiring URL?** Signed, HMAC-based, time-limited URLs (15 min owner / 10 min share
  context), regenerated fresh on every JSON response and never persisted; share-context URLs
  additionally re-check revocation live on every fetch, not just at issuance.
- **What serializes the global 1-req/sec Nominatim rate limit across PHP worker processes?**
  A MySQL row lock (`SELECT ... FOR UPDATE`) on a sentinel row, not a filesystem `flock()`, since
  MySQL is already a hard dependency and a DB lock works correctly across multiple processes.
- **Does account deletion need to invalidate other active sessions for the same account
  elsewhere?** No — out of scope; documented limitation, since no cross-session store exists in
  this design.
- **Is the 100MB per-account storage quota permanent product policy?** Not decided; enforced
  exactly as specified, with permanence left as a future product decision.
- **Should account-mode filter/search and drag-to-reassign be added at all, and for which
  mode(s)?** Both modes — grounded in the fact that Phase 1's `PhotoRepository` interface already
  included `updateLocation()`, built specifically for this purpose, and in the original spec's own
  framing of these as "remaining core features from the original spec, now that both modes
  exist."
- **Should the public share view expose filters and the map-style toggle, or be strictly
  minimal?** Filters and the style toggle remain available (both non-mutating); upload, delete,
  and login/register remain excluded.
- **`/share/{token}` routing: react-router-dom or hand-rolled?** Hand-rolled — see "Frontend:
  hand-rolled router" above.
- **Runtime-configurable API base URL vs. purely build-time?** Runtime `public/config.js`
  layered over build-time defaults — the only way to satisfy "same static build, different
  backend, no rebuild" while staying 100% static.
- **Cross-origin cookie/CORS strategy?** `Session.php`'s `SameSite` became configurable (default
  unchanged: `Lax`), plus a new opt-in `CorsMiddleware`/`CORS_ALLOWED_ORIGINS`. Both reverse-proxy
  setups (native dev, Docker) are same-origin by design and never touch this; it exists purely for
  a genuinely split-origin production deployment.
- **Should logging in migrate guest-mode IndexedDB photos into the new account?** No — out of
  scope for this version; guest and account data remain two separate namespaces, documented as a
  known limitation.
- **Should `PATCH /api/photos/{id}` be restricted to only currently-GPS-less photos?** No —
  allowed for any owned photo, consistent with the other photo endpoints' unrestricted-within-
  ownership design.
- **Treasure Map's exact zoom cutoff and CSS filter recipe?** Locked as `maxZoom: 10` and CSS
  filter `sepia(0.65) saturate(1.6) hue-rotate(-8deg) contrast(1.1)` plus a subtle inset vignette,
  both config-driven via `VITE_MAP_*` env vars.
- **Should the map style choice sync across devices for an account?** No — `localStorage` only
  for this version.
- **How was the client-generated vs. server-assigned photo id mismatch (an advisor-flagged gap
  the plan's original draft missed) resolved?** `PhotoRepository.add()`'s signature changed from
  `Promise<void>` to `Promise<PhotoRecord>`; `ingest/index.ts` reconciles the store entry via a
  new `reconcileId(oldId, newRecord)` action whenever the returned id differs from the
  client-generated one (a no-op in guest mode).
- **Should the backend's EXIF-orientation handling, fed an already-recompressed EXIF-stripped
  preview, be fixed or just documented as a limitation (another advisor-flagged gap)?** Fixed —
  `exifWorker.ts` now applies orientation correction when generating the thumbnail/preview canvas
  images, benefiting both modes and removing what would otherwise have become a permanent,
  server-persisted data-quality bug in account mode.
