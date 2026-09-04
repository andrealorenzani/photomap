# Photomap — Original Prompts

The original, verbatim user requests that drove each change are appended here, most recent last.

---

## 2026-09-03 — Phase 1: Guest mode (frontend-only) initial build

PROMPT 1 (the initiating request, given to the coordinator):

This is a brand-new project. The repo currently contains only doc scaffolding (docs/product.md, docs/architecture.md, docs/code.md, docs/plans.md, docs/original_prompts.md — all placeholders saying nothing is built yet) and two reference markdown files (first_research.md, photomap_prompt.md) with background research — no application code exists yet.

The overall product being built is "Photomap", requested by the user in three phases, to be built and verified working one phase at a time. This invocation is for Phase 1 only — do not implement Phase 2 or Phase 3 work; those will be separate future changes once Phase 1 is confirmed working. Treat this as the initial project setup plus Phase 1 feature build.

Here is the full original user request for context (so the product/architecture briefings understand where this is headed), followed by the exact scope for this change (Phase 1):

---
FULL ORIGINAL REQUEST (all three phases, for context only):

Build a web app called "Photomap" with two modes:

- Guest mode (default, no login): fully client-side. Photos and their extracted metadata never leave the browser. Data lives only in memory and IndexedDB for the session/device.
- Account mode (logged in): photos are uploaded to a custom backend and persist across devices; the user can generate a shareable permalink to their map and delete their account.

Build this in three phases, in order, and get each working before starting the next.

[Phase 1 — see "SCOPE FOR THIS CHANGE" below, identical text]

