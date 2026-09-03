# Photomap — Feasibility Analysis & Build Prompt

Backend decision (confirmed): **custom backend in PHP + MySQL** for account
mode. Guest mode stays fully client-only, as in the original research.

---

## 1. Feasibility analysis

### 1.1 The contradiction in the original draft

The draft says "no backend" in the stack, but also asks for login/register,
account deletion, and a "permalink to share the map." Those three features
are impossible without a server:

- **Login** needs somewhere to verify a password that isn't the user's own
  browser (otherwise anyone could just edit local storage to "log in").
- **A permalink another person can open** needs data stored somewhere both
  browsers can reach — it can't live only in the uploader's IndexedDB.
- **Account deletion** needs a server-side record to delete.

Resolution used below: **two explicit modes**, Guest and Account, each with
different guarantees, and the UI must be honest with the user about which
mode they're in (see §1.4, privacy copy).

### 1.2 Risk areas specific to a custom PHP/MySQL backend

Since you're rolling your own auth instead of using a managed provider, these
are the places that most commonly turn into real vulnerabilities and must be
treated as requirements, not polish:

- **Password storage**: use PHP's `password_hash()`/`password_verify()`
  (bcrypt/argon2i), never a hand-rolled hash. Never log or return password
  values.
- **SQL injection**: every MySQL query must use PDO/mysqli **prepared
  statements** with bound parameters — no string-concatenated SQL, anywhere.
- **Session handling**: PHP session cookies must be `HttpOnly`, `Secure`
  (HTTPS only), `SameSite=Lax` or `Strict`. Regenerate the session ID on
  login (`session_regenerate_id`) to prevent session fixation.
- **CSRF**: since auth is cookie-based, every state-changing endpoint
  (upload, delete, account deletion, share-link creation) needs a CSRF
  token check, not just a valid session.
- **Login rate limiting**: throttle/lock out repeated failed login attempts
  per account/IP to block brute-forcing.
- **File upload validation**: never trust the file extension or the
  browser-supplied MIME type. Validate actual file content (`finfo`/magic
  bytes) server-side, enforce a max size, and store uploaded files **outside
  the web root** with randomized filenames — never let a filename come
  directly from user input.
- **Authorization**: every photo/account endpoint must check that the
  requested resource belongs to the logged-in session's user, not just that
  the user is logged in (classic IDOR risk: `/api/photos/123` must 403 if
  photo 123 belongs to someone else).
- **Transport**: the whole account-mode API must run over HTTPS in
  production; local dev over HTTP is fine but should not be the deployed
  config.

None of this is exotic, but it's exactly the list of things that go wrong in
hand-rolled PHP auth systems, so it needs to be explicit in the build prompt
rather than assumed.

### 1.3 Sharing a permalink — privacy implication that needs a decision

A "permalink" to your map is, by definition, viewable by anyone who has the
link, without them logging in. That means:

- It will expose **exact GPS coordinates** of everywhere you've photographed
  — including, very plausibly, your home, workplace, or a friend's address,
  since people often photograph those places too.
- **Decision needed from you**: should shared/public maps show exact
  coordinates, or snap to city/region-level precision for anyone who isn't
  the owner? The prompt below defaults to "owner sees exact pins, shared
  viewers see the same exact pins" (simplest to build) but flags this as a
  toggle you may want later (e.g. "fuzz radius for shared view").
- A share link should be **revocable** (regenerate/invalidate the token)
  since a link, once shared, can't be un-sent otherwise.

### 1.4 Storage/cost reality

Once logged in, original photos (or at least thumbnails) live on your
server's disk and rows in MySQL. Unlike guest mode, this has a real,
growing cost:

- Decide a **per-account storage quota** up front (e.g. 500 MB) so one user
  can't fill the disk.
- Store **resized/compressed copies** server-side by default (e.g. max
  2000px long edge) rather than pixel-perfect originals, unless you
  specifically want a "download original" feature — this cuts storage and
  bandwidth substantially with little visible quality loss on a map UI.
