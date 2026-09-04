/**
 * Shared domain model for Photomap.
 *
 * Field names deliberately mirror the concepts planned for the Phase 2 PHP/MySQL `photos`
 * table (camelCase here vs. snake_case in the future DB schema: lat/lon, takenAt/taken_at,
 * cameraMake/camera_make, cameraModel/camera_model) so that mapping to/from the future JSON
 * API in Phase 3 is close to 1:1.
 */

/** A single photo's metadata and derived-image state, as held in app memory / IndexedDB. */
export interface PhotoRecord {
  /** Stable id: hash(relativePath, size, lastModified). Used as the IndexedDB key. */
  id: string;
  fileName: string;
  relativePath: string;
  size: number;
  lastModified: number;

  /** Latitude in decimal degrees. Undefined/absent if no usable GPS. */
  lat?: number;
  /** Longitude in decimal degrees. Undefined/absent if no usable GPS. */
  lon?: number;
  /** True if lat/lon are present AND not the Null Island (0,0) sentinel. */
  hasGPS: boolean;

  /** ISO-8601 datetime string derived from EXIF DateTimeOriginal (or similar), if available. */
  takenAtISO?: string;

  cameraMake?: string;
  cameraModel?: string;
  width?: number;
  height?: number;
  orientation?: number;

  /** Grouping bucket key (see src/lib/grouping.ts), present only when hasGPS is true. */
  groupKey?: string;

  /** True if a thumbnail/preview blob could not be generated (e.g. undecodable HEIC). */
  hasPreview: boolean;
}

/** A cluster of one-or-more photos taken at effectively the same location (~50m grid cell). */
export interface MarkerGroup {
  groupKey: string;
  /** Centroid latitude of all photos in the group. */
  lat: number;
  /** Centroid longitude of all photos in the group. */
  lon: number;
  photoIds: string[];
}

/** Live ingest status, surfaced by the status panel. */
export interface IngestStatus {
  total: number;
  processed: number;
  withGPS: number;
  withoutGPS: number;
  skipped: number;
  parsing: boolean;
  storageWarning?: string;
  /** Count of non-quota persistence failures (network error, 413/422, etc. in account mode). */
  uploadFailures: number;
}

/** Parsed EXIF-derived metadata produced by the worker for a single file. */
export interface ParsedPhotoMeta {
  lat?: number;
  lon?: number;
  takenAtISO?: string;
  cameraMake?: string;
  cameraModel?: string;
  width?: number;
  height?: number;
  orientation?: number;
}

/** Messages sent from the main thread to an exif worker. */
export interface WorkerParseRequest {
  type: 'parse';
  id: string;
  file: File;
}

/** Messages sent from an exif worker back to the main thread. */
export type WorkerResponse =
  | {
      type: 'parsed';
      id: string;
      meta: ParsedPhotoMeta;
      thumbnailBlob?: Blob;
      previewBlob?: Blob;
    }
  | {
      type: 'error';
      id: string;
      error: string;
    };

export const NULL_ISLAND_LAT = 0;
export const NULL_ISLAND_LON = 0;

export function isUsableGPS(lat: number | undefined, lon: number | undefined): lat is number {
  if (lat === undefined || lon === undefined) return false;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false;
  if (lat === NULL_ISLAND_LAT && lon === NULL_ISLAND_LON) return false;
  return true;
}
