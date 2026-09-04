import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Router } from '../src/Router';
import { useAuthStore } from '../src/state/authStore';
import { usePhotoStore } from '../src/state/photoStore';
import { getActiveRepository, IndexedDbPhotoRepository, setActiveRepository } from '../src/lib/db';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setPath(pathname: string) {
  window.history.pushState({}, '', pathname);
}

describe('Router (hand-rolled path matcher)', () => {
  const previousRepository = getActiveRepository();

  beforeEach(() => {
    useAuthStore.setState({ status: 'idle', user: null, error: null });
    usePhotoStore.setState({
      photos: new Map(),
      status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
      dateFilter: null,
      selectedPhotoId: null,
      searchFilters: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setActiveRepository(previousRepository ?? new IndexedDbPhotoRepository());
    setPath('/');
  });

  it('renders the main App at "/" (regression: normal route unaffected)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/me')) return Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401));
      throw new Error(`unexpected fetch: ${url}`);
    });

    setPath('/');
    render(<Router />);

    await waitFor(() => expect(screen.getByText('Photomap')).toBeInTheDocument());
    expect(screen.getByLabelText('Select a photo folder')).toBeInTheDocument();
    expect(screen.queryByTestId('share-page')).not.toBeInTheDocument();
  });

  it('renders SharePage at "/share/:token"', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/share/tok123')) return Promise.resolve(jsonResponse({ photos: [] }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    setPath('/share/tok123');
    render(<Router />);

    await waitFor(() => expect(screen.getByTestId('share-page')).toBeInTheDocument());
    expect(screen.queryByLabelText('Select a photo folder')).not.toBeInTheDocument();
  });
});
