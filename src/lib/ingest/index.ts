import { isUsableGPS, type PhotoRecord } from '../../types';
import { gridKey } from '../grouping';
import { stableIdForFile, relativePathOf } from '../stableId';
import { photoRepository, StorageQuotaExceededError } from '../db';
import { parseFiles, type ParseFilesHandle, type WorkerFactory } from '../exifWorkerPool';
import { usePhotoStore } from '../../state/photoStore';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'tif',
  'heic',
  'heif',
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Filters a raw FileList/File[] down to plausible image files. HEIC files frequently report an
 * empty `type` in browsers, so we fall back to an extension check when MIME sniffing is
 * inconclusive.
 */
export function filterImageFiles(files: File[]): File[] {
  return files.filter((file) => {
    if (file.type.startsWith('image/')) return true;
    if (file.type !== '') return false; // an explicit non-image MIME type: skip
    return IMAGE_EXTENSIONS.has(extensionOf(file.name));
  });
}

function buildRecord(
  id: string,
  file: File,
  meta: import('../../types').ParsedPhotoMeta,
  hasPreview: boolean
): PhotoRecord {
  const hasGPS = isUsableGPS(meta.lat, meta.lon);
  return {
    id,
    fileName: file.name,
    relativePath: relativePathOf(file),
    size: file.size,
    lastModified: file.lastModified,
    lat: hasGPS ? meta.lat : undefined,
    lon: hasGPS ? meta.lon : undefined,
    hasGPS,
    takenAtISO: meta.takenAtISO,
    cameraMake: meta.cameraMake,
    cameraModel: meta.cameraModel,
    width: meta.width,
    height: meta.height,
    orientation: meta.orientation,
    groupKey: hasGPS && meta.lat !== undefined && meta.lon !== undefined
      ? gridKey(meta.lat, meta.lon)
      : undefined,
    hasPreview,
  };
}

export interface IngestOptions {
  workerFactory?: WorkerFactory;
  poolSize?: number;
}

export interface IngestHandle {
  cancel: () => void;
}

/**
 * Orchestrates a folder-picker/drop-zone file list into the worker pool: filters to images,
 * computes cache-key ids synchronously, skips files already cached (same id => unchanged
 * relativePath+size+lastModified), and writes new results into IndexedDB + the zustand store.
 */
export function ingestFiles(rawFiles: File[], options: IngestOptions = {}): IngestHandle {
  const store = usePhotoStore.getState();
  const images = filterImageFiles(rawFiles);

  const known = usePhotoStore.getState().photos;
  const toParse: Array<{ id: string; file: File }> = [];
  let alreadyCached = 0;

  for (const file of images) {
    const id = stableIdForFile(file);
    if (known.has(id)) {
      alreadyCached += 1;
      continue;
    }
    toParse.push({ id, file });
  }

  store.resetIngestCounters(images.length);
  if (alreadyCached > 0) {
    // Cached files are already represented in the store/status from hydrateFromDB(); just
    // reflect that we "processed" them instantly (no re-parse) for accurate progress totals.
  }

  let quotaWarned = false;

  const handle: ParseFilesHandle = parseFiles(
    toParse,
    {
      onResult: ({ id, file, meta, thumbnailBlob, previewBlob }) => {
        const record = buildRecord(id, file, meta, Boolean(thumbnailBlob || previewBlob));
        usePhotoStore.getState().upsertPhoto(record);

        if (!quotaWarned) {
          photoRepository
            .add(record, { thumbnail: thumbnailBlob, preview: previewBlob })
            .catch((err) => {
              if (err instanceof StorageQuotaExceededError) {
                quotaWarned = true;
                usePhotoStore.getState().setStatus({
                  storageWarning:
                    'Storage is full: further photos in this batch will still be shown for this session but will not be saved, and will need to be re-selected after a page reload.',
                });
              } else {
                throw err;
              }
            });
        }
      },
      onError: () => {
        usePhotoStore.getState().setStatus({
          skipped: usePhotoStore.getState().status.skipped + 1,
        });
      },
      onComplete: () => {
        usePhotoStore.getState().setStatus({ parsing: false });
      },
    },
    { workerFactory: options.workerFactory, poolSize: options.poolSize }
  );

  if (toParse.length === 0) {
    usePhotoStore.getState().setStatus({ parsing: false });
  }

  return { cancel: handle.cancel };
}

export { filterImageFiles as _filterImageFilesForTesting };
