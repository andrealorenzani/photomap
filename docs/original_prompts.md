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

---

## 2026-09-04 — Phase 3: Account wiring, deployment/operability, and treasure-map style

Run a full coordinator pass (product-owner, architect, developer, tester briefings -> composed plan -> advisor sanity check -> resolve open questions yourself wherever you reasonably can, per your normal process -> implementer -> documenter) for the following change to the Photomap project at /home/andrea/workspace/photomap.

Read docs/product.md, docs/architecture.md, docs/code.md, docs/plans.md, docs/original_prompts.md, and photomap_prompt.md first — Phase 1 (frontend guest mode, Vite+React+TS at repo root) and Phase 2 (PHP+MySQL backend at backend/) are already implemented and documented there. This change is Phase 3 plus some additional cross-cutting requirements the user (the project owner) just gave directly. Treat all of the below as one coherent change request — these areas overlap (frontend build, Docker, README, map rendering) so they should be planned and implemented together, not as separate passes.

## 1. Phase 3 scope (from photomap_prompt.md, section "### Phase 3 — Wire the frontend to accounts + remaining features")

Implement it as written there: functional login/register in the top banner, replaced by account email + "copy share link" + "delete account" once logged in; uploads and photo listing go through the account-mode API when logged in instead of local IndexedDB, with the specified notice before first upload while logged in; a public read-only `/share/{token}` route with no upload/delete/login affordances; filter/search by date range, camera make/model, has-location vs not; drag-to-reassign a marker's location for GPS-less photos (this needs a new `PATCH /api/photos/{id}` backend endpoint — Phase 2's plan explicitly deferred this to Phase 3, so add it now, following the same auth/ownership/CSRF conventions as the other photo endpoints). Nice-to-haves (trip auto-grouping, route lines, GeoJSON/KML export, heatmap-density mode) are lower priority — include them if time/complexity allows after the above is solid, but they are not required for sign-off.

## 2. Deployment/operability requirements (the user was explicit about these; treat as hard requirements for this phase, not optional polish)

a. **Static, Node-free production deploy for the frontend.** The user said: "I saw you running node, I don't want to run a server, I want the fe to be deployable and the backend to be in php." Node/npm must remain build-time-only tooling (as it already is via `npm run build` -> `dist/`). Make explicit and verify: the production artifact is static files (HTML/CSS/JS) deployable to any plain PHP+MySQL host (e.g. shared hosting) with zero Node.js process running in production. The backend is already PHP+MySQL — keep it that way. Make the API base URL a build-time-configurable value (e.g. a Vite env var), not hardcoded, so the same static build can be pointed at different backend deployments without a rebuild if reasonably achievable, or documented clearly as build-time-configurable if not.

b. **Docker for local use.** There is currently only a dev/test-convenience docker-compose for the backend alone (backend/docker-compose.yml). Add (or extend) a docker-compose setup that runs the *whole stack* locally with one command: MySQL + PHP backend + the built frontend served statically (e.g. via nginx, or another lightweight static server / the PHP built-in server), wired together so opening one local URL gives a fully working app. Document this clearly as the "run it locally without installing anything but Docker" path, distinct from the plain-PHP/native-MySQL deploy path.

c. **Every setting customizable.** Audit and ensure all meaningful configuration is externalized (env vars / config files), not hardcoded: backend already does this well via .env (DB creds, storage paths, quotas, rate limits, Nominatim settings, etc — keep and extend this pattern for anything new like the PATCH endpoint or map-tile settings below). Frontend needs equivalent treatment for anything environment-specific (API base URL, map tile/style settings — see part 3). Document every setting in one place (README).

d. **Private photo storage.** Already implemented in Phase 2 (files live under backend/storage/, outside public/, served only via signed/expiring URLs with ownership checks). Confirm this remains true after Phase 3's changes (no regression), and make sure the README states this explicitly as a security/privacy property, not just an implementation detail.

e. **Detailed README.** Consolidate into a single, thorough root README (backend/README.md can stay as a lower-level reference but the root README should be the main entry point): what Photomap is and its two modes, how to run in dev (frontend + backend + MySQL), how to deploy to a plain PHP+MySQL host in production, how to run everything locally via Docker, a complete list of environment variables/settings for both frontend and backend and what each does, the private-storage/signed-URL security property, the existing privacy notes from Phase 1/2, and known limitations.

## 3. New feature: alternate "treasure map" basemap style (this is core Phase 3 scope, not a nice-to-have)

The user wants a second map look, in their words: "I understand that the openmap is the easiest choice, but I would love to have the possibility to have also a less fine grained map but with a better look, like a treasure map — this must still represent the world map, coordinates still must make sense, but they will work without all the expected details."

I (the orchestrating session) already researched viable approaches and made a decision so you don't need to re-litigate it or ask the user: [Esri no-key tile services deprecated, no free/no-key antique-tile provider exists, custom tile generation is high licensing/effort risk. Locked-in default: a map-style toggle switching the same OSM tile layer between "Detailed" (today's unchanged behavior, full OSM zoom range) and "Treasure Map" (caps max zoom well below street/POI-level detail, applies a CSS visual treatment — sepia/saturate/hue-rotate/contrast, optionally a vignette — so it reads as stylized/antique while remaining a recognizable world map; coordinates line up identically in both modes since it's the same tile source/projection, just different rendering). Exact zoom cutoff, CSS filter recipe, and tile source/attribution for both modes must be config-driven, not hardcoded. Default is Detailed, Treasure Map is opt-in, implementer's call on exact zoom number and CSS recipe fitting the existing UI.]

