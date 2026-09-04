import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePhotoStore } from '../src/state/photoStore';
import {
  IndexedDbPhotoRepository,
  getActiveRepository,
  setActiveRepository,
  type PhotoRepository,
} from '../src/lib/db';
import type { PhotoRecord } from '../src/types';

function photo(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

function resetStore() {
  usePhotoStore.setState({
    photos: new Map(),
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
    dateFilter: null,
    selectedPhotoId: null,
    searchFilters: {},
  });
}

/** A fake PhotoRepository whose updateLocation() can be made to fail on demand, to test
 * reassignLocation()'s rollback-on-error behavior. */
class FailingUpdateLocationRepository implements PhotoRepository {
  public calls: Array<{ id: string; lat: number; lon: number }> = [];
  constructor(private readonly shouldFail: boolean) {}

  async list(): Promise<PhotoRecord[]> {
    return [];
  }
  async add(record: PhotoRecord): Promise<PhotoRecord> {
    return record;
  }
  async remove(): Promise<void> {}
  async updateLocation(id: string, lat: number, lon: number): Promise<void> {
    this.calls.push({ id, lat, lon });
    if (this.shouldFail) {
      throw Object.assign(new Error('not_found'), { status: 404 });
    }
  }
  async getBlob(): Promise<Blob | undefined> {
    return undefined;
  }
  async clearAll(): Promise<void> {}
  async estimateUsage() {
    return undefined;
  }
  async requestPersistence(): Promise<boolean> {
    return false;
  }
}

describe('reassignLocation store action (drag-to-reassign)', () => {
  const previousRepository = getActiveRepository();

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    setActiveRepository(previousRepository ?? new IndexedDbPhotoRepository());
  });

  it('given a drop point, calls the active repository.updateLocation() with the correct id/lat/lon', async () => {
    const repo = new FailingUpdateLocationRepository(false);
    setActiveRepository(repo);
    usePhotoStore.getState().upsertPhoto(photo('p1', { hasGPS: false }));

    await usePhotoStore.getState().reassignLocation('p1', 48.8566, 2.3522);

    expect(repo.calls).toEqual([{ id: 'p1', lat: 48.8566, lon: 2.3522 }]);
  });

  it('optimistically updates lat/lon/hasGPS/groupKey and adjusts withGPS/withoutGPS counts', async () => {
    const repo = new FailingUpdateLocationRepository(false);
    setActiveRepository(repo);
    usePhotoStore.getState().upsertPhoto(photo('p1', { hasGPS: false }));
    usePhotoStore.getState().setStatus({ withoutGPS: 1, withGPS: 0 });

    await usePhotoStore.getState().reassignLocation('p1', 10, 20);

    const updated = usePhotoStore.getState().photos.get('p1')!;
    expect(updated.lat).toBe(10);
    expect(updated.lon).toBe(20);
    expect(updated.hasGPS).toBe(true);
    expect(updated.groupKey).toBeDefined();
    expect(usePhotoStore.getState().status.withGPS).toBe(1);
    expect(usePhotoStore.getState().status.withoutGPS).toBe(0);
  });

  it('guest mode: works against the previously-unused IndexedDbPhotoRepository.updateLocation path (regression)', async () => {
    const repo = new IndexedDbPhotoRepository();
    await repo.clearAll();
    setActiveRepository(repo);
    await repo.add(photo('p1', { hasGPS: false }));
    usePhotoStore.getState().upsertPhoto(photo('p1', { hasGPS: false }));

    await usePhotoStore.getState().reassignLocation('p1', 5, 6);

    const [stored] = await repo.list();
    expect(stored.lat).toBe(5);
    expect(stored.lon).toBe(6);
    expect(stored.hasGPS).toBe(true);
  });

  it('account-mode rollback-on-error: a rejected repository update (e.g. 404/422) leaves the marker at its prior position, not silently showing the rejected location', async () => {
    const repo = new FailingUpdateLocationRepository(true);
    setActiveRepository(repo);
    usePhotoStore.getState().upsertPhoto(photo('p1', { hasGPS: true, lat: 1, lon: 1 }));
    usePhotoStore.getState().setStatus({ withGPS: 1, withoutGPS: 0 });

    await expect(usePhotoStore.getState().reassignLocation('p1', 99, 99)).rejects.toThrow();

    const afterFailure = usePhotoStore.getState().photos.get('p1')!;
    expect(afterFailure.lat).toBe(1);
    expect(afterFailure.lon).toBe(1);
    expect(usePhotoStore.getState().status.withGPS).toBe(1);
    expect(usePhotoStore.getState().status.withoutGPS).toBe(0);
  });

  it('reassignLocation() is a no-op when the given id is not in the store', async () => {
    const repo = new FailingUpdateLocationRepository(false);
    setActiveRepository(repo);

    await usePhotoStore.getState().reassignLocation('does-not-exist', 1, 2);

    expect(repo.calls).toEqual([]);
  });
});
