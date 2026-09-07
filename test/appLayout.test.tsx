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

/**
 * Regression coverage for the item-3/4 layout restructuring: StatusPanel used to be an
 * absolutely-positioned child sharing the exact same top-right corner (top/right/z-index) as
 * MapStyleToggle, on the same `.map-view`/`.upload-control` overlay stack -- a real,
 * reproducible visual overlap. It now lives in the App's normally-flowed side region instead.
 */
describe('App layout (StatusPanel/MapStyleToggle overlap fix)', () => {
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

  it('renders StatusPanel outside the map overlay tree, alongside MapStyleToggle only inside it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/me')) return Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401));
      if (url.endsWith('/data/countries-110m.geo.json')) {
        return Promise.resolve(jsonResponse({ type: 'FeatureCollection', features: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    setPath('/');
    render(<Router />);
    await waitFor(() => expect(screen.getByText('Photomap')).toBeInTheDocument());

    const mapView = document.querySelector('.map-view');
    const statusPanel = document.querySelector('.status-panel');
    const mapStyleToggle = document.querySelector('.map-style-toggle');
    const sideRegion = document.querySelector('.app__side-region');

    expect(mapView).toBeTruthy();
    expect(statusPanel).toBeTruthy();
    expect(mapStyleToggle).toBeTruthy();
    expect(sideRegion).toBeTruthy();

    // StatusPanel is no longer inside the map's overlay subtree at all.
    expect(mapView?.contains(statusPanel)).toBe(false);
    // It lives in the new side region instead, in normal document flow.
    expect(sideRegion?.contains(statusPanel)).toBe(true);
    // MapStyleToggle remains the on-map overlay, inside .map-view.
    expect(mapView?.contains(mapStyleToggle)).toBe(true);
  });
});