## 4. Git remote
I already ran `git remote add origin git@github.com:andrealorenzani/photomap.git` locally in the main session (not pushed). Do not push to it yourself — that's for the user to do explicitly later. No action needed from you here beyond being aware the remote exists.

## Process notes
- This is a big combined change spanning frontend, backend, and deploy tooling — plan it as one coherent plan per your normal process, with the usual product-owner/architect/developer/tester briefings feeding into it.
- Resolve open/ambiguous questions yourself wherever you can find a reasonable, well-grounded answer (as you did for the ~27 open questions in the Phase 2 plan) — only use AskUserQuestion for something genuinely blocking that needs the project owner's judgment and that you cannot reasonably infer from the above brief, the existing docs, or the original photomap_prompt.md.
- After implementation, run the full test suites (frontend `npm test`, backend PHPUnit) and report results.
- Update docs/plans.md, docs/architecture.md, docs/code.md, docs/product.md, docs/original_prompts.md per your normal documenter step at the end.

Report back a summary of what was built, any decisions you made along the way, current test status, and anything still open or deferred.

No clarifying questions were asked back to the project owner during planning — every open question raised by the product-owner, architect, developer, and tester briefings, plus the advisor's review (which flagged two substantive gaps: photo-id reconciliation between client and server, and a dead EXIF-orientation backend feature — both fixed, not just documented), was resolved by the coordinator from facts already established in the request itself, the existing docs, or straightforward engineering judgment within the phase's stated scope. See the Deep Dives section of the plan in `docs/plans.md` for the full record of every question and its resolution.

---

## 2026-09-05 — Dreamhost / shared-hosting deployment support

"Use the coordinator to change everything so that I can easily deploy this on a cloud host. In particular I use dreamhost, therefore I want just to upload the files into the right directory and write a config.php file for the database location and everything should work."

No clarifying questions were asked back to the user during planning — all open questions were resolved internally from the four domain briefings plus an advisor pass. See the "Deep Dives" section of the corresponding plan in `docs/plans.md` for the full record of every question and its resolution.

---

## 2026-09-06 — Registration approval, admin console, GPS-required uploads, and calendar heatmap timeline (v1.0.0)

Yesterday you (a coordinator agent instance) ran Photomap release v1.0.0 end to end: you gathered product-owner/architect/developer/tester briefings, composed a plan, had the advisor sanity-check it (one revision cycle fixed a privacy leak in admin share-link visibility, admin session hardening, and boot-time config-absence handling), and started the implementer. The implementer got partway through (migrations applied, backend controllers/services/tests written) and was about to run the backend test suite when the session hit its rate limit and both the implementer and the coordinator process were killed. The original plan file in scratchpad is gone (that temp directory was session-scoped and has been cleaned up), so you must reconstruct current state directly from the working tree rather than assuming anything.

Your job now: audit what's actually been implemented, finish whatever remains (backend and frontend), make sure tests pass, then run the documenter. Do not restart planning from scratch or re-run the product-owner/architect/developer/tester/advisor briefings — the plan is finalized; treat this as resuming implementation, not redesigning.

The finalized plan (from yesterday's advised version) covers these v1.0.0 changes:

1. Registration no longer grants immediate upload access — new accounts require admin approval before uploads work. Existing pre-1.0.0 users are grandfathered to active/approved status.
2. New secret admin page at `/admin`, protected by a unique username/password whose credential is stored as a `password_hash()` hash (NOT reversible encryption) in the config file — this was the deliberate, correct choice since it's a login credential. Clear step-by-step instructions for generating that hash must exist in docs/README (check if already written).
   a. Admin can activate a user and set their storage quota, see an existence/timestamp indicator of whether the user has an active share link (deliberately NOT the actual shareable URL/token itself — showing the real link would hand the admin de facto access to view that user's private shared photos, which the advisor flagged as a privacy leak; this was corrected during yesterday's revision, so verify the current code does NOT expose the raw share URL to admins), and can disable a user's account.
   b. New registration sends an email to a configurable admin address prompting review/activation.
   c. Admin user list is searchable, filterable, and sortable by registration date.
   d. Admin general settings page: default storage quota for new users, global upload enable/disable toggle, and stats (user count, photos uploaded count, etc).
3. A registration-time popup stating: activation requires admin approval before uploads work; accurate (not overstated) language about photo visibility — the original user request said "publicly visible on the internet" but yesterday's briefings flagged that as misleading given the app's actual private-by-default + revocable share-link architecture, so the resolved wording says photos are private by default with no public listing/search, shared only via a link the user controls; the user must supply a notification email (for activation/deactivation notices). The popup also clarifies Guest Mode uploads nothing and therefore can't be shared with friends.
4. Activation sends an email to the registered user.
5. GPS-less photo uploads are discarded (not uploaded) for logged-in/account-mode users only — guest mode behavior is unchanged. The "Without GPS" UI section/label becomes "Discarded (No GPS)".
6. Timeline UI overhaul: replace the current timeline with a calendar-axis (year/month/day) view combined with a heatmap of photo density over time.

In addition, resolve two implementation-detail ambiguities that were settled by reading the existing codebase rather than by asking the user (recorded above in the plan's Deep Dives): the "notification email" mentioned in item 3 reuses the existing account email rather than adding a new field (no schema column exists for a separate one), and the timeline overhaul in item 6 was implemented by evolving the existing density-heatmap timeline component with an added calendar-axis drill-down layer, rather than rebuilding it from scratch.

Please update all docs to reflect the completed v1.0.0 state now that implementation and independent verification are both done.
