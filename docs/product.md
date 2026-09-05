# Photomap — Product

## What it is
Photomap is a web app for browsing your own photo collection on a map and a timeline, using the
GPS coordinates and datetimes embedded in each photo's EXIF metadata. Drop a folder of photos in
and immediately see *where* and *when* they were taken, with the map and timeline kept in sync:
filtering the timeline narrows the map, and photos without location data are never dropped —
they stay reachable through the timeline even though they can't appear as a map marker.

Photomap has two modes, both fully implemented and wired together as of Phase 3:

- **Guest mode** (default, no account): fully client-side. Photo bytes, EXIF metadata,
  filenames, and GPS coordinates never leave the browser — they live only in memory and
  IndexedDB for that device/session. A persistent privacy note ("Guest mode: your photos never
  leave this device.") is always visible while not logged in. The one disclosed exception to
  "zero network calls involving photo data" is the OpenStreetMap basemap tile requests inherent
  to any online slippy map — those carry only generic tile x/y/z indices for the visible area,
  never photo data.
- **Account mode** (logged in): a PHP + MySQL backend stores your photos server-side (outside
  its web root, served only via short-lived signed URLs) so your library is available from any
  device, and you can generate a single active read-only share link for someone else to view.
  Logging in switches uploads and photo listing from local IndexedDB to the backend API; a
  persistent "your uploaded photos are stored on the server" notice is visible for the entire
  duration of an authenticated session, distinct from the guest-mode privacy note.

Both modes share the same map/timeline UI, the same filter/search and drag-to-reassign
features, and the same choice of two basemap styles (Detailed / Treasure Map — see below). A
public `/share/{token}` route lets a link recipient view a read-only version of an account's map
with no login and no upload/delete affordances.

## Guest mode, as it works today

- **Uploading photos**: pick a folder via a folder-picker control, or drag-and-drop a folder
  directly onto the map area. Every image file found is parsed for EXIF metadata (GPS,
  datetime, camera make/model) in the background, so the page stays responsive while a large
  folder is processed. A status panel shows live counts of photos processed, photos with usable
  GPS, and photos without usable GPS, plus a progress indicator while parsing is in flight.
- **Map**: photos with usable GPS are grouped into one marker per real-world location (~50m
  radius); a marker's popup shows every photo taken at that spot, in chronological order, each
  labeled with its datetime. Markers cluster visually as you zoom out. The map view
  automatically fits to whatever markers are currently showing whenever the photo set or
  timeline filter changes. Existing markers can be dragged to a new spot, and GPS-less photos
  can be dragged onto the map from a dedicated panel to give them a location for the first time
  (see "Filter/search and drag-to-reassign" below).
- **Photos without GPS**: never discarded. They're counted in the status panel and remain
  reachable and viewable through the timeline, just not shown as map markers (unless/until
  dragged onto the map to assign them a location).
- **Timeline**: a bottom strip spanning from the earliest to latest photo date (or the current
  year if nothing is loaded), rendered as a density heatmap — darker/taller where more photos
  exist for that period. Clicking a segment filters the map to that date range and opens a
  thumbnail strip of the matching photos (including ones without GPS).
- **Viewing a photo**: clicking a thumbnail opens a full-size view with a semi-transparent
  overlay banner showing the photo's datetime. There is deliberately no reverse-geocoded place
  name and no raw latitude/longitude shown in guest mode — just the datetime (reverse geocoding
  exists only as a server-side capability in the backend, not yet surfaced anywhere in the UI).
- **Deleting a photo**: available from both the thumbnail strip and the full-size view. Deleting
  removes the photo from IndexedDB and in-memory state immediately, and the map/timeline update
  right away. There's no "undo" or tombstone — if the same folder is reopened later, a
  previously-deleted file is treated as new and reappears (there's no folder-level identity to
  track exclusions against in guest mode).
- **Returning to a previously-opened folder**: recognized per file (not per folder as a whole),
  so files that haven't changed since they were last processed load from the IndexedDB cache
  instead of being re-parsed, making a repeat open of the same folder noticeably faster.
- **HEIC/HEIF photos** (common on iPhones): their GPS/datetime metadata is used fully, but the
  thumbnail/preview image itself falls back to a generic placeholder icon on browsers that can't
  decode HEIC client-side (only Safari reliably can, as of this writing).
- **Full-resolution originals are never kept**: only a small thumbnail and a resized preview
  (not the original file bytes) are stored, to keep storage usage bounded for large personal
  libraries. This means the full-size view is not pixel-perfect against your original file.
  Thumbnails/previews are now generated with EXIF-orientation correction applied, so
  portrait/rotated photos display right-side-up (see "Account mode" below for why this mattered
  enough to fix now).

## Account mode, as it works today

Logging in (or registering) replaces the top banner's placeholder fields with a real
login/register form, then — once authenticated — with your account email, a "copy share link"
button, and a "delete account" button. The map/timeline UI, filters, drag-to-reassign, and
basemap style toggle all behave the same as in guest mode; the only difference is where photo
data lives and comes from.

- **Registration and login**: email + password accounts, hashed server-side, a server-side
  session (not a token the frontend manages), and CSRF protection on every state-changing
  request.
- **Uploading photos to the server**: once logged in, the folder-picker/drag-and-drop upload flow
  sends each photo (plus its client-parsed GPS/datetime/camera metadata) to the backend instead
  of IndexedDB; the server independently validates and re-processes the image (resized to a max
  2000px long edge, plus a thumbnail) rather than trusting the client's copy.
- **A persistent "stored on the server" notice**: visible for the entire duration of an
  authenticated session, from before the very first upload, distinct from and mutually exclusive
  with the guest-mode privacy note.
- **Cross-device access**: an account's photos live in the backend rather than one browser's
  IndexedDB, so the same account shows the same photos from any device.
- **Deleting an uploaded photo**: removes both its database record and its files on disk, and
  only the account that owns a photo can delete it.
- **Drag-to-reassign a photo's location**: works in account mode too, via
  `PATCH /api/photos/{id}` — dragging an existing marker or dropping a GPS-less photo onto the
  map updates its stored coordinates on the server, following the same ownership rules as every
  other photo endpoint.
- **Filter/search**: by date range, camera make/model, and has-location vs. not — client-side,
  filtering the already-fetched list, in both modes.
- **Sharing a read-only map**: an account holder can generate a single active share link (a
  random token, via the "copy share link" button); anyone with that link's URL can view a
  read-only version of that account's map data at `/share/{token}` with no login, no upload
  button, and no delete buttons. Filters and the Detailed/Treasure Map style toggle remain
  available to a share viewer (both are non-mutating). The link can be revoked at any time,
  immediately cutting off access, including to already-open image URLs from that link.
- **Deleting an account**: erases the account's row, all of its photo records, all of its share
  links, and the actual photo/thumbnail files on disk, then logs the current session out and
  reverts the app to guest mode. This does not reach into other devices' sessions for the same
  account still logged in elsewhere — see `docs/architecture.md` for that documented limitation.
- **Reverse geocoding**: a server-side proxy to OpenStreetMap's Nominatim service exists
  (`GET /api/geocode`, cached, rate-limited), but is still not surfaced anywhere in the UI — the
  full-size photo view shows only a datetime in both modes. Left as a future enhancement.
- **Storage quota**: each account is capped at 100 MB of actual stored photo/thumbnail bytes;
  an upload past that limit is rejected with a distinct `413 quota_exceeded` error, surfaced to
  the user rather than silently swallowed.
- **No guest-to-account migration**: logging in does not upload your existing guest-mode
  IndexedDB photos, and logging out does not clear them — guest and account data are two
  separate namespaces with no migration between them in this version. This is a deliberate
  scope decision, not an oversight (see "Not yet built" below).

## Basemap style: Detailed vs. Treasure Map

Both modes, and the public share view, offer a small on-map control to switch between two
basemap looks, backed by the same OpenStreetMap tile source in both cases — a photo pin lands in
the identical place regardless of which style is active, since only rendering and available zoom
range differ:

- **Detailed** (the default): today's unchanged full-detail OpenStreetMap rendering, full zoom
  range.
- **Treasure Map** (opt-in): the same tiles under a stylized CSS filter (sepia/saturation/
  hue-rotate/contrast plus a subtle vignette) with a hard, lower maximum zoom, so it reads as a
  stylized, "less fine-grained" map rather than a street-level one. Because the zoom cap is hard,
  a dense marker cluster in Treasure Map mode can't be zoomed in far enough to visually separate
  the way Detailed mode allows — this is an inherent consequence of the feature as specified, not
  a bug.

The chosen style persists per-browser (`localStorage`) only; it does not sync across devices for
an account, unlike photo data itself.

## Deployment and privacy, at a glance

- The frontend builds to a **static-only** artifact (`npm run build` → `dist/`, plus a runtime
  `config.js`) deployable to any static host or plain PHP+MySQL host, with **zero Node.js
  process running in production**. The backend is a plain PHP 8.1+/MySQL project, unchanged in
  that respect since Phase 2.
- A one-command Docker path (`docker compose up --build` at the repo root) brings up the whole
  stack (MySQL + backend + frontend behind nginx) locally for anyone who doesn't want to install
  anything but Docker — clearly documented as a local-use convenience, distinct from a real
  production deployment.
- **Shared-hosting deployment (e.g. Dreamhost) is now a first-class, documented path**, not just
  a theoretical "any plain PHP+MySQL host will do" claim. A user with a Dreamhost-style account
  (one Apache-mapped directory per domain, no reverse proxy they control) can deploy the whole
  app by: building/packaging locally (`backend/scripts/package-for-deploy.sh`, which runs the
  frontend build and a production `composer install` and assembles a ready-to-upload two-part
  `release/` directory), uploading the two resulting directories over SFTP, filling in one
  `config.php` file with their Dreamhost-provided database host/name/user/password and an app
  secret, and running the migration script once. No manual `.htaccess` authoring, no manual
  directory-layout decisions, and no separate frontend/backend hosting slots are required — the
  root and backend READMEs document this end-to-end as "Deploying to Dreamhost (shared hosting)."
  The underlying mechanism is generic single-directory Apache/PHP/MySQL shared hosting, not
  Dreamhost-proprietary; Dreamhost is used as the concrete, worked example because that's the
  host the user actually has.
- Account-mode photo storage remains private: files live outside the backend's web root, under
  randomized filenames, served only via short-lived HMAC-signed URLs. On a shared-hosting deploy
  this now extends to the entire backend source tree, not just the storage directory — the whole
  `backend/` project is uploaded to a private sibling directory outside the domain's mapped
  docroot, with a deny-all `.htaccess` shipped inside it as defense-in-depth against hosts that
  additionally expose account home directories via `mod_userdir`-style URLs. This remains a
  security/privacy property of the product, not just an implementation detail, and is explicitly
  documented as such in the root README.
- Every environment-specific setting (backend DB/storage/quota/rate-limit/CORS/Nominatim
  settings, frontend API base URL and map tile/style settings) is externalized. The backend now
  supports two equivalent ways of supplying the same settings: the existing `.env` file (local
  dev, Docker — unchanged) or a hand-edited `config.php` returning a plain PHP array (shared
  hosting), which take precedence over `.env` when present but never coexist with it in normal
  use. The frontend's post-build API base URL is still a plain runtime `config.js` file. All of
  this is documented in one consolidated root README, plus a Dreamhost-specific section in both
  READMEs.

## Not yet built
- **Trip auto-grouping, route lines between nearby-in-time photos, GeoJSON/KML export, and a
  heatmap-density map mode.** These were explicitly framed as lower-priority "if time allows"
  items in the original request and remain deferred; nothing about the current architecture
  blocks adding them later.
- **Guest-to-account photo migration** on login/logout — a deliberate scope decision for this
  version, not planned as a near-term addition unless prioritized.
- Explicitly out of scope for this product at any phase: multi-user collaboration on one account,
  photo editing, mobile native apps, payment/billing, an admin dashboard.

## Open product questions
None currently open. Whether the 100MB per-account storage quota is permanent product policy or
a placeholder remains an open future product decision, outside the scope of any phase built so
far, but does not block anything currently planned.
