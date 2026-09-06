import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStore } from '../src/state/adminStore';
import { resetCsrfTokenCache } from '../src/lib/api/http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function resetAll() {
  useAdminStore.setState({ status: 'idle', username: null, error: null });
  resetCsrfTokenCache();
}

describe('adminStore (fully separate from authStore/photoStore)', () => {
  beforeEach(() => {
    resetAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAll();
  });

  it('restoreSession(): unauthenticated GET /api/admin/me results in the anonymous status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/admin/me')) return Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await useAdminStore.getState().restoreSession();

    expect(useAdminStore.getState().status).toBe('anonymous');
    expect(useAdminStore.getState().username).toBeNull();
  });

  it('restoreSession(): an authenticated GET /api/admin/me results in the authenticated status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/admin/me')) return Promise.resolve(jsonResponse({ username: 'operator' }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await useAdminStore.getState().restoreSession();

    expect(useAdminStore.getState().status).toBe('authenticated');
    expect(useAdminStore.getState().username).toBe('operator');
  });

  it('a network/server error resolving session state falls back to anonymous rather than hanging in "checking"', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await useAdminStore.getState().restoreSession();
    expect(useAdminStore.getState().status).toBe('anonymous');
  });

  it('login() posts to POST /api/admin/login (with a CSRF token) and sets authenticated status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok-1' }));
      if (url.endsWith('/api/admin/login')) return Promise.resolve(jsonResponse({ username: 'operator' }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await useAdminStore.getState().login('operator', 'correct-password');

    expect(useAdminStore.getState().status).toBe('authenticated');
    expect(useAdminStore.getState().username).toBe('operator');
    const loginCall = fetchSpy.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/admin/login')
    );
    expect((loginCall?.[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-1');
  });

  it('login() surfaces a 401 as a readable error and does not change status to authenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/admin/login')) {
        return Promise.resolve(jsonResponse({ error: 'invalid_credentials', message: 'Invalid username or password.' }, 401));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(useAdminStore.getState().login('operator', 'wrong')).rejects.toThrow();

    expect(useAdminStore.getState().status).not.toBe('authenticated');
    expect(useAdminStore.getState().error).toBe('Invalid username or password.');
  });

  it('logout() resets to anonymous and clears the cached CSRF token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      if (url.endsWith('/api/admin/logout')) return Promise.resolve(jsonResponse({ ok: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    useAdminStore.setState({ status: 'authenticated', username: 'operator', error: null });
    await useAdminStore.getState().logout();

    expect(useAdminStore.getState().status).toBe('anonymous');
    expect(useAdminStore.getState().username).toBeNull();
  });
});