Phase 2 — Accounts backend (PHP + MySQL): PHP (8.x) with a minimal router (Slim or a small hand-rolled router — implementer's call, but use PDO for all DB access), MySQL for users/photos/share-link metadata, server-side disk storage for uploaded images outside the public web root.
Data model: users(id, email unique, password_hash, created_at); photos(id, user_id FK, storage_path, thumbnail_path, lat, lon, taken_at, camera_make, camera_model, created_at); share_links(id, user_id FK, token unique random, created_at, revoked_at nullable); geocode_cache(lat_rounded, lon_rounded, place_name, fetched_at).
Endpoints (JSON API, session-cookie auth, CSRF token required on every state-changing call): POST /api/register (email+password), POST /api/login, POST /api/logout, DELETE /api/account (deletes user row, all photos rows, all share_links rows, and actual files on disk), GET /api/photos (list logged-in user's photos), POST /api/photos (upload one photo multipart + parsed metadata from client-side exifr; server validates file content server-side via finfo not extension, resizes to max 2000px long edge quality 85, stores resized image + thumbnail), DELETE /api/photos/{id} (must verify ownership), POST /api/share-links (create/rotate token), DELETE /api/share-links/{id} (revoke), GET /api/share/{token} (public, no auth, read-only marker data, respects revoked_at), GET /api/geocode?lat=&lon= (server-side Nominatim proxy, checks geocode_cache first, global rate limit 1 req/sec across all users, proper User-Agent, caches result).
Security requirements (non-negotiable): passwords via password_hash()/password_verify() (bcrypt/argon2i); all SQL via PDO prepared statements, no string concatenation; session cookies HttpOnly, Secure, SameSite=Lax/Strict, regenerate session ID on login; CSRF token required on every POST/PUT/DELETE; rate-limit failed logins per account and per IP; uploaded files validated by real content-type via finfo (not extension/client MIME), max file size enforced, stored under randomized filenames outside the web root, served through a PHP endpoint that checks ownership (or signed/expiring URL) rather than a directly browsable directory; every /api/photos/* and /api/account call must confirm the resource belongs to the authenticated session's user (never trust a client-sent user id); per-account storage quota of 100 MB enforced server-side, rejecting uploads past it with a clear error the frontend surfaces in the status panel; frontend resizes photos to 1920px long side, quality 80, before sending, as a first line of size reduction (server still re-validates/re-resizes to 2000px/85 as the authoritative limit).

Phase 3 — Wire the frontend to accounts + remaining features: Top banner becomes functional: real login/register forms, and once logged in, replace them with the account's email, a "copy share link" button (calls POST /api/share-links, copies the resulting URL), and a "delete account" button (confirms, then calls DELETE /api/account and logs the user out). When logged in, uploads go through POST /api/photos instead of only local IndexedDB, and the map/timeline load from GET /api/photos instead of local parsing results. Before the first upload while logged in, show an explicit, unmissable notice: "You're logged in — uploaded photos are stored on the server so you can access them from other devices and share them." This must be clearly distinct from the guest-mode privacy note. Opening /share/{token} (a public route, no login) renders a read-only version of that map/timeline via GET /api/share/{token} — no upload button, no delete buttons, no login form needed to view it. Add remaining "core" features: filter/search by date range, camera make/model, has-location vs not; drag-to-reassign a marker's location for GPS-less photos (updates IndexedDB in guest mode, calls a PATCH /api/photos/{id} endpoint in account mode). Add remaining "nice to have" features as time allows, after the above is solid: trip auto-grouping (gap of >2 days AND >100km starts a new trip, each trip's markers colored distinctly); route lines connecting photos taken within a 3-day window in chronological order; GeoJSON/KML export of the current marker set; heatmap-density map mode as an alternative to discrete pins.

Explicitly not needed in this build: multi-user collaboration on one account, photo editing, mobile native apps, payment/billing, admin dashboard. Keep everything as a single frontend project (npm install && npm run dev) plus a single PHP backend project runnable locally (e.g. php -S localhost:8000) against a local MySQL instance, with a short README describing how to run both together (including any CORS/dev-proxy config needed between the Vite dev server and the PHP API).

---
SCOPE FOR THIS CHANGE (Phase 1 — implement only this now):

Phase 1 — Guest mode (frontend only, no backend)

Stack: TypeScript + Vite (React is fine if you prefer it), exifr for EXIF/GPS/datetime parsing, Leaflet + OpenStreetMap tiles for the map, Leaflet.markercluster for clustering. No backend calls in this phase.

Layout — a single page in three areas:
1. Top banner: "Photomap" logo/wordmark on the left. On the right, placeholder username/password fields and a Login/Register control (wired up in Phase 2 — in Phase 1 they can be present but non-functional or hidden behind a "coming soon" state).
2. Main area: the map, filling the remaining space. Include a visible "Upload photos" control (folder picker via <input type="file" webkitdirectory multiple>, plus drag-and-drop of a folder onto the map area) and a small status panel showing: number of photos processed, number with usable GPS, number without GPS (discarded from the map but not deleted from state), and a progress bar while parsing.
3. Bottom timeline strip: a horizontal timeline spanning from the earliest to the latest photo date (or the current year if nothing is loaded yet). Render photo density as a heatmap-style bar along the timeline (darker/taller where more photos were taken). Clicking a segment filters the map to markers from that date range and opens a thumbnail strip of the matching photos. Build this as a custom canvas/SVG component — there is no drop-in library that does exactly this.

Behavior:
1. Parse EXIF for every image file in a Web Worker so the UI stays responsive.
2. For files with GPS: group photos by rounded coordinates (~50m) into a single marker. Marker popup shows a thumbnail strip of every photo at that spot, sorted chronologically, each with its datetime.
3. For files without GPS: don't drop them — count them in the status panel, and make them reachable/viewable from the timeline (so a user can still see and manage them even with no location).
4. Clicking a thumbnail opens a full-size view with a semi-transparent overlay banner showing the datetime and, if available, a human place name rather than raw lat/long (Phase 1 has no backend to reverse-geocode through, so either omit the place name or call a public geocoder directly from the browser at a very conservative, throttled rate — do not hammer a public API from every photo).
5. Both the thumbnail and the full-size view offer a delete action, which removes the photo from IndexedDB/in-memory state and updates the map/timeline immediately.
6. Fit the map bounds to the current markers whenever the photo set changes.
7. Cache parsed results in IndexedDB so reopening the same folder doesn't re-parse from scratch.
8. Show a persistent, explicit privacy note: "Guest mode: your photos never leave this device."

Deliverable: a single frontend project runnable via `npm install && npm run dev`, with a short README section on how to run it.

Explicitly not needed in this build: multi-user collaboration on one account, photo editing, mobile native apps, payment/billing, admin dashboard. Keep everything as a single frontend project (npm install && npm run dev) plus a single PHP backend project runnable locally (e.g. php -S localhost:8000) against a local MySQL instance, with a short README describing how to run both together (including any CORS/dev-proxy config needed between the Vite dev server and the PHP API).

No clarifying questions were asked back to the user during planning — every open question raised by the product-owner, architect, developer, and tester briefings, plus the advisor's review, was resolvable from facts already established in the request itself or the mandated tech stack (e.g. geocoding was explicitly framed as either/or in the request; the "zero network calls" wording was corrected to properly scope around the mandated Leaflet+OpenStreetMap tile stack). See the Deep Dives section of the plan below for the full record of every question and its resolution.

---

## 2026-09-04 — Phase 2: Accounts backend (PHP + MySQL) build

Photomap Phase 1 (guest mode, frontend-only) is already built, tested, and documented in this repo — see docs/product.md, docs/architecture.md, docs/code.md for its current state. This invocation is for **Phase 2 only**: build the standalone PHP + MySQL accounts backend. Do NOT touch the Phase 1 frontend code and do NOT wire the frontend to this backend yet — that is Phase 3, a separate future change. This phase's deliverable is a backend project that exists and works on its own (testable via curl/Postman or a PHP test suite), runnable locally via `php -S localhost:8000` against a local MySQL instance, with no frontend integration yet.

Here is the full original user request for context (all three phases, for context only), followed by the exact scope for this change (Phase 2):

---
FULL ORIGINAL REQUEST (all three phases, for context only):

Build a web app called "Photomap" with two modes:
- Guest mode (default, no login): fully client-side. Photos and their extracted metadata never leave the browser. Data lives only in memory and IndexedDB for the session/device. [DONE — Phase 1]
- Account mode (logged in): photos are uploaded to a custom backend and persist across devices; the user can generate a shareable permalink to their map and delete their account.

Build this in three phases, in order, and get each working before starting the next.

Phase 1 — Guest mode (frontend only, no backend). DONE — see docs/product.md, docs/architecture.md, docs/code.md, docs/plans.md for what was built.

Phase 2 — see "SCOPE FOR THIS CHANGE" below, identical text.

Phase 3 — Wire the frontend to accounts + remaining features: Top banner becomes functional: real login/register forms, and once logged in, replace them with the account's email, a "copy share link" button (calls POST /api/share-links, copies the resulting URL), and a "delete account" button (confirms, then calls DELETE /api/account and logs the user out). When logged in, uploads go through POST /api/photos instead of only local IndexedDB, and the map/timeline load from GET /api/photos instead of local parsing results. Before the first upload while logged in, show an explicit, unmissable notice: "You're logged in — uploaded photos are stored on the server so you can access them from other devices and share them." This must be clearly distinct from the guest-mode privacy note. Opening /share/{token} (a public route, no login) renders a read-only version of that map/timeline via GET /api/share/{token} — no upload button, no delete buttons, no login form needed to view it. Add remaining "core" features: filter/search by date range, camera make/model, has-location vs not; drag-to-reassign a marker's location for GPS-less photos (updates IndexedDB in guest mode, calls a PATCH /api/photos/{id} endpoint in account mode — add this endpoint in Phase 3 if taken on, it's not required in Phase 2). Add remaining "nice to have" features as time allows: trip auto-grouping, route lines, GeoJSON/KML export, heatmap-density map mode.

Explicitly not needed in this build: multi-user collaboration on one account, photo editing, mobile native apps, payment/billing, admin dashboard. Keep everything as a single frontend project (npm install && npm run dev) plus a single PHP backend project runnable locally (e.g. php -S localhost:8000) against a local MySQL instance, with a short README describing how to run both together (including any CORS/dev-proxy config needed between the Vite dev server and the PHP API) — that combined README update happens once Phase 3 wires them together; for this change, just document how to run the PHP backend on its own.

---
SCOPE FOR THIS CHANGE (Phase 2 — implement only this now):

Phase 2 — Accounts backend (PHP + MySQL)

Stack: PHP (8.x) with a minimal router (either a lightweight framework like Slim, or a small hand-rolled router — your call, but use PDO for all DB access), MySQL for users/photos/share-link metadata, server-side disk storage for uploaded images (outside the public web root).

Data model (adjust names as needed, but cover these fields):
- users: id, email (unique), password_hash, created_at
- photos: id, user_id (FK), storage_path, thumbnail_path, lat, lon, taken_at, camera_make, camera_model, created_at
- share_links: id, user_id (FK), token (unique, random), created_at, revoked_at (nullable)
- geocode_cache: lat_rounded, lon_rounded, place_name, fetched_at (populated by the server-side Nominatim proxy, see below)

Endpoints (JSON API, session-cookie auth, CSRF token required on every state-changing call):
- POST /api/register — email + password → create account
- POST /api/login / POST /api/logout
- DELETE /api/account — deletes the user row, all their photos rows, all their share_links rows, and the actual files on disk
- GET /api/photos — list the logged-in user's photos
- POST /api/photos — upload one photo (multipart) + its extracted metadata (client already ran exifr before upload and sends the parsed lat/lon/datetime alongside the file — for this phase's own testing, just send arbitrary lat/lon/datetime form fields alongside the file, since there's no live frontend integration yet); server validates the file content server-side (not by extension, use finfo), resizes it to max 2000px long edge at quality 85, and stores both the resized image and a small thumbnail
- DELETE /api/photos/{id} — must verify the photo belongs to the logged-in session's user before deleting; removes DB row and files
- POST /api/share-links — create/rotate this user's share token
- DELETE /api/share-links/{id} — revoke a share link
- GET /api/share/{token} — public, no auth: returns the read-only photo/marker data for that user's map (respect the revoked_at check)
- GET /api/geocode?lat=&lon= — server-side proxy to Nominatim; checks geocode_cache first, and if missing, calls Nominatim with a proper User-Agent and a global rate limit of 1 req/sec across all users, then caches the result

Security requirements (non-negotiable, not polish):
- Passwords hashed with password_hash() (bcrypt/argon2i); verified with password_verify().
- All SQL via prepared statements (PDO), no string-concatenated queries.
- Session cookies: HttpOnly, Secure, SameSite=Lax/Strict; regenerate session ID on login.
- CSRF token required on every POST/PUT/DELETE.
- Rate-limit failed login attempts per account and per IP.
- Uploaded files: validate real content type via finfo (not extension or client-supplied MIME), enforce a max file size, store under randomized filenames outside the web root, serve them through a PHP endpoint that checks ownership (or a signed/expiring URL) rather than a directly browsable directory.
- Every /api/photos/* and /api/account call must confirm the resource belongs to the authenticated session's user (no trusting a client-sent user id).
- Enforce a per-account storage quota (100 MB); reject uploads past it with a clear error (JSON error response body, since there's no frontend yet to surface it visually — that wiring is Phase 3). Note: the *frontend* will resize photos to 1920px long side / quality 80 before sending in Phase 3 — that's a Phase 3 frontend concern, not part of this backend change, but keep it in mind as context for why the server's own 2000px/85 resize is the authoritative limit, not the only one.

Deliverable: a single PHP backend project runnable via `php -S localhost:8000` (or documented equivalent) against a local MySQL instance, with a short README section (or standalone README) on how to run it standalone, including DB setup/migration instructions. Follow the fixed coordinator process in full (briefings → plan → resolve questions → advisor review → implement → document). Since this phase has no frontend to test against yet, the tester's plan should lean on PHP-level tests and/or a documented curl-based manual test script covering the auth flow, ownership checks, CSRF enforcement, and quota enforcement.
