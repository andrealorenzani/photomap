import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterImageFiles, ingestFiles } from '../src/lib/ingest';
import { usePhotoStore } from '../src/state/photoStore';
import { getActiveRepository, IndexedDbPhotoRepository, setActiveRepository, type PhotoRepository } from '../src/lib/db';
import type { PhotoRecord, WorkerParseRequest, WorkerResponse } from '../src/types';

function resetStore() {
  usePhotoStore.setState({
    photos: new Map(),
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
    dateFilter: null,
    selectedPhotoId: null,
  });
}

/** A fake Worker that responds synchronously (via microtask) to parse requests. */
function makeFakeWorkerFactory(responder: (req: WorkerParseRequest) => WorkerResponse, callLog: string[]) {
  return () => {
    const listeners: Array<(e: MessageEvent<WorkerResponse>) => void> = [];
    const worker = {
      addEventListener: (_type: string, cb: (e: MessageEvent<WorkerResponse>) => void) => {
        listeners.push(cb);
      },
      removeEventListener: () => {},
      postMessage: (msg: WorkerParseRequest) => {
        callLog.push(msg.id);
        const response = responder(msg);
        queueMicrotask(() => {
          listeners.forEach((cb) => cb({ data: response } as MessageEvent<WorkerResponse>));
        });
      },
      terminate: () => {},
    };
    return worker as unknown as Worker;
  };
}

function waitForParsingToFinish(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!usePhotoStore.getState().status.parsing) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

describe('filterImageFiles', () => {
  it('keeps files with an image/* MIME type', () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    expect(filterImageFiles([file])).toEqual([file]);
  });

  it('keeps HEIC files with empty MIME type via extension fallback', () => {
    const file = new File(['x'], 'a.heic', { type: '' });
    expect(filterImageFiles([file])).toEqual([file]);
  });

  it('excludes files with an explicit non-image MIME type', () => {
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    expect(filterImageFiles([file])).toEqual([]);
  });

  it('excludes non-image files with no recognized image extension and empty MIME type', () => {
    const file = new File(['x'], '.DS_Store', { type: '' });
    expect(filterImageFiles([file])).toEqual([]);
  });
});

describe('ingestFiles caching behavior', () => {
  beforeEach(() => {
    resetStore();
  });

  it('dispatches new files to the worker pool and populates the store', async () => {
    const callLog: string[] = [];
    const factory = makeFakeWorkerFactory(
      (req) => ({
        type: 'parsed',
        id: req.id,
        meta: { lat: 10, lon: 20, takenAtISO: '2023-01-01T00:00:00.000Z' },
      }),
      callLog
    );

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([file], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    expect(callLog).toHaveLength(1);
    const photos = Array.from(usePhotoStore.getState().photos.values());
    expect(photos).toHaveLength(1);
    expect(photos[0].hasGPS).toBe(true);
  });

  it('does not re-invoke the worker for a file already represented in the store (same relativePath+size+lastModified)', async () => {
    const callLog: string[] = [];
    const factory = makeFakeWorkerFactory(
      (req) => ({ type: 'parsed', id: req.id, meta: { takenAtISO: '2023-01-01T00:00:00.000Z' } }),
      callLog
    );

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([file], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();
    expect(callLog).toHaveLength(1);

    // Re-select the exact same file (same relativePath/size/lastModified => same stable id).
    const sameFileAgain = new File(['x'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([sameFileAgain], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    // No second dispatch to the worker for the unchanged file.
    expect(callLog).toHaveLength(1);
    expect(usePhotoStore.getState().photos.size).toBe(1);
  });

  it('re-parses a changed file (different size/lastModified) rather than serving it from cache', async () => {
    const callLog: string[] = [];
    const factory = makeFakeWorkerFactory(
      (req) => ({ type: 'parsed', id: req.id, meta: { takenAtISO: '2023-01-01T00:00:00.000Z' } }),
      callLog
    );

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([file], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    const changedFile = new File(['xy'], 'photo.jpg', { type: 'image/jpeg', lastModified: 2000 });
    ingestFiles([changedFile], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    expect(callLog).toHaveLength(2);
    expect(usePhotoStore.getState().photos.size).toBe(2);
  });

  it('keeps a failed-to-parse file out of the withGPS/withoutGPS/processed counts, tracked as skipped', async () => {
    const callLog: string[] = [];
    const factory = makeFakeWorkerFactory(
      (req) => ({ type: 'error', id: req.id, error: 'bad file' }),
      callLog
    );

    const file = new File(['x'], 'corrupt.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([file], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    const status = usePhotoStore.getState().status;
    expect(status.skipped).toBe(1);
    expect(status.withGPS).toBe(0);
    expect(status.withoutGPS).toBe(0);
    expect(usePhotoStore.getState().photos.size).toBe(0);
  });
});

/** A fake PhotoRepository whose add() resolves with a *different* id than it was given —
 * simulating account mode's server-assigned AUTO_INCREMENT id differing from the client's
 * optimistic stable-hash id. */
class ReassigningIdFakeRepository implements PhotoRepository {
  public addedUnderId: string[] = [];

  async list(): Promise<PhotoRecord[]> {
    return [];
  }

  async add(record: PhotoRecord): Promise<PhotoRecord> {
    this.addedUnderId.push(record.id);
    return { ...record, id: `api:${record.id}` };
  }

  async remove(): Promise<void> {}
  async updateLocation(): Promise<void> {}
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

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (predicate()) resolve();
      else setTimeout(check, 5);
    };
    check();
  });
}

describe('ingest id reconciliation (client-generated vs. server-assigned ids)', () => {
  const previousRepository = getActiveRepository();

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    setActiveRepository(previousRepository ?? new IndexedDbPhotoRepository());
  });

  it('when photoRepository.add() resolves with a different id than the optimistic client id, the store Map entry is moved (old key gone, new key present, no duplicate/orphaned entry)', async () => {
    const fakeRepo = new ReassigningIdFakeRepository();
    setActiveRepository(fakeRepo);

    const callLog: string[] = [];
    const factory = makeFakeWorkerFactory(
      (req) => ({ type: 'parsed', id: req.id, meta: { takenAtISO: '2023-01-01T00:00:00.000Z' } }),
      callLog
    );

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1000 });
    ingestFiles([file], { workerFactory: factory, poolSize: 1 });
    await waitForParsingToFinish();

    const clientId = callLog[0];
    await waitFor(() => usePhotoStore.getState().photos.has(`api:${clientId}`));

    const { photos } = usePhotoStore.getState();
    expect(photos.has(clientId)).toBe(false);
    expect(photos.has(`api:${clientId}`)).toBe(true);
    expect(photos.size).toBe(1);
    expect(fakeRepo.addedUnderId).toEqual([clientId]);
  });
});
