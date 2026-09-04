import type { PhotoRecord } from '../../types';
import { getDB } from './schema';

/**
 * Storage seam for photo persistence. This is the only interface the rest of the app should
 * depend on (never IndexedDB directly). Phase 3 can implement this same shape against
 * `GET/POST/DELETE/PATCH /api/photos` with an `ApiPhotoRepository`, and nothing else in the app
 * needs to change.
 */
export interface PhotoRepository {
  list(): Promise<PhotoRecord[]>;
  add(record: PhotoRecord, blobs?: { thumbnail?: Blob; preview?: Blob }): Promise<void>;
  remove(id: string): Promise<void>;
  updateLocation(id: string, lat: number, lon: number): Promise<void>;
  getBlob(id: string, kind: 'thumbnail' | 'preview'): Promise<Blob | undefined>;
  clearAll(): Promise<void>;
  estimateUsage(): Promise<{ usage: number; quota: number } | undefined>;
  requestPersistence(): Promise<boolean>;
}

/** Thrown by `add()` when persisting to IndexedDB failed due to a full storage quota. */
export class StorageQuotaExceededError extends Error {
  constructor(message = 'Storage quota exceeded') {
    super(message);
    this.name = 'StorageQuotaExceededError';
  }
}

function isQuotaExceeded(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.code === 22)
  );
}

export class IndexedDbPhotoRepository implements PhotoRepository {
  async list(): Promise<PhotoRecord[]> {
    const db = await getDB();
    return db.getAll('photoMeta');
  }

  async add(record: PhotoRecord, blobs?: { thumbnail?: Blob; preview?: Blob }): Promise<void> {
    const db = await getDB();
    try {
      await db.put('photoMeta', record);
      if (blobs && (blobs.thumbnail || blobs.preview)) {
        await db.put('photoBlobs', {
          id: record.id,
          thumbnail: blobs.thumbnail,
          preview: blobs.preview,
        });
      }
    } catch (err) {
      if (isQuotaExceeded(err)) {
        throw new StorageQuotaExceededError();
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('photoMeta', id);
    await db.delete('photoBlobs', id);
  }

  async updateLocation(id: string, lat: number, lon: number): Promise<void> {
    const db = await getDB();
    const existing = await db.get('photoMeta', id);
    if (!existing) return;
    await db.put('photoMeta', { ...existing, lat, lon, hasGPS: true });
  }

  async getBlob(id: string, kind: 'thumbnail' | 'preview'): Promise<Blob | undefined> {
    const db = await getDB();
    const record = await db.get('photoBlobs', id);
    return record ? record[kind] : undefined;
  }

  async clearAll(): Promise<void> {
    const db = await getDB();
    await db.clear('photoMeta');
    await db.clear('photoBlobs');
  }

  async estimateUsage(): Promise<{ usage: number; quota: number } | undefined> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return undefined;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  }

  async requestPersistence(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
}

export const photoRepository: PhotoRepository = new IndexedDbPhotoRepository();
