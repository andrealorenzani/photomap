import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiPhotoRepository } from '../src/lib/db/apiPhotoRepository';
import { StorageQuotaExceededError } from '../src/lib/db/photoRepository';
import { resetCsrfTokenCache } from '../src/lib/api/http';
import type { PhotoRecord } from '../src/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function record(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: 'photo.jpg',
    relativePath: 'photo.jpg',
    size: 100,
    lastModified: 1000,
    hasGPS: false,
    hasPreview: true,
    ...overrides,
  };
}

const dto = {
  id: 42,
  lat: 45.1,
  lon: 9.2,
  takenAt: '2024-06-01 12:00:00',
  cameraMake: 'Acme',
  cameraModel: 'X100',
  createdAt: '2024-06-01 12:00:01',
  thumbnailUrl: '/api/photos/42/thumbnail?sig=abc',
  previewUrl: '/api/photos/42/file?sig=abc',
};

describe('ApiPhotoRepository', () => {
  beforeEach(() => {
    resetCsrfTokenCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('list() fetches GET /api/photos and maps to PhotoRecords using the backend id, with credentials included', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ photos: [dto] }));

    const repo = new ApiPhotoRepository();
    const records = await repo.list();

    expect(fetchSpy).toHaveBeenCalledWith('/api/photos', expect.objectContaining({ credentials: 'include' }));
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('api:42');
    expect(records[0].lat).toBe(45.1);
    expect(records[0].hasGPS).toBe(true);
  });

  it('add() fetches a CSRF token once, attaches X-CSRF-Token on the multipart POST, and returns a PhotoRecord reflecting the backend-assigned id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok-123' }));
      if (url.endsWith('/api/photos')) return Promise.resolve(jsonResponse(dto, 201));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const repo = new ApiPhotoRepository();
    const clientRecord = record('client-generated-hash-id');
    const blob = new Blob(['x'], { type: 'image/jpeg' });

    const persisted = await repo.add(clientRecord, { preview: blob });

    expect(persisted.id).toBe('api:42');
    expect(persisted.id).not.toBe(clientRecord.id);

    const uploadCall = fetchSpy.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/photos')
    );
    expect(uploadCall).toBeDefined();
    const [, init] = uploadCall!;
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-123');
    expect(init?.body).toBeInstanceOf(FormData);

    // CSRF token is fetched exactly once even though this call made two requests total
    // (csrf-token + photos) — the underlying cache is asserted more directly in http.test.ts.
    const csrfCalls = fetchSpy.mock.calls.filter(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/csrf-token')
    );
    expect(csrfCalls).toHaveLength(1);
  });

  it('add() throws StorageQuotaExceededError on a 413 quota_exceeded response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      return Promise.resolve(jsonResponse({ error: 'quota_exceeded', message: 'out of space' }, 413));
    });

    const repo = new ApiPhotoRepository();
    await expect(
      repo.add(record('p1'), { preview: new Blob(['x']) })
    ).rejects.toBeInstanceOf(StorageQuotaExceededError);
  });

  it('add() with no blob data throws (undecodable image is an upload error, not silently skipped)', async () => {
    const repo = new ApiPhotoRepository();
    await expect(repo.add(record('p1'), {})).rejects.toThrow();
  });

  it('remove() sends DELETE to the numeric backend id extracted from the prefixed id, with CSRF + credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/photos/42')) return Promise.resolve(jsonResponse({ ok: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const repo = new ApiPhotoRepository();
    await repo.remove('api:42');

    const deleteCall = fetchSpy.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/photos/42')
    );
    expect(deleteCall).toBeDefined();
    const [, init] = deleteCall!;
    expect(init?.method).toBe('DELETE');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
  });

  it('updateLocation() PATCHes JSON { lat, lon } to /api/photos/{id}', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/photos/42')) return Promise.resolve(jsonResponse({ ...dto, lat: 1, lon: 2 }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const repo = new ApiPhotoRepository();
    await repo.updateLocation('api:42', 1, 2);

    const patchCall = fetchSpy.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/photos/42')
    );
    const [, init] = patchCall!;
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ lat: 1, lon: 2 });
  });

  it('maps a 404 response to an ApiError with status 404', async () => {
    const { ApiError } = await import('../src/lib/api/http');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/photos/999')) {
        return Promise.resolve(jsonResponse({ error: 'not_found', message: 'Photo not found.' }, 404));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const repo = new ApiPhotoRepository();
    await expect(repo.updateLocation('api:999', 1, 2)).rejects.toMatchObject({ status: 404 });
    await expect(repo.updateLocation('api:999', 1, 2)).rejects.toBeInstanceOf(ApiError);
  });

  it('maps a 422 response to an ApiError with status 422', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/photos/42')) {
        return Promise.resolve(jsonResponse({ error: 'invalid_coordinates', message: 'bad coords' }, 422));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const repo = new ApiPhotoRepository();
    await expect(repo.updateLocation('api:42', 999, 2)).rejects.toMatchObject({ status: 422 });
  });

  it('uses the configured API base URL, not a hardcoded literal', async () => {
    window.__PHOTOMAP_CONFIG__ = { apiBaseUrl: 'https://api.example.com/v1' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ photos: [] }));

    const repo = new ApiPhotoRepository();
    await repo.list();

    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/v1/photos', expect.anything());
    delete window.__PHOTOMAP_CONFIG__;
  });
});
