# Photomap

Drop a folder of your own photos onto a map and a timeline and immediately see *where* and
*when* they were taken.

This repository currently implements **Phase 1: guest mode** — a frontend-only experience with
no login, no server, and no accounts. Your photo data never leaves your browser.

## Running the frontend

```bash
npm install
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`). Select a folder of photos
via the "Select folder…" button, or drag-and-drop a folder onto the map.

Other scripts:

```bash
npm test        # runs the automated test suite once (vitest)
npm run test:watch
npm run build    # type-checks and produces a production build
npm run lint     # type-check only (tsc --noEmit)
```

## Privacy guarantee — and one disclosed exception

Guest mode's core promise: **photo bytes, EXIF metadata, filenames, and GPS coordinates are
never transmitted anywhere.** Everything is parsed, thumbnailed, stored (IndexedDB), and
rendered entirely client-side.

The one disclosed, unavoidable exception: this app uses **Leaflet with OpenStreetMap tiles** for
the map. Like any online slippy map, panning/zooming the map issues normal HTTP requests to the
OSM tile server to fetch the tile images for whatever area is currently in view. Those requests
only ever contain generic tile x/y/z indices for the visible map area — never any photo bytes,
EXIF data, filenames, or the coordinates of your individual photos. This is inherent to the
mandated Leaflet + OSM stack, not a privacy leak or scope creep, and it's the sole exception to
"zero network calls" in this phase (alongside ordinary dev-time traffic: npm registry access,
Vite's dev server/HMR, etc).

Reverse geocoding (turning coordinates into a place name) is **deliberately omitted** in Phase 1:
browsers cannot set a custom `User-Agent` header on `fetch()` (a forbidden header per spec),
which is exactly what a public geocoder's usage policy needs to identify a compliant client. The
full-size photo view therefore shows only a datetime overlay, never a place name or raw
lat/long. This will be revisited in Phase 2 via a server-side geocoding proxy.

## Known Phase 1 characteristics (not bugs)

- **Thumbnails/previews only, never originals.** IndexedDB stores a ~200px thumbnail and a
  ~1600–1800px/quality-80 preview per photo — never the original file bytes. This keeps storage
  bounded for large personal libraries, but means the full-size viewer is not pixel-perfect
  against your original files.
- **HEIC/HEIF photos:** EXIF metadata (GPS, datetime) is extracted normally and these photos
  participate fully on the map/timeline. Thumbnail/preview *image* rendering falls back to a
  generic placeholder icon on browsers that can't decode HEIC in-browser (Chrome, Firefox as of
  this writing) — only Safari currently can. This is a documented limitation, not a crash.
- **No delete "tombstone".** Deleting a photo removes it from IndexedDB and in-memory state
  immediately. Caching is per-file (a hash of relative path + size + last-modified time), not
  per-folder, so if you later re-select the same folder, a previously-deleted file will simply
  be re-parsed and reappear. There's no folder-level identity to track exclusions against in
  Phase 1.
- **Null Island.** GPS coordinates of exactly `(0, 0)` are treated as *no GPS*, not a real
  location — some cameras/exporters write zeroed GPS tags as a bug/placeholder.
- **Storage quota.** If IndexedDB storage fills up mid-import, remaining not-yet-processed files
  in that batch stop being persisted (a status-panel message explains this), but they continue
  to be parsed and shown for the current session — they just won't survive a page reload.

## Project layout

```
src/
  types.ts                  Shared domain model (PhotoRecord, MarkerGroup, worker messages)
  types/leaflet.markercluster.d.ts   Ambient types for leaflet.markercluster
  state/photoStore.ts        Zustand store: photos, ingest status, timeline filter, selection
  lib/db/                    The only module allowed to talk to IndexedDB directly.
                              Exposes a PhotoRepository interface + IndexedDbPhotoRepository —
                              the seam a future Phase 3 ApiPhotoRepository will implement
                              against the account-mode JSON API.
  lib/ingest/                Orchestrates folder-picker/drop input -> cache check -> worker pool
                              -> repository + store.
  lib/grouping.ts            Latitude-corrected ~50m grid bucketing for marker grouping.
  lib/timeline.ts            Pure binning/domain/intensity/hit-testing logic for the timeline.
  lib/exifWorkerPool.ts       Small round-robin worker pool with progress + cancellation.
  lib/stableId.ts             Deterministic per-file cache-key id (path+size+lastModified).
  lib/dropFiles.ts            Recursive folder drag-and-drop file resolution.
  lib/objectUrlCache.ts       LRU cache of blob object URLs with explicit revocation.
  workers/exifWorker.ts       Runs exifr parsing + thumbnail/preview generation off-thread.
  components/                 TopBanner, PrivacyNote, UploadControl, StatusPanel, MapView,
                              TimelineStrip, PhotoThumbStrip, FullSizeViewer.
test/
  fixtures/                   Sample JPEGs/HEIC with varied, deliberate EXIF characteristics.
  *.test.ts(x)                Vitest unit/integration tests.
```

## Testing

Automated coverage (`npm test`) includes: EXIF parsing/classification (GPS, datetime-only,
Null Island, corrupted files, HEIC metadata), coordinate grouping math (including high-latitude
correctness), timeline binning/intensity/hit-testing, IndexedDB repository behavior (including
quota-exceeded handling and no-tombstone re-add), the ingest cache-key pipeline (skips
re-parsing unchanged files, re-parses changed ones), the worker pool (distribution, progress,
cancellation), and key React components (thumbnail strip sorting/deletion, full-size viewer,
status panel, privacy note, inert login placeholder).

Not practical to automate in this environment and left as a manual checklist instead: real
cross-browser drag-and-drop/folder-picker behavior, Leaflet map bounds fitting in a real
browser, large-set (1000+) performance, and visual heatmap density inspection. See the change
plan's Testing information section for the full manual checklist.
