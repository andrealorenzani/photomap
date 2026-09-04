import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/state/authStore';
import { usePhotoStore } from '../src/state/photoStore';
import { getActiveRepository, ApiPhotoRepository, IndexedDbPhotoRepository, setActiveRepository } from '../src/lib/db';
import { resetCsrfTokenCache } from '../src/lib/api/http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function resetAll() {
  useAuthStore.setState({ status: 'idle', user: null, error: null });
  setActiveRepository(new IndexedDbPhotoRepository());
  resetCsrfTokenCache();
}

describe('authStore mode switching', () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAll();
  });

  it('restoreSession(): unauthenticated GET /api/me results in guest mode with the IndexedDB repository active, and makes no /api/photos call (Phase 1 zero-network-for-photo-data guarantee holds for guest mode)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/me')) return Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe('guest');
    expect(getActiveRepository()).toBeInstanceOf(IndexedDbPhotoRepository);
    const photoCalls = fetchSpy.mock.calls.filter(([input]) =>
      (typeof input === 'string' ? input : input.toString()).includes('/api/photos')
    );
    expect(photoCalls).toHaveLength(0);
  });

  it('restoreSession(): an authenticated GET /api/me results in account mode with the ApiPhotoRepository active, hydrated via GET /api/photos', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/me')) return Promise.resolve(jsonResponse({ id: 1, email: 'user@example.com' }));
      if (url.endsWith('/api/photos')) return Promise.resolve(jsonResponse({ photos: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.email).toBe('user@example.com');
    expect(getActiveRepository()).toBeInstanceOf(ApiPhotoRepository);
  });

  it('logout() reverts the active repository back to a fresh IndexedDbPhotoRepository and clears user state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/logout')) return Promise.resolve(jsonResponse({ ok: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    setActiveRepository(new ApiPhotoRepository());
    useAuthStore.setState({ status: 'authenticated', user: { email: 'user@example.com' }, error: null });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().user).toBeNull();
    expect(getActiveRepository()).toBeInstanceOf(IndexedDbPhotoRepository);
  });

  it('the persistent account notice logic (authStore status) never reports authenticated for guest mode after a failed session check', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().status).toBe('guest');
  });
});

describe('reconcileId store action', () => {
  beforeEach(() => {
    usePhotoStore.setState({
      photos: new Map(),
      status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
      dateFilter: null,
      selectedPhotoId: null,
      searchFilters: {},
    });
  });

  it('moves a Map entry from the old (client-generated) id to the new (server-assigned) id with no orphaned/duplicate entries', () => {
    const clientRecord = {
      id: 'client-hash-1',
      fileName: 'a.jpg',
      relativePath: 'a.jpg',
      size: 10,
      lastModified: 0,
      hasGPS: false,
      hasPreview: false,
    };
    usePhotoStore.getState().upsertPhoto(clientRecord);
    expect(usePhotoStore.getState().photos.has('client-hash-1')).toBe(true);

    const serverRecord = { ...clientRecord, id: 'api:99' };
    usePhotoStore.getState().reconcileId('client-hash-1', serverRecord);

    const { photos } = usePhotoStore.getState();
    expect(photos.has('client-hash-1')).toBe(false);
    expect(photos.has('api:99')).toBe(true);
    expect(photos.size).toBe(1);
  });

  it('updates selectedPhotoId when it referenced the old id', () => {
    const clientRecord = {
      id: 'client-hash-2',
      fileName: 'b.jpg',
      relativePath: 'b.jpg',
      size: 10,
      lastModified: 0,
      hasGPS: false,
      hasPreview: false,
    };
    usePhotoStore.getState().upsertPhoto(clientRecord);
    usePhotoStore.getState().setSelectedPhoto('client-hash-2');

    usePhotoStore.getState().reconcileId('client-hash-2', { ...clientRecord, id: 'api:5' });

    expect(usePhotoStore.getState().selectedPhotoId).toBe('api:5');
  });
});
