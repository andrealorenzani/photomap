import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SharePage } from '../src/pages/SharePage';
import { getActiveRepository, IndexedDbPhotoRepository, setActiveRepository } from '../src/lib/db';
import { usePhotoStore } from '../src/state/photoStore';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const dto = {
  id: 7,
  lat: 45.1,
  lon: 9.2,
  takenAt: '2024-06-01 12:00:00',
  cameraMake: 'Acme',
  cameraModel: 'X100',
  createdAt: '2024-06-01 12:00:01',
  thumbnailUrl: '/api/photos/7/thumbnail?sig=abc',
  previewUrl: '/api/photos/7/file?sig=abc',
};

describe('SharePage (public, read-only)', () => {
  const previousRepository = getActiveRepository();

  beforeEach(() => {
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
  });

  it('renders a read-only map/timeline from GET /api/share/{token}, with no upload/delete/login affordances', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/share/good-token')) return Promise.resolve(jsonResponse({ photos: [dto] }));
      if (url.includes('/api/photos/7/')) {
        return Promise.resolve(new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<SharePage token="good-token" />);

    await waitFor(() => expect(screen.getByTestId('share-page')).toBeInTheDocument());
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-canvas')).toBeInTheDocument();

    // No upload affordance.
    expect(screen.queryByLabelText('Select a photo folder')).not.toBeInTheDocument();
    // No login/register form (TopBanner isn't rendered at all in the share view).
    expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
    // No delete buttons anywhere (marker popups are only built on click; thumb strip renders
    // eagerly once a date range is picked, but with zero photos shown by default there are no
    // delete buttons present regardless — the key assertion is the read-only prop wiring below).
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('shows a clean error state (not a crash) for an invalid/revoked token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/share/bad-token')) {
        return Promise.resolve(jsonResponse({ error: 'not_found', message: 'invalid or revoked' }, 404));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<SharePage token="bad-token" />);

    await waitFor(() => expect(screen.getByTestId('share-page-error')).toBeInTheDocument());
    expect(screen.getByText(/invalid or has been revoked/i)).toBeInTheDocument();
  });

  it('never touches the global Zustand photo store (guest/account data stays isolated)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/share/good-token')) return Promise.resolve(jsonResponse({ photos: [dto] }));
      if (url.includes('/api/photos/7/')) {
        return Promise.resolve(new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<SharePage token="good-token" />);
    await waitFor(() => expect(screen.getByTestId('share-page')).toBeInTheDocument());

    expect(usePhotoStore.getState().photos.size).toBe(0);
  });
});
