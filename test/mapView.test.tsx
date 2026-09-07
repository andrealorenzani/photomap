import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import L from 'leaflet';
import { MapView } from '../src/components/MapView';
import { usePhotoStore } from '../src/state/photoStore';
import type { PhotoRecord } from '../src/types';

function photo(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

function resetStore() {
  usePhotoStore.setState({
    photos: new Map(),
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
    dateFilter: null,
    selectedPhotoId: null,
    searchFilters: {},
  });
}

describe('MapView style toggle', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('defaults to Detailed on first render and renders both toggle options', () => {
    render(<MapView />);
    expect(screen.getByRole('button', { name: 'Detailed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Treasure Map' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggling to Treasure Map applies the treasure CSS class to the map container and persists the choice', () => {
    render(<MapView />);
    fireEvent.click(screen.getByRole('button', { name: 'Treasure Map' }));

    expect(screen.getByTestId('map-container')).toHaveClass('map-view__map--treasure');
    expect(screen.getByRole('button', { name: 'Treasure Map' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('photomap.mapStyle')).toBe('treasure');
  });

  it('toggling styles never changes the underlying photo data set (same PhotoRecords before/after)', () => {
    usePhotoStore.getState().upsertPhoto(photo('p1', { hasGPS: true, lat: 10, lon: 20 }));
    render(<MapView />);

    const before = Array.from(usePhotoStore.getState().photos.values());
    fireEvent.click(screen.getByRole('button', { name: 'Treasure Map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    const after = Array.from(usePhotoStore.getState().photos.values());

    expect(after).toEqual(before);
  });

  it('readOnly disables drop-to-reassign but still renders the map and style toggle', () => {
    render(<MapView readOnly photos={[photo('p1', { hasGPS: true, lat: 1, lon: 1 })]} />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('map-style-toggle')).toBeInTheDocument();
  });
});

describe('MapView world-repeat prevention (minZoom/maxBounds/noWrap)', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates the Leaflet map with minZoom, world maxBounds, and maxBoundsViscosity: 1.0', () => {
    const mapSpy = vi.spyOn(L, 'map');
    render(<MapView />);

    expect(mapSpy).toHaveBeenCalledTimes(1);
    const [, options] = mapSpy.mock.calls[0];
    expect(options).toMatchObject({ minZoom: 2, maxBoundsViscosity: 1.0 });
    expect(options?.maxBounds).toBeInstanceOf(L.LatLngBounds);
    const bounds = options?.maxBounds as L.LatLngBounds;
    expect(bounds.getSouthWest()).toMatchObject({ lat: -90, lng: -180 });
    expect(bounds.getNorthEast()).toMatchObject({ lat: 90, lng: 180 });
  });

  it('creates the tile layer with noWrap: true', () => {
    const tileLayerSpy = vi.spyOn(L, 'tileLayer');
    render(<MapView />);

    expect(tileLayerSpy).toHaveBeenCalled();
    const [, options] = tileLayerSpy.mock.calls[0];
    expect(options).toMatchObject({ noWrap: true });
  });
});
