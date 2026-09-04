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
  /**
   * Persists a photo record (and optional derived-image blobs). Returns the persisted record
   * with its *final* id — for IndexedDB this is always the same id it was given (the client's
   * stable hash is the durable key); for the account-mode ApiPhotoRepository this is the
   * backend's AUTO_INCREMENT id, which differs from the client-generated id the caller
   * optimistically used. Callers that optimistically inserted under the original id must
   * reconcile if the returned id differs (see `ingest/index.ts`'s `reconcileId` handling).
   */
  add(record: PhotoRecord, blobs?: { thumbnail?: Blob; preview?: Blob }): Promise<PhotoRecord>;
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

  async add(record: PhotoRecord, blobs?: { thumbnail?: Blob; preview?: Blob }): Promise<PhotoRecord> {
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
      // The IndexedDB key is already the durable id (the client's stable hash) — no
      // reconciliation is ever needed for guest mode.
      return record;
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

let active: PhotoRepository = new IndexedDbPhotoRepository();

/** Returns whichever repository is currently active (guest IndexedDB or account-mode API). */
export function getActiveRepository(): PhotoRepository {
  return active;
}

/**
 * Swaps the active repository (called only by `authStore.ts`, on login/session-restore ->
 * ApiPhotoRepository, and on logout -> a fresh IndexedDbPhotoRepository).
 */
export function setActiveRepository(repository: PhotoRepository): void {
  active = repository;
}

/**
 * A thin proxy delegating to `getActiveRepository()` at call time, so existing call sites
 * (`photoStore.ts`, `objectUrlCache.ts`, `App.tsx`) that import this constant directly need no
 * changes at all when the active repository is swapped at runtime.
 */
export const photoRepository: PhotoRepository = {
  list: () => getActiveRepository().list(),
  add: (record, blobs) => getActiveRepository().add(record, blobs),
  remove: (id) => getActiveRepository().remove(id),
  updateLocation: (id, lat, lon) => getActiveRepository().updateLocation(id, lat, lon),
  getBlob: (id, kind) => getActiveRepository().getBlob(id, kind),
  clearAll: () => getActiveRepository().clearAll(),
  estimateUsage: () => getActiveRepository().estimateUsage(),
  requestPersistence: () => getActiveRepository().requestPersistence(),
};
