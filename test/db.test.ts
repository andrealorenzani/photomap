import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbPhotoRepository, StorageQuotaExceededError } from '../src/lib/db';
import type { PhotoRecord } from '../src/types';

function record(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 100,
    lastModified: 1000,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

// Reuses the single underlying IndexedDB connection across tests (opening/closing a real
// connection per test is what caused fake-indexeddb "blocked" deadlocks); isolation between
// tests instead comes from clearing both stores before each test runs.
async function freshRepo() {
  const repo = new IndexedDbPhotoRepository();
  await repo.clearAll();
  return repo;
}

describe('IndexedDbPhotoRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds and lists photo records', async () => {
    const repo = await freshRepo();
    await repo.add(record('p1'));
    await repo.add(record('p2'));
    const all = await repo.list();
    expect(all.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
  });

  it('stores and retrieves thumbnail/preview blobs separately from metadata', async () => {
    const repo = await freshRepo();
    const thumb = new Blob(['thumb'], { type: 'image/jpeg' });
    const preview = new Blob(['preview'], { type: 'image/jpeg' });
    await repo.add(record('p1'), { thumbnail: thumb, preview });

    const gotThumb = await repo.getBlob('p1', 'thumbnail');
    const gotPreview = await repo.getBlob('p1', 'preview');
    expect(gotThumb).toBeDefined();
    expect(gotPreview).toBeDefined();
  });

  it('removes a record and its blobs', async () => {
    const repo = await freshRepo();
    await repo.add(record('p1'), { thumbnail: new Blob(['x']) });
    await repo.remove('p1');
    const all = await repo.list();
    expect(all).toHaveLength(0);
    expect(await repo.getBlob('p1', 'thumbnail')).toBeUndefined();
  });

  it('re-adding a previously-removed id (simulating re-selecting the same folder) restores it', async () => {
    const repo = await freshRepo();
    await repo.add(record('p1'));
    await repo.remove('p1');
    expect(await repo.list()).toHaveLength(0);
    // No tombstone: re-adding the same id is expected to succeed (documented no-tombstone
    // behavior for Phase 1).
    await repo.add(record('p1'));
    expect(await repo.list()).toHaveLength(1);
  });

  it('updateLocation patches lat/lon and sets hasGPS', async () => {
    const repo = await freshRepo();
    await repo.add(record('p1', { hasGPS: false }));
    await repo.updateLocation('p1', 10, 20);
    const [updated] = await repo.list();
    expect(updated.lat).toBe(10);
    expect(updated.lon).toBe(20);
    expect(updated.hasGPS).toBe(true);
  });

  it('wraps a QuotaExceededError from the underlying store into StorageQuotaExceededError', async () => {
    const repo = await freshRepo();
    // Force the underlying DB put to throw a DOMException the way IndexedDB does when quota is
    // exceeded, without actually filling up storage.
    const dbModule = await import('../src/lib/db/schema');
    const realDb = await dbModule.getDB();
    const putSpy = vi.spyOn(realDb, 'put').mockRejectedValueOnce(
      new DOMException('quota exceeded', 'QuotaExceededError')
    );

    await expect(repo.add(record('p-quota'))).rejects.toBeInstanceOf(StorageQuotaExceededError);
    putSpy.mockRestore();
  });
});
