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

/**
 * Resizes (and, when `orientation` is a rotate/flip value the browser didn't already apply,
 * corrects) an image into a new canvas capped at `maxDim` on its longest side.
 *
 * `orientationAppliedByBrowser` is true when the bitmap was created with
 * `createImageBitmap(file, { imageOrientation: 'from-image' })` and that succeeded — in that
 * case `bitmap.width`/`height` already reflect the corrected (post-rotation) orientation, and no
 * further transform is needed here. Otherwise, a manual canvas-transform fallback applies the
 * standard EXIF 1-8 orientation correction (rotate/flip) based on the parsed tag.
 */
function resizeCanvas(
  bitmap: ImageBitmap,
  maxDim: number,
  orientation: number | undefined,
  orientationAppliedByBrowser: boolean
): OffscreenCanvas {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));

  const needsManualCorrection =
    !orientationAppliedByBrowser && orientation !== undefined && orientation >= 2 && orientation <= 8;

  if (!needsManualCorrection) {
    const canvas = new OffscreenCanvas(drawWidth, drawHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
    return canvas;
  }

  // Orientations 5-8 involve a 90-degree rotation, which swaps the final canvas's width/height
  // relative to the drawn (pre-transform) image dimensions.
  const swapped = orientation! >= 5 && orientation! <= 8;
  const canvas = new OffscreenCanvas(swapped ? drawHeight : drawWidth, swapped ? drawWidth : drawHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  // Standard EXIF orientation-correction transform matrices, applied before drawing.
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, drawWidth, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, drawWidth, drawHeight);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, drawHeight);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, drawHeight, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, drawHeight, drawWidth);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, drawWidth);
      break;
    default:
      break;
  }

  ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
  return canvas;
}

async function generateDerivedImages(
  file: File,
  orientation: number | undefined
): Promise<{ thumbnailBlob?: Blob; previewBlob?: Blob }> {
  let bitmap: ImageBitmap;
  let orientationAppliedByBrowser = true;
  try {
    // Preferred path: let the browser apply EXIF orientation itself while decoding.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      // Fallback for browsers that don't support the `imageOrientation` option at all —
      // orientation correction is then applied manually in resizeCanvas() below, based on the
      // orientation tag already parsed from EXIF.
      orientationAppliedByBrowser = false;
      bitmap = await createImageBitmap(file);
    } catch {
      // Undecodable by this browser (e.g. HEIC on Chrome/Firefox) — not a crash, just no
      // preview. The photo still participates fully in map/timeline via its EXIF metadata.
      return {};
    }
  }

  try {
    const thumbCanvas = resizeCanvas(bitmap, THUMBNAIL_MAX_DIM, orientation, orientationAppliedByBrowser);
    const previewCanvas = resizeCanvas(bitmap, PREVIEW_MAX_DIM, orientation, orientationAppliedByBrowser);
    const [thumbnailBlob, previewBlob] = await Promise.all([
      thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY }),
      previewCanvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY }),
    ]);
    return { thumbnailBlob, previewBlob };
  } finally {
    bitmap.close();
  }
}

async function handleParse(req: WorkerParseRequest): Promise<WorkerResponse> {
  try {
    const meta = await extractMeta(req.file);
    const { thumbnailBlob, previewBlob } = await generateDerivedImages(req.file, meta.orientation);
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
export { extractMeta, isUsableGPS, resizeCanvas, generateDerivedImages };
