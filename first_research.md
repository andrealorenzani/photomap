# Photomap — First Research

Research notes for a website that takes a folder of photos and plots each one
on a world map based on where (and when) it was taken.

---

## 1. Can the metadata be extracted in the frontend?

**Yes, entirely client-side, with no backend needed for extraction itself.**

- Modern browsers let a page read local files via the `<input type="file"
  webkitdirectory>` attribute (folder picker) or drag-and-drop of a folder,
  giving you a `FileList` of every file inside, without ever uploading them.
- Each `File` object can be read with the `File`/`Blob` APIs
  (`file.arrayBuffer()`), and a JS EXIF-parsing library can pull the metadata
  out of the raw bytes — no server round-trip required.
- Well-maintained libraries for this:
  - **[exifr](https://github.com/MikeKovarik/exifr)** — modern, fast, reads
    EXIF/GPS/IPTC/XMP, works in-browser, supports JPEG/TIFF/HEIC.
  - `exif-js` — older, simpler, JPEG-only, less maintained.
  - `piexifjs` — good if you also need to *write* EXIF back.
- Caveats:
  - **HEIC/HEIF** (default format on iPhones since iOS 11) has patchy
    in-browser decoding/thumbnail support; metadata extraction with `exifr`
    generally works, but rendering a preview thumbnail may need an extra
    HEIC-to-JPEG conversion library (e.g. `heic2any`), which is heavier.
  - Very large batches (thousands of photos) parsed in the main thread can
    freeze the UI — push parsing into a **Web Worker** and/or process in
    chunks with a progress bar.
  - Since everything happens in the browser, **privacy is a strong selling
    point**: photos never leave the user's machine unless you explicitly add
    upload/sync/sharing features.

So the architecture can genuinely be "frontend-only" for the core feature —
the "backend" in your description is really just "a map view," which can
also live in the browser (Leaflet/Mapbox GL reading data straight from the
parsed files). A backend becomes relevant only if you want persistence,
sharing between devices, or multi-user accounts (see §4).

---

## 2. Does the average phone photo have GPS + datetime metadata?

**Datetime: almost always yes. GPS: often, but not guaranteed.**

| Metadata field | Typical presence |
|---|---|
| `DateTimeOriginal` (EXIF) | Present on nearly all camera/phone photos unless stripped |
| GPS (`GPSLatitude`/`GPSLongitude`) | Present **only if location access was granted** to the camera app at capture time |

Details and gotchas:

- **iOS**: Camera app requests location permission; if granted, GPS EXIF is
  written. Users frequently deny it, or use "Precise Location" off (iOS 14+),
  which still tags GPS but with reduced/randomized accuracy in some
  contexts (actually Photos app fuzzes it in *shared* metadata, not in the
  original file itself — but be aware of this nuance if you compare devices).
- **Android**: Same idea — depends on the camera app's location toggle and OS
  location permission. Many Android camera apps default this **off**.
- **Messaging apps strip metadata almost universally.** Photos downloaded
  from WhatsApp, Telegram, Instagram, Signal, and even AirDrop-then-re-saved
  images typically have **no GPS and sometimes no EXIF at all** (some strip
  everything, some keep datetime but drop GPS). If your users source photos
  from these apps rather than the original camera roll, expect a lot of
  missing location data.
  - **Note:** for iOS/Android, users can grant a *site itself* geolocation
    permission via `navigator.geolocation`, but that only tells you the
    device's *current* location — it's irrelevant for tagging photos with
    where they were taken; you can only use the location baked into the
    file's own EXIF.
- Editing tools (Photoshop, Instagram filters, screenshots, re-encoding, some
  cloud backup pipelines) can drop or rewrite EXIF.
- Timestamps have their own subtlety: EXIF `DateTimeOriginal` has **no
  timezone info** in the classic tags (there are optional
  `OffsetTimeOriginal` tags added later that not all cameras write). So "the
  time the photo was taken" may need to be treated as local-time-at-capture
  rather than a precise UTC instant unless that offset tag is present.

**Practical implication for the product:** design for **partial data** as the
normal case, not the exception — plenty of real photos will have a date but
no coordinates, and you'll need a sensible way to represent/filter those
("Photos without location: 42 — view as timeline instead").

---

## 3. Is it possible to build this?

**Yes — it's a well-scoped, very feasible project**, and a good chunk of it
can be built as a static/client-only web app. A minimal, realistic version:

1. User selects a folder of photos (folder picker or drag-and-drop).
2. For each file, extract EXIF client-side (`exifr`), pull out
   `latitude`, `longitude`, `DateTimeOriginal` (and maybe camera model,
   orientation for correct thumbnail rotation).
3. Group/dedupe photos that share (approximately) the same coordinates into
   one marker per place.
4. Render a world map (Leaflet + OpenStreetMap tiles, or Mapbox GL JS,
   or MapLibre GL for a fully open-source stack) and drop a marker per
   location.
5. Clicking a marker opens a popup/panel showing the datetime(s) (and,
   nicely, a thumbnail) of the photo(s) taken there.

This is realistic to prototype in a day or two and to polish into a solid
personal tool over a couple of weeks. Complexity grows only as far as you
push features like accounts, sharing, or large-scale storage (§4).

---

## 4. Functionality I'd consider adding

**Core / high value**
- **Clustering** for markers that are close together or numerous (e.g.
  `Leaflet.markercluster`) so a trip with 200 photos in one city doesn't
  become 200 overlapping pins.
- **Popup gallery per marker**: thumbnail strip + datetime for *every* photo
  at that spot, not just one.
- **Timeline / calendar view** as a companion to the map — a horizontal
  timeline scrubber that highlights markers active in the selected date
  range, and handles the "no GPS" photos gracefully.
- **Filter/search**: by date range, by camera/device (from EXIF `Make`/
  `Model`), by "has location" vs "no location."
- **Drag-to-reassign location** for photos missing GPS (manual pin placement)
  — turns a limitation into a small but valuable manual-tagging feature.
- **Client-side caching** (IndexedDB) so re-opening the same folder doesn't
  re-parse everything, and so the map view is instant on return visits.

**Nice to have**
- **"Trip" auto-grouping**: cluster photos into trips by date+location
  proximity (e.g. gaps of >2 days and >100km start a new trip) and let the
  user rename/save these as named trips.
- **Route lines** connecting photos in chronological order to visualize
  travel paths.
- **Export**: GeoJSON/KML export of all points, or a shareable static page.
- **Heatmap mode** for "where have I been the most," as an alternative to
  discrete pins.
- **Privacy-first badge/copy**: make explicit in the UI that "your photos
  never leave your device" if you keep it client-only — this is a genuine
  differentiator worth surfacing to users.

**Only if you want to go beyond client-only**
- **Accounts + persistence** (so a user can come back on another device
  without re-selecting the folder) — needs a real backend + storage
  (S3-like blob store + a small DB for the extracted metadata), and now
  photos *do* leave the device, so you'd need auth, upload handling, and
  probably re-think the privacy story.
- **Sharing a map with someone else** (e.g. "here's our trip") — also implies
  server-side persistence.
- **Reverse geocoding** (turn lat/lon into "Rome, Italy") for nicer labels —
  can be done via a free/self-hosted service (Nominatim) but needs a backend
  or rate-limited client calls to avoid API abuse.

My recommendation: **start client-only** (no backend) to nail the core
experience fast and free of infra concerns, and only add a backend later if
you specifically want cross-device persistence or sharing.

---

## 5. A first prompt for sketching the website

Below is a prompt you could hand to an AI coding assistant (Claude Code, a
website-builder, or similar) to get a first working sketch. It's scoped to
the client-only version recommended above.

> Build a single-page web app called "Photomap."
>
> **Goal:** A user selects a local folder of photos. The app reads each
> photo's EXIF metadata entirely in the browser (no upload to any server),
> extracts GPS coordinates and the capture datetime where present, and
> plots one marker per distinct location on an interactive world map.
> Clicking a marker shows a popup with thumbnails and the datetime(s) of
> the photo(s) taken there.
>
> **Stack:**
> - Vanilla JS/TypeScript + Vite (or React if you prefer), no backend.
> - `exifr` for EXIF/GPS/datetime parsing.
> - Leaflet (with OpenStreetMap tiles) for the map.
> - `Leaflet.markercluster` for clustering nearby markers.
>
> **Requirements:**
> 1. A folder picker (`<input type="file" webkitdirectory multiple>`) plus
>    drag-and-drop of a folder onto the page.
> 2. Parse EXIF for every image file client-side, in a Web Worker so the UI
>    stays responsive; show a progress bar while parsing.
> 3. Skip/flag files with no usable GPS data; show a count of "N photos
>    without location" somewhere in the UI rather than silently dropping
>    them.
> 4. Group photos by rounded coordinates (e.g. same location within ~50m)
>    into single markers; a marker's popup lists every photo at that spot
>    as a small thumbnail with its datetime, sorted chronologically.
> 5. Fit the map bounds to the markers on load.
> 6. Keep all photo bytes/thumbnails in memory or IndexedDB — never send
>    them over the network.
> 7. Clean, minimal UI: a header with the folder picker and progress bar,
>    the map filling the rest of the viewport.
>
> **Not needed yet:** accounts, persistence across sessions, sharing,
> timeline view, reverse geocoding. Keep it to a single clean HTML/JS/CSS
> (or minimal React) project I can run with `npm install && npm run dev`.

You can trim requirement 7 or add specific styling preferences once you see
the first version running.
