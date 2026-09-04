import type { PhotoRecord } from '../../types';
import { isUsableGPS } from '../../types';
import { gridKey } from '../grouping';
import { ApiError } from '../api/http';
import {
  deletePhoto,
  listPhotos,
  updatePhotoLocation,
  uploadPhoto,
  type ApiPhotoDTO,
} from '../api/photosApi';
import type { PhotoRepository } from './photoRepository';
import { StorageQuotaExceededError } from './photoRepository';

/** Prefix distinguishing account-mode ids (the backend's numeric AUTO_INCREMENT id) from
 * guest-mode stable-hash ids, so the two id spaces can never collide in the store's Map. */
export function apiPhotoId(backendId: number): string {
  return `api:${backendId}`;
}

export function backendIdFromApiPhotoId(id: string): number {
  return Number(id.slice('api:'.length));
}

function toPhotoRecord(dto: ApiPhotoDTO): PhotoRecord {
  const hasGPS = isUsableGPS(dto.lat ?? undefined, dto.lon ?? undefined);
  const lat = hasGPS ? (dto.lat as number) : undefined;
  const lon = hasGPS ? (dto.lon as number) : undefined;

  return {
    id: apiPhotoId(dto.id),
    fileName: `photo-${dto.id}.jpg`,
    relativePath: `photo-${dto.id}.jpg`,
    size: 0,
    lastModified: dto.createdAt ? new Date(dto.createdAt).getTime() : 0,
    lat,
    lon,
    hasGPS,
    takenAtISO: dto.takenAt ? new Date(dto.takenAt.replace(' ', 'T') + 'Z').toISOString() : undefined,
    cameraMake: dto.cameraMake ?? undefined,
    cameraModel: dto.cameraModel ?? undefined,
    groupKey: hasGPS && lat !== undefined && lon !== undefined ? gridKey(lat, lon) : undefined,
    hasPreview: true,
  };
}

/**
 * Account-mode implementation of PhotoRepository, backed by the Phase 2 backend's
 * GET/POST/DELETE/PATCH /api/photos. Signed thumbnail/preview URLs are cached per id (from the
 * most recent list()/add() response) so getBlob() can fetch bytes without a separate metadata
 * round-trip.
 */
export class ApiPhotoRepository implements PhotoRepository {
  private signedUrls = new Map<string, { thumbnailUrl: string; previewUrl: string }>();

  private remember(dto: ApiPhotoDTO): PhotoRecord {
    const record = toPhotoRecord(dto);
    this.signedUrls.set(record.id, { thumbnailUrl: dto.thumbnailUrl, previewUrl: dto.previewUrl });
    return record;
  }

  /**
   * Caches signed URLs from an already-fetched set of DTOs (e.g. from `GET /api/share/{token}`)
   * without making any network call itself, and returns the corresponding PhotoRecords. Used by
   * the read-only share view: a fresh ApiPhotoRepository instance is primed this way and
   * temporarily made the active repository (see SharePage) so the existing
   * `getBlob()`-via-`objectUrlCache` machinery in MapView/PhotoThumbStrip/FullSizeViewer works
   * unchanged — this never touches the global Zustand photo store, only which repository backs
   * blob object-URL lookups.
   */
  primeFromDtos(dtos: ApiPhotoDTO[]): PhotoRecord[] {
    return dtos.map((dto) => this.remember(dto));
  }

  async list(): Promise<PhotoRecord[]> {
    const dtos = await listPhotos();
    return dtos.map((dto) => this.remember(dto));
  }

  async add(record: PhotoRecord, blobs?: { thumbnail?: Blob; preview?: Blob }): Promise<PhotoRecord> {
    // Reuses the worker's already-resized ~1600-1800px/quality-0.8 preview; fall back to the
    // thumbnail if no preview was generated. A completely missing blob (e.g. undecodable HEIC)
    // is treated as an upload error, not silently skipped — account mode has nothing useful to
    // persist server-side without image bytes.
    const blob = blobs?.preview ?? blobs?.thumbnail;
    if (!blob) {
      throw new Error(`No image data available to upload for "${record.fileName}".`);
    }

    try {
      const dto = await uploadPhoto(blob, record.fileName, {
        lat: record.lat,
        lon: record.lon,
        takenAt: record.takenAtISO,
        cameraMake: record.cameraMake,
        cameraModel: record.cameraModel,
      });
      return this.remember(dto);
    } catch (err) {
      if (err instanceof ApiError && err.status === 413) {
        throw new StorageQuotaExceededError(err.message);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    await deletePhoto(backendIdFromApiPhotoId(id));
    this.signedUrls.delete(id);
  }

  async updateLocation(id: string, lat: number, lon: number): Promise<void> {
    const dto = await updatePhotoLocation(backendIdFromApiPhotoId(id), lat, lon);
    this.remember(dto);
  }

  async getBlob(id: string, kind: 'thumbnail' | 'preview'): Promise<Blob | undefined> {
    const urls = this.signedUrls.get(id);
    if (!urls) return undefined;
    const url = kind === 'thumbnail' ? urls.thumbnailUrl : urls.previewUrl;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return undefined;
    return response.blob();
  }

  /** Unused by any UI today (confirmed via grep) — no-op for account mode. */
  async clearAll(): Promise<void> {
    this.signedUrls.clear();
  }

  /** IndexedDB/browser-storage-specific concept, meaningless for server storage. */
  async estimateUsage(): Promise<{ usage: number; quota: number } | undefined> {
    return undefined;
  }

  /** IndexedDB/browser-storage-specific concept, meaningless for server storage. */
  async requestPersistence(): Promise<boolean> {
    return false;
  }
}
