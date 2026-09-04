import { describe, expect, it } from 'vitest';
import { parseFiles } from '../src/lib/exifWorkerPool';
import type { WorkerParseRequest, WorkerResponse } from '../src/types';

function makeFakeWorkerFactory(log: { workerId: number; fileId: string }[], workerCounter: { n: number }) {
  return () => {
    const id = workerCounter.n++;
    const listeners: Array<(e: MessageEvent<WorkerResponse>) => void> = [];
    let terminated = false;
    return {
      addEventListener: (_t: string, cb: (e: MessageEvent<WorkerResponse>) => void) => {
        listeners.push(cb);
      },
      removeEventListener: () => {},
      postMessage: (msg: WorkerParseRequest) => {
        if (terminated) return;
        log.push({ workerId: id, fileId: msg.id });
        queueMicrotask(() => {
          if (terminated) return;
          const response: WorkerResponse = { type: 'parsed', id: msg.id, meta: {} };
          listeners.forEach((cb) => cb({ data: response } as MessageEvent<WorkerResponse>));
        });
      },
      terminate: () => {
        terminated = true;
      },
    } as unknown as Worker;
  };
}

function makeFiles(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    file: new File(['x'], `f${i}.jpg`),
  }));
}

describe('parseFiles worker pool', () => {
  it('distributes files across a small pool of workers', async () => {
    const log: { workerId: number; fileId: string }[] = [];
    const counter = { n: 0 };
    const factory = makeFakeWorkerFactory(log, counter);
    const files = makeFiles(8);

    await new Promise<void>((resolve) => {
      parseFiles(files, { onResult: () => {}, onError: () => {}, onComplete: resolve }, {
        workerFactory: factory,
        poolSize: 4,
      });
    });

    expect(log).toHaveLength(8);
    const usedWorkers = new Set(log.map((l) => l.workerId));
    expect(usedWorkers.size).toBe(4);
  });

  it('caps the pool size at the number of files when fewer files than poolSize', async () => {
    const log: { workerId: number; fileId: string }[] = [];
    const counter = { n: 0 };
    const factory = makeFakeWorkerFactory(log, counter);
    const files = makeFiles(2);

    await new Promise<void>((resolve) => {
      parseFiles(files, { onResult: () => {}, onError: () => {}, onComplete: resolve }, {
        workerFactory: factory,
        poolSize: 4,
      });
    });

    const usedWorkers = new Set(log.map((l) => l.workerId));
    expect(usedWorkers.size).toBe(2);
  });

  it('reports progress once per completed file', async () => {
    const log: { workerId: number; fileId: string }[] = [];
    const counter = { n: 0 };
    const factory = makeFakeWorkerFactory(log, counter);
    const files = makeFiles(5);
    const progressCalls: Array<[number, number]> = [];

    await new Promise<void>((resolve) => {
      parseFiles(
        files,
        {
          onResult: () => {},
          onError: () => {},
          onProgress: (done, total) => progressCalls.push([done, total]),
          onComplete: resolve,
        },
        { workerFactory: factory, poolSize: 2 }
      );
    });

    expect(progressCalls).toHaveLength(5);
    expect(progressCalls[progressCalls.length - 1]).toEqual([5, 5]);
  });

  it('calls onComplete immediately (async) when given zero files', async () => {
    const log: { workerId: number; fileId: string }[] = [];
    const counter = { n: 0 };
    const factory = makeFakeWorkerFactory(log, counter);
    let completed = false;
    parseFiles([], { onResult: () => {}, onError: () => {}, onComplete: () => (completed = true) }, {
      workerFactory: factory,
    });
    expect(completed).toBe(false); // not synchronous
    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(true);
  });

  it('cancel() stops further dispatch and terminates workers', async () => {
    const log: { workerId: number; fileId: string }[] = [];
    const counter = { n: 0 };
    const factory = makeFakeWorkerFactory(log, counter);
    const files = makeFiles(20);

    const handle = parseFiles(files, { onResult: () => {}, onError: () => {} }, {
      workerFactory: factory,
      poolSize: 2,
    });
    handle.cancel();

    // Give any in-flight microtasks a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    // Only the initial 2 dispatches (one per worker) should have gone out before cancellation;
    // no further files should be dispatched since workers are terminated.
    expect(log.length).toBeLessThanOrEqual(2);
  });
});