- Account deletion must actually free the disk space (delete the files, not
  just the DB rows).

### 1.5 Other technical notes carried over / added

- **HEIC photos** (default on iPhone): `exifr` can read metadata from them
  client-side, but generating a preview thumbnail needs either a JS HEIC
  decoder (`heic2any`, client-side) or, in account mode, server-side
  conversion via PHP's Imagick **only if** the server's ImageMagick build
  includes `libheif` — this is not guaranteed on shared hosting, so budget
  time to check or fall back to "upload succeeds, thumbnail shows a generic
  icon until converted."
- **Reverse geocoding** (lat/lon → "Rome, Italy") is now realistic to do
  *server-side*, since a PHP backend exists: proxy requests to Nominatim,
  cache results in a MySQL table keyed by rounded lat/lon, and respect
  Nominatim's usage policy (max 1 request/sec, custom `User-Agent`,
  attribution shown in the UI). Guest mode has no backend to proxy through,
  so it either skips place names or calls Nominatim directly from the
  browser at a very conservative rate.
- **Timeline heatmap**: there isn't an off-the-shelf widget that does
  exactly "continuous horizontal timeline scaled to the photo date range,
  with density heatmap and click-to-filter." Treat it as a custom
  component (canvas or SVG + a bit of D3 for scales/binning), not a drop-in
  library.
- **Delete a picture**: trivial in guest mode (remove from IndexedDB + the
  in-memory marker/cluster layer). In account mode it's a real DELETE API
  call with auth/ownership checks, then an optimistic UI removal.
- **Large folders**: EXIF parsing still belongs in a Web Worker regardless
  of mode, so the UI doesn't freeze; account-mode uploads should be
  batched/queued (e.g. a few concurrent uploads at a time) rather than
  fired all at once.

### 1.6 Overall verdict

Feasible, and a reasonable scope for a solo/small-team project, **as long as
it's built in phases**. Trying to build guest mode, full PHP/MySQL auth,
uploads, sharing, and the timeline heatmap all in one pass is the main risk
to the project succeeding — not any single piece of it. The prompt below is
structured in phases for that reason.

---

## 2. Open decisions still needed from you (flagged, not blocking the prompt)

The prompt below makes a reasonable default choice for each and calls it out
inline as `[DEFAULT — confirm or change]` so you can adjust before or during
build:

1. Shared-map precision: exact coordinates for everyone, or fuzzed for
   non-owners? *(defaulted to: exact for everyone)*
2. Per-account storage quota size. *(defaulted to: 500 MB)*
3. Store originals or resized copies server-side? *(defaulted to: resized,
   max 2000px long edge, quality 85)*
