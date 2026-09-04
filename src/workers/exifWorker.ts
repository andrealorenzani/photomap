/// <reference lib="webworker" />
import { parse as exifrParse } from 'exifr';
import { isUsableGPS } from '../types';
import type { ParsedPhotoMeta, WorkerParseRequest, WorkerResponse } from '../types';

// Runs entirely inside a dedicated Web Worker: EXIF parsing (via exifr) AND thumbnail/preview
// generation (via createImageBitmap + OffscreenCanvas) happen here so the main thread never
// blocks while a folder full of photos is processed.

const THUMBNAIL_MAX_DIM = 200;
const PREVIEW_MAX_DIM = 1800; // matches Phase 2's planned server-side resize target
const PREVIEW_QUALITY = 0.8;

async function extractMeta(file: File): Promise<ParsedPhotoMeta> {
  const meta: ParsedPhotoMeta = {};
  try {
    const exif = await exifrParse(file, {
      tiff: true,
      exif: true,
      gps: true,
    });

    if (exif) {
      if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
        meta.lat = exif.latitude;
        meta.lon = exif.longitude;
      }

      const dt: Date | undefined =
        exif.DateTimeOriginal ?? exif.CreateDate ?? exif.ModifyDate ?? exif.DateTime;
      if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
        meta.takenAtISO = dt.toISOString();
      }

      if (typeof exif.Make === 'string') meta.cameraMake = exif.Make;
      if (typeof exif.Model === 'string') meta.cameraModel = exif.Model;
      if (typeof exif.ExifImageWidth === 'number') meta.width = exif.ExifImageWidth;
      if (typeof exif.ExifImageHeight === 'number') meta.height = exif.ExifImageHeight;
      if (typeof exif.Orientation === 'number') meta.orientation = exif.Orientation;
    }
  } catch {
    // EXIF parsing failure is not fatal — the file may still be a valid, decodable image with
    // no/garbled metadata. Metadata just stays empty; thumbnail generation is attempted below.
  }
  return meta;
}

function resizeCanvas(bitmap: ImageBitmap, maxDim: number): OffscreenCanvas {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function generateDerivedImages(
  file: File
): Promise<{ thumbnailBlob?: Blob; previewBlob?: Blob }> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const thumbCanvas = resizeCanvas(bitmap, THUMBNAIL_MAX_DIM);
      const previewCanvas = resizeCanvas(bitmap, PREVIEW_MAX_DIM);
      const [thumbnailBlob, previewBlob] = await Promise.all([
        thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY }),
        previewCanvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY }),
      ]);
      return { thumbnailBlob, previewBlob };
    } finally {
      bitmap.close();
    }
  } catch {
    // Undecodable by this browser (e.g. HEIC on Chrome/Firefox) — not a crash, just no
    // preview. The photo still participates fully in map/timeline via its EXIF metadata.
    return {};
  }
}

async function handleParse(req: WorkerParseRequest): Promise<WorkerResponse> {
  try {
    const meta = await extractMeta(req.file);
    const { thumbnailBlob, previewBlob } = await generateDerivedImages(req.file);
    return { type: 'parsed', id: req.id, meta, thumbnailBlob, previewBlob };
  } catch (err) {
    return {
      type: 'error',
      id: req.id,
      error: err instanceof Error ? err.message : 'Unknown error parsing file',
    };
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerParseRequest>) => {
  const req = event.data;
  if (req?.type !== 'parse') return;
  handleParse(req).then((response) => {
    self.postMessage(response);
  });
});

// Utility export kept for unit testing the pure metadata-classification logic without spinning
// up a real worker (exifWorker.test.ts imports these directly under Node/Vitest).
export { extractMeta, isUsableGPS };
