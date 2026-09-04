import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ensureCsrfToken, resetCsrfTokenCache } from '../src/lib/api/http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CSRF token lifecycle', () => {
  beforeEach(() => {
    resetCsrfTokenCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the CSRF token once per session and reuses it across multiple mutating calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok-1' }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    await apiRequest('/foo', { method: 'POST', json: {} });
    await apiRequest('/bar', { method: 'DELETE' });
    await apiRequest('/baz', { method: 'PATCH', json: {} });

    const csrfCalls = fetchSpy.mock.calls.filter(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/csrf-token')
    );
    expect(csrfCalls).toHaveLength(1);
  });

  it('attaches X-CSRF-Token on every mutating verb (POST/PUT/PATCH/DELETE) but not GET', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok-1' }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    const getSpy = vi.spyOn(globalThis, 'fetch');
    await apiRequest('/get-me', { method: 'GET' });
    const getCall = getSpy.mock.calls.find(([input]) =>
      (typeof input === 'string' ? input : input.toString()).endsWith('/api/get-me')
    );
    expect((getCall?.[1]?.headers as Record<string, string> | undefined)?.['X-CSRF-Token']).toBeUndefined();

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await apiRequest(`/mutate-${method}`, { method, json: {} });
      const call = getSpy.mock.calls.find(([input]) =>
        (typeof input === 'string' ? input : input.toString()).endsWith(`/api/mutate-${method}`)
      );
      expect((call?.[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-1');
    }
  });

  it('every request (mutating or not) is sent with credentials: include', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) return Promise.resolve(jsonResponse({ csrfToken: 'tok' }));
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    await apiRequest('/get-me', { method: 'GET' });
    await apiRequest('/mutate', { method: 'POST', json: {} });

    for (const call of fetchSpy.mock.calls) {
      expect(call[1]?.credentials).toBe('include');
    }
  });

  it('ensureCsrfToken() resolves with the fetched token string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ csrfToken: 'abc-def' }));
    const token = await ensureCsrfToken();
    expect(token).toBe('abc-def');
  });

  it('a failed csrf-token fetch does not permanently poison the cache — a later call can retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'recovered' }));

    await expect(ensureCsrfToken()).rejects.toThrow('network down');
    const token = await ensureCsrfToken();
    expect(token).toBe('recovered');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
