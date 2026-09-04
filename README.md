# Photomap

Drop a folder of your own photos onto a map and a timeline and immediately see *where* and
*when* they were taken.

Photomap has two modes:

- **Guest mode** — frontend-only, no login, no server. Your photo data never leaves your
  browser (see "Privacy and storage" below). Works out of the box with zero setup.
- **Account mode** — log in (or register) to upload photos to a small PHP+MySQL backend, so
  your library is available from any device and you can generate a read-only share link for
  someone else to view.

Both modes share the same map/timeline UI, filter/search (date range, camera make/model,
has-location), drag-to-reassign a marker's location for GPS-less photos, and a choice of two
basemap styles: **Detailed** (the default) or **Treasure Map** — the same OpenStreetMap tiles
under a stylized filter with a lower maximum zoom, for a "less fine grained but nicer-looking"
map. A photo pin lands in the identical place in both styles.

## Quick start: Docker (one command, no local installs beyond Docker)

```bash
docker compose up --build
```

Then open **http://localhost:8080**. This brings up MySQL, the PHP backend (with migrations run
automatically), and the frontend behind nginx, all as one local stack, with the frontend and API
on the same origin (nginx proxies `/api/*` to the backend container) — no CORS configuration
needed. To start over from scratch:

```bash
docker compose down -v && docker compose up --build
```

This is a **local-use convenience**, not a hardening exercise: it uses a fixed placeholder
`APP_SECRET` and default MySQL credentials baked into `docker-compose.yml`, fine for trying the
app locally but not for exposing it to the internet as-is (see `docker-compose.yml`'s comments
for how to override them). It is distinct from `backend/docker-compose.yml`, which is a
narrower, backend-only dev/test convenience (see `backend/README.md`).

## Native dev setup (no Docker)

Three things running at once: a local MySQL server, the PHP backend, and the Vite dev server.

```bash
# 1. MySQL: create a database/user (see backend/README.md "Setup" for the exact SQL).

# 2. Backend (terminal 1)
cd backend
composer install
cp .env.example .env   # fill in DB credentials, STORAGE_PATH, APP_SECRET
php scripts/migrate.php
php -S localhost:8000 -t public public/index.php

# 3. Frontend (terminal 2, from the repo root)
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). Vite's dev server proxies `/api`
requests to `http://localhost:8000` (configurable via `VITE_DEV_API_PROXY_TARGET`), so the
browser sees the frontend and backend as the same origin here too — no CORS configuration
needed for this path either. Guest mode works with no backend running at all; account mode
needs the backend up.

## Production deployment

The frontend build (`npm run build` → `dist/`) is **plain static files** — HTML/CSS/JS plus a
runtime `config.js` — deployable to *any* static file host or plain PHP+MySQL host, with **zero
Node process running**. Node/npm are build-time tooling only; nothing in `dist/` requires a
Node server. Verified as part of this change: `find dist -type f` shows only static assets.

- **Frontend**: upload `dist/` to any static host (or serve it from the same PHP host's web
  root). Configure `dist/config.js` (a plain file — no rebuild needed) with the real backend
  `apiBaseUrl`. If the frontend is on a route reachable at real page loads (not just
  client-side navigation) — in particular `/share/:token` — the host needs an SPA-fallback
  rewrite to `index.html`: Apache `.htaccess`/`FallbackResource`, nginx `try_files` (see
  `docker/frontend/nginx.conf` for a working example).
- **Backend**: `backend/public/` as the web root on any PHP 8.1+/MySQL host — see
  `backend/README.md` for full setup.
- **Same-origin vs. split-origin**: if the frontend and backend end up on different origins in
  production (rather than the same origin via a reverse proxy), the backend needs
  `CORS_ALLOWED_ORIGINS` and `SESSION_COOKIE_SAMESITE=None` (which also requires
  `APP_ENV=production`, i.e. real HTTPS) — see `backend/README.md`'s "CORS and cross-origin
  cookies" section. Same-origin deployments (a reverse proxy in front of both, like the Docker
  path above) never need either setting.

## Privacy and storage — side by side

- **Guest mode**: *"your photos never leave this device."* Photo bytes, EXIF metadata,
  filenames, and GPS coordinates are parsed, thumbnailed, stored (IndexedDB), and rendered
  entirely client-side. The one disclosed exception is ordinary OpenStreetMap basemap tile
  requests (generic tile x/y/z indices only, never photo data), inherent to using an online
  slippy map. Shown as a persistent banner whenever you're not logged in.
- **Account mode**: *"your uploaded photos are stored on the server for this account."* Shown as
  a persistent banner for the entire duration of an authenticated session — visible before any
  upload can happen. Uploaded images are stored **outside the backend's web root**, under
  randomized filenames, and served only via short-lived, HMAC-signed URLs (15 minutes for you,
  10 minutes for a share-link recipient) that are regenerated fresh on every API response and
  never persisted — this is a security/privacy property of the backend, verified as a
  non-regression by this change (`backend/tests/Feature/SecurityFeatureTest.php`,
  `PhotosFeatureTest.php`).
