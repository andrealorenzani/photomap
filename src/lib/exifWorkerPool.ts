import type { ParsedPhotoMeta, WorkerResponse } from '../types';

export interface ParseFileResult {
  id: string;
  file: File;
  meta: ParsedPhotoMeta;
  thumbnailBlob?: Blob;
  previewBlob?: Blob;
}

export interface ParseFileError {
  id: string;
  file: File;
  error: string;
}

export interface ParseFilesCallbacks {
  onResult: (result: ParseFileResult) => void;
  onError: (error: ParseFileError) => void;
  /** Called after each file completes (success or error), with running totals. */
  onProgress?: (done: number, total: number) => void;
  onComplete?: () => void;
}

export interface ParseFilesHandle {
  cancel: () => void;
}

export type WorkerFactory = () => Worker;

const DEFAULT_POOL_SIZE = 4;

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('../workers/exifWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * Dispatches `files` across a small round-robin pool of exif workers (2-4, capped by
 * navigator.hardwareConcurrency), tracks per-file progress, and supports cancellation (e.g. a
 * new folder is dropped mid-parse).
 */
export function parseFiles(
  files: Array<{ id: string; file: File }>,
  callbacks: ParseFilesCallbacks,
  options: { poolSize?: number; workerFactory?: WorkerFactory } = {}
): ParseFilesHandle {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const poolSize = Math.max(
    1,
    Math.min(options.poolSize ?? DEFAULT_POOL_SIZE, hardwareConcurrency, files.length || 1)
  );
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;

  let cancelled = false;
  let nextIndex = 0;
  let done = 0;
  const total = files.length;
  const workers: Worker[] = [];

  function dispatchNext(worker: Worker) {
    if (cancelled) return;
    if (nextIndex >= files.length) return;
    const item = files[nextIndex++];
    worker.postMessage({ type: 'parse', id: item.id, file: item.file });
  }

  function handleMessage(worker: Worker, event: MessageEvent<WorkerResponse>) {
    if (cancelled) return;
    const response = event.data;
    const item = files.find((f) => f.id === response.id);
    if (item) {
      if (response.type === 'parsed') {
        callbacks.onResult({
          id: response.id,
          file: item.file,
          meta: response.meta,
          thumbnailBlob: response.thumbnailBlob,
          previewBlob: response.previewBlob,
        });
      } else {
        callbacks.onError({ id: response.id, file: item.file, error: response.error });
      }
    }
    done += 1;
    callbacks.onProgress?.(done, total);
    if (done >= total) {
      callbacks.onComplete?.();
    }
    dispatchNext(worker);
  }

  if (total === 0) {
    // Nothing to do; report completion asynchronously to keep behavior consistent for callers.
    queueMicrotask(() => callbacks.onComplete?.());
    return { cancel: () => {} };
  }

  for (let i = 0; i < poolSize; i++) {
    const worker = workerFactory();
    workers.push(worker);
    worker.addEventListener('message', (event) => handleMessage(worker, event));
    dispatchNext(worker);
  }

  return {
    cancel: () => {
      cancelled = true;
      for (const worker of workers) worker.terminate();
    },
  };
}
