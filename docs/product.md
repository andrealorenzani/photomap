# Photomap — Product

## What it is
Photomap is a web app for browsing your own photo collection on a map and a timeline, using the
GPS coordinates and datetimes embedded in each photo's EXIF metadata. Drop a folder of photos in
and immediately see *where* and *when* they were taken, with the map and timeline kept in sync:
filtering the timeline narrows the map, and photos without location data are never dropped —
they stay reachable through the timeline even though they can't appear as a map marker.

## Modes
- **Guest mode** (default, no account) — **implemented (Phase 1)**: fully client-side. Photo
  bytes, EXIF metadata, filenames, and GPS coordinates never leave the browser — they live only
  in memory and IndexedDB for that device/session. A persistent privacy note ("Guest mode: your
  photos never leave this device.") is always visible. The one disclosed exception to "zero
  network calls" is the OpenStreetMap basemap tile requests inherent to any online slippy map —
  those carry only generic tile x/y/z indices for the visible area, never photo data.
- **Account mode** (logged in) — **backend implemented (Phase 2), not yet reachable from the app
  (Phase 3 pending)**: a standalone PHP + MySQL backend now exists that can register/log in an
  account, accept photo uploads, list and delete a user's photos, create/revoke a shareable
  read-only permalink to their map, and delete an account (erasing its rows and files). None of
  this is wired to the frontend yet — the top banner still shows placeholder username/password
  fields and a Login/Register control that are visibly present but intentionally inert (no
  network calls, no functional login state). Making the banner functional and pointing uploads/
  map/timeline at this backend is Phase 3, a separate future change.

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
  timeline filter changes.
- **Photos without GPS**: never discarded. They're counted in the status panel and remain
  reachable and viewable through the timeline, just not shown as map markers.
- **Timeline**: a bottom strip spanning from the earliest to latest photo date (or the current
  year if nothing is loaded), rendered as a density heatmap — darker/taller where more photos
  exist for that period. Clicking a segment filters the map to that date range and opens a
  thumbnail strip of the matching photos (including ones without GPS).
- **Viewing a photo**: clicking a thumbnail opens a full-size view with a semi-transparent
  overlay banner showing the photo's datetime. Phase 1 has no backend, so there is deliberately
  no reverse-geocoded place name and no raw latitude/longitude shown — just the datetime.
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

## Account mode, as it works today (Phase 2 — backend only, no frontend integration)

The accounts backend is a standalone project (`backend/`) that a user cannot yet reach through
the Photomap web app itself — it is only exercised directly (curl, Postman, or its own automated
test suite) until Phase 3 wires the frontend to it. Once wired, it will provide:

- **Registration and login**: email + password accounts, hashed with `password_hash()`, a
  server-side session (not a token the frontend manages), and CSRF protection on every
  state-changing request.
- **Uploading photos to the server**: a photo file plus its extracted GPS/datetime/camera
  metadata is uploaded and stored server-side (resized to a max 2000px long edge, plus a
  thumbnail), instead of staying local to one browser/device as in guest mode.
- **Cross-device access**: an account's photos live in the backend rather than one browser's
  IndexedDB, so (once Phase 3 wires the frontend to it) the same account will show the same
  photos from any device.
- **Deleting an uploaded photo**: removes both its database record and its files on disk, and
  only the account that owns a photo can delete it.
- **Sharing a read-only map**: an account holder can generate a single active share link (a
  random token); anyone with that link's URL can view a read-only version of that account's map
  data with no login, and the link can be revoked at any time, immediately cutting off access
  (including to already-open image URLs from that link).
- **Deleting an account**: erases the account's row, all of its photo records, all of its share
  links, and the actual photo/thumbnail files on disk. (This ends the current login session;
  it does not reach into other devices' sessions for the same account still logged in elsewhere —
  see `docs/architecture.md` for that documented limitation.)
- **Reverse geocoding**: a server-side proxy to OpenStreetMap's Nominatim service (now that a
  server exists to set the required `User-Agent` and honor its 1-request/second usage policy),
  with results cached so the same location isn't looked up repeatedly. Not yet visible anywhere
  in the UI — the full-size photo view still shows only a datetime, pending Phase 3 wiring it up.
- **Storage quota**: each account is capped at 100 MB of actual stored photo/thumbnail bytes;
  uploads past that are rejected with a clear error (surfaced as an API error response for now —
  showing this in the UI is a Phase 3 concern).

This backend has no bearing yet on what a user of the live Photomap app experiences — guest mode
today behaves exactly as described above, unchanged.

## Not yet built
- Frontend integration of account mode: a functional login/register banner, account-mode uploads
  going through the backend instead of IndexedDB, the map/timeline loading from the backend when
  logged in, a public `/share/{token}` read-only view, and a clear "your photos are stored on the
  server now" notice distinct from the guest-mode privacy note. All planned for Phase 3.
- Drag-to-reassign a marker's location for GPS-less photos, including the account-mode
  `PATCH /api/photos/{id}` endpoint that would back it (explicitly deferred to Phase 3, and not
  required for Phase 2 sign-off).
- Filter/search by date range, camera make/model, or has-location vs. not (beyond the timeline's
  own date-range filter); trip auto-grouping; route lines between nearby-in-time photos;
  GeoJSON/KML export; heatmap-density map mode. These are planned "core"/"nice to have" items for
  Phase 3.
- Explicitly out of scope for this product at any phase: multi-user collaboration on one account,
  photo editing, mobile native apps, payment/billing, an admin dashboard.

## Open product questions
None currently open. The reverse-geocoding question (whether to call a public geocoder from the
browser in guest mode) was resolved by omitting it entirely in Phase 1 and building a
server-side geocoding proxy in Phase 2 instead (`GET /api/geocode`), which is not yet exposed
in the UI pending Phase 3. Whether the 100MB per-account storage quota is permanent product
policy or a placeholder is left as a future product decision, outside the scope of any phase
built so far.