- Logging in does **not** upload your existing guest-mode photos, and logging out does **not**
  clear them — guest-mode IndexedDB data and account-mode server data are two separate
  namespaces (no migration between them in this version).

## Settings reference

### Frontend (`.env`, or override post-build via `public/config.js` / deployed `config.js`)

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Build-time default; `config.js`'s `apiBaseUrl` overrides it at runtime with no rebuild. |
| `VITE_DEV_API_PROXY_TARGET` | `http://localhost:8000` | Native dev only — where Vite's `/api` proxy forwards to. |
| `VITE_MAP_TILE_URL_DETAILED` | OSM tile URL | Detailed style's tile source. |
| `VITE_MAP_ATTRIBUTION_DETAILED` | `&copy; OpenStreetMap contributors` | |
| `VITE_MAP_MAX_ZOOM_DETAILED` | `19` | |
| `VITE_MAP_TILE_URL_TREASURE` | same OSM tile URL | Treasure Map defaults to the *same* tile source — only rendering/zoom differ. |
| `VITE_MAP_ATTRIBUTION_TREASURE` | `&copy; OpenStreetMap contributors` | |
| `VITE_MAP_MAX_ZOOM_TREASURE` | `10` | Country/region-level cap — no street names/house numbers reachable. A dense marker cluster can't be zoomed in far enough to visually separate the way Detailed mode allows; this is inherent to the feature, not a bug. |
| `VITE_MAP_TREASURE_CSS_FILTER` | `sepia(0.65) saturate(1.6) hue-rotate(-8deg) contrast(1.1)` | CSS `filter` applied to the tile layer. |

See `.env.example` at the repo root and `public/config.js` for the exact mechanics.

### Backend (`backend/.env`)

See `backend/README.md`'s full settings/API tables; the settings this change adds:

| Variable | Default | Notes |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated, exact-match allow-list of frontend origins. Empty = no CORS headers emitted at all. Only needed for a split-origin deployment. |
| `SESSION_COOKIE_SAMESITE` | `Lax` | Set to `None` only for a split-origin deployment (also requires `APP_ENV=production`/HTTPS). |

## Known limitations (carried over and new)

- **No guest-to-account migration.** Logging in never uploads existing guest-mode photos;
  logging out never clears them. Two separate namespaces, by design for this version.
- **Account deletion ends only the current session** — it does not invalidate other active
  sessions for the same account elsewhere (carried over from Phase 2; no cross-session store
  exists in this design).
- **No orphan-file cleanup job**, and **`X-Forwarded-For` is not trusted** for the login rate
  limiter's IP (carried over from Phase 2 — this deliverable is local-dev/direct-connection or a
  same-origin reverse-proxy setup, not a hardened multi-hop production topology).
- **HEIC/HEIF**: thumbnail/preview *image* rendering falls back to a placeholder icon on
  browsers that can't decode HEIC in-browser (Chrome/Firefox as of this writing); EXIF metadata
  (GPS, datetime) is still fully extracted and the photo participates fully on the map/timeline.
  In account mode, an undecodable HEIC upload is treated as an upload error (no image bytes to
  send the server), not silently skipped.
- **No delete "tombstone" in guest mode**: caching is per-file, not per-folder, so re-selecting
  the same folder after deleting a photo re-adds it. Unaffected by account mode, which has no
  such folder-reselection concept.
- **Treasure Map's zoom cap is a deliberate stylistic choice**, not a bug — see the settings
  table above.
- **Filter/search is client-side only** — `GET /api/photos` returns the full list; no
  server-side query-param filtering exists or is needed at this scale.
- **Map style choice is per-browser (`localStorage`) only** — it does not sync across devices
  for an account, unlike photo data itself.
- Nice-to-haves (GeoJSON/KML export, heatmap-density mode, trip auto-grouping/route lines)
  remain out of scope for this change, per the original request's own "if time allows" framing.

## Project layout

```
src/            Frontend (guest + account mode UI, state, API client, ingest pipeline)
public/         Static assets served as-is, including config.js (runtime settings)
test/           Frontend Vitest unit/integration tests
backend/        Standalone PHP + MySQL accounts backend (own README, own tests)
docker/         Root whole-stack Docker Compose build context (frontend Dockerfile + nginx.conf)
docker-compose.yml   Root whole-stack compose file (see "Quick start" above)
docs/           product.md, architecture.md, code.md, plans.md, original_prompts.md
```

See `docs/code.md` for the detailed frontend module layout and `backend/README.md` for the
backend's.

## Testing

```bash
npm test                        # frontend: vitest
cd backend && composer test     # backend: phpunit (via Docker if you don't have PHP/MySQL
                                 # natively — see backend/README.md's Docker section)
```

See `docs/code.md` and `backend/README.md` for what's covered by each suite, and what's
manual-only (real cross-browser drag-and-drop, live two-real-origin cookie behavior, visual
Treasure Map inspection, etc.).