4. Is registration open to anyone, or invite-only for now? *(defaulted to:
   open registration, since there's no product reason yet to restrict it)*

---

## 3. The build prompt

> Build a web app called **"Photomap"** with two modes:
>
> - **Guest mode** (default, no login): fully client-side. Photos and their
>   extracted metadata never leave the browser. Data lives only in memory
>   and IndexedDB for the session/device.
> - **Account mode** (logged in): photos are uploaded to a custom backend
>   and persist across devices; the user can generate a shareable permalink
>   to their map and delete their account.
>
> Build this in **three phases**, in order, and get each working before
> starting the next:
>
> ### Phase 1 — Guest mode (frontend only, no backend)
>
> **Stack**: TypeScript + Vite (React is fine if you prefer it), `exifr` for
> EXIF/GPS/datetime parsing, Leaflet + OpenStreetMap tiles for the map,
> `Leaflet.markercluster` for clustering. No backend calls in this phase.
>
> **Layout** — a single page in three areas:
> 1. **Top banner**: "Photomap" logo/wordmark on the left. On the right,
>    placeholder username/password fields and a Login/Register control (wired
>    up in Phase 2 — in Phase 1 they can be present but non-functional or
>    hidden behind a "coming soon" state).
> 2. **Main area**: the map, filling the remaining space. Include a visible
>    "Upload photos" control (folder picker via
>    `<input type="file" webkitdirectory multiple>`, plus drag-and-drop of a
>    folder onto the map area) and a small status panel showing: number of
>    photos processed, number with usable GPS, number without GPS
>    (discarded from the map but not deleted from state), and a progress bar
>    while parsing.
> 3. **Bottom timeline strip**: a horizontal timeline spanning from the
>    earliest to the latest photo date (or the current year if nothing is
>    loaded yet). Render photo density as a heatmap-style bar along the
>    timeline (darker/taller where more photos were taken). Clicking a
>    segment filters the map to markers from that date range and opens a
>    thumbnail strip of the matching photos. Build this as a custom
>    canvas/SVG component — there is no drop-in library that does exactly
>    this.
>
> **Behavior**:
> 1. Parse EXIF for every image file in a **Web Worker** so the UI stays
>    responsive.
> 2. For files with GPS: group photos by rounded coordinates (~50m) into a
>    single marker. Marker popup shows a thumbnail strip of every photo at
>    that spot, sorted chronologically, each with its datetime.
> 3. For files without GPS: don't drop them — count them in the status
>    panel, and make them reachable/viewable from the timeline (so a user
>    can still see and manage them even with no location).
> 4. Clicking a thumbnail opens a full-size view with a semi-transparent
>    overlay banner showing the datetime and, if available, a human place
>    name rather than raw lat/long (Phase 1 has no backend to reverse-geocode
>    through, so either omit the place name or call a public geocoder
>    directly from the browser at a very conservative, throttled rate — do
>    not hammer a public API from every photo).
> 5. Both the thumbnail and the full-size view offer a **delete** action,
>    which removes the photo from IndexedDB/in-memory state and updates the
>    map/timeline immediately.
> 6. Fit the map bounds to the current markers whenever the photo set
>    changes.
> 7. Cache parsed results in IndexedDB so reopening the same folder doesn't
>    re-parse from scratch.
> 8. Show a persistent, explicit privacy note: **"Guest mode: your photos
>    never leave this device."**
>
> ### Phase 2 — Accounts backend (PHP + MySQL)
>
> **Stack**: PHP (8.x) with a minimal router (either a lightweight framework
> like Slim, or a small hand-rolled router — your call, but use PDO for all
> DB access), MySQL for users/photos/share-link metadata, server-side disk
> storage for uploaded images (outside the public web root).
>
> **Data model** (adjust names as needed, but cover these fields):
> - `users`: id, email (unique), password_hash, created_at
> - `photos`: id, user_id (FK), storage_path, thumbnail_path, lat, lon,
>   taken_at, camera_make, camera_model, created_at
> - `share_links`: id, user_id (FK), token (unique, random), created_at,
>   revoked_at (nullable)
> - `geocode_cache`: lat_rounded, lon_rounded, place_name, fetched_at
>   (populated by the server-side Nominatim proxy, see below)
>
> **Endpoints** (JSON API, session-cookie auth, CSRF token required on every
> state-changing call):
> - `POST /api/register` — email + password → create account
> - `POST /api/login` / `POST /api/logout`
> - `DELETE /api/account` — deletes the user row, all their photos rows,
>   all their share_links rows, **and** the actual files on disk
> - `GET /api/photos` — list the logged-in user's photos
> - `POST /api/photos` — upload one photo (multipart) + its extracted
>   metadata (client still runs `exifr` before upload and sends the parsed
>   lat/lon/datetime alongside the file, so the server doesn't need its own
>   EXIF parser); server validates the file content server-side (not by
>   extension), resizes it to max 2000px long edge at quality 85
>   `[DEFAULT — confirm or change]`, and stores both the resized image and a
>   small thumbnail
> - `DELETE /api/photos/{id}` — must verify the photo belongs to the
>   logged-in session's user before deleting; removes DB row and files
> - `POST /api/share-links` — create/rotate this user's share token
> - `DELETE /api/share-links/{id}` — revoke a share link
> - `GET /api/share/{token}` — **public**, no auth: returns the read-only
>   photo/marker data for that user's map (respect the revoked_at check)
> - `GET /api/geocode?lat=&lon=` — server-side proxy to Nominatim; checks
>   `geocode_cache` first, and if missing, calls Nominatim with a proper
>   `User-Agent` and a global rate limit of 1 req/sec across all users,
>   then caches the result
>
> **Security requirements** (non-negotiable, not polish):
> - Passwords hashed with `password_hash()` (bcrypt/argon2i); verified with
>   `password_verify()`.
> - All SQL via prepared statements (PDO), no string-concatenated queries.
> - Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`/`Strict`;
>   regenerate session ID on login.
> - CSRF token required on every POST/PUT/DELETE.
> - Rate-limit failed login attempts per account and per IP.
> - Uploaded files: validate real content type via `finfo` (not extension
>   or client-supplied MIME), enforce a max file size, store under
>   randomized filenames outside the web root, serve them through a PHP
>   endpoint that checks ownership (or a signed/expiring URL) rather than a
>   directly browsable directory.
> - Every `/api/photos/*` and `/api/account` call must confirm the resource
>   belongs to the authenticated session's user (no trusting a client-sent
>   user id).
> - Enforce a per-account storage quota (e.g. 500 MB
>   `[DEFAULT — confirm or change]`); reject uploads past it with a clear
>   error the frontend surfaces in the status panel.
>
> ### Phase 3 — Wire the frontend to accounts + remaining features
>
> - Top banner becomes functional: real login/register forms, and once
>   logged in, replace them with the account's email, a **"copy share
>   link"** button (calls `POST /api/share-links`, copies the resulting URL),
>   and a **"delete account"** button (confirms, then calls
>   `DELETE /api/account` and logs the user out).
> - When logged in, uploads go through `POST /api/photos` instead of only
>   local IndexedDB, and the map/timeline load from `GET /api/photos`
>   instead of local parsing results. **Before the first upload while
>   logged in, show an explicit, unmissable notice**: "You're logged in —
>   uploaded photos are stored on the server so you can access them from
>   other devices and share them." This must be clearly distinct from the
>   guest-mode privacy note.
> - Opening `/share/{token}` (a public route, no login) renders a read-only
>   version of that map/timeline via `GET /api/share/{token}` — no upload
>   button, no delete buttons, no login form needed to view it.
> - Add remaining "core" features from the original spec, now that both
>   modes exist:
>   - Filter/search by date range, camera make/model, has-location vs not.
>   - Drag-to-reassign a marker's location for GPS-less photos (updates
>     IndexedDB in guest mode, calls the update endpoint in account mode —
>     add a `PATCH /api/photos/{id}` if you take this on).
> - Add remaining "nice to have" features as time allows, after the above is
>   solid:
>   - Trip auto-grouping (gap of >2 days **and** >100km starts a new trip),
>     with each trip's markers colored distinctly.
>   - Route lines connecting photos taken within a 3-day window, in
>     chronological order.
>   - GeoJSON/KML export of the current marker set.
>   - Heatmap-density map mode as an alternative to discrete pins.
>
> **Explicitly not needed in this build**: multi-user collaboration on one
> account, photo editing, mobile native apps, payment/billing, admin
> dashboard. Keep everything as a single frontend project
> (`npm install && npm run dev`) plus a single PHP backend project runnable
> locally (e.g. `php -S localhost:8000`) against a local MySQL instance,
> with a short README describing how to run both together (including any
> CORS/dev-proxy config needed between the Vite dev server and the PHP API).
