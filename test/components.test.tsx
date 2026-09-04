import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhotoThumbStrip } from '../src/components/PhotoThumbStrip';
import { FullSizeViewer } from '../src/components/FullSizeViewer';
import { StatusPanel } from '../src/components/StatusPanel';
import { PrivacyNote } from '../src/components/PrivacyNote';
import { TopBanner } from '../src/components/TopBanner';
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
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false },
    dateFilter: null,
    selectedPhotoId: null,
  });
}

describe('PhotoThumbStrip', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows all N thumbnails sorted chronologically', () => {
    const photos = [
      photo('late', { takenAtISO: '2023-06-01T00:00:00.000Z' }),
      photo('early', { takenAtISO: '2020-01-01T00:00:00.000Z' }),
      photo('mid', { takenAtISO: '2021-01-01T00:00:00.000Z' }),
    ];
    render(<PhotoThumbStrip photos={photos} />);
    const thumbs = screen.getAllByTestId('photo-thumb');
    expect(thumbs.map((el) => el.getAttribute('data-photo-id'))).toEqual(['early', 'mid', 'late']);
  });

  it('renders correctly for a single-photo marker', () => {
    render(<PhotoThumbStrip photos={[photo('only')]} />);
    expect(screen.getAllByTestId('photo-thumb')).toHaveLength(1);
  });

  it('shows an empty state for zero photos', () => {
    render(<PhotoThumbStrip photos={[]} />);
    expect(screen.getByText(/no photos to show/i)).toBeInTheDocument();
  });

  it('deleting from the thumbnail strip removes the photo from state immediately', async () => {
    usePhotoStore.getState().upsertPhoto(photo('p1', { takenAtISO: '2020-01-01T00:00:00.000Z' }));
    usePhotoStore.getState().upsertPhoto(photo('p2', { takenAtISO: '2020-02-01T00:00:00.000Z' }));

    function Harness() {
      const photos = Array.from(usePhotoStore((s) => s.photos).values());
      return <PhotoThumbStrip photos={photos} />;
    }
    render(<Harness />);
    expect(screen.getAllByTestId('photo-thumb')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Delete photo p1.jpg'));

    // removePhoto persists to IndexedDB before updating in-memory state; deletion is immediate
    // from the user's perspective (no reload needed) but resolves asynchronously.
    await waitFor(() => expect(screen.getAllByTestId('photo-thumb')).toHaveLength(1));
    expect(usePhotoStore.getState().photos.has('p1')).toBe(false);
  });
});

describe('FullSizeViewer', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no photo is selected', () => {
    render(<FullSizeViewer />);
    expect(screen.queryByTestId('full-size-viewer')).not.toBeInTheDocument();
  });

  it('shows the datetime overlay and no place name / lat-long label', () => {
    usePhotoStore.getState().upsertPhoto(
      photo('p1', { takenAtISO: '2023-06-15T10:30:00.000Z', lat: 45.4642, lon: 9.1914, hasGPS: true })
    );
    usePhotoStore.getState().setSelectedPhoto('p1');

    render(<FullSizeViewer />);
    const viewer = screen.getByTestId('full-size-viewer');
    expect(viewer).toBeInTheDocument();
    expect(viewer.textContent).not.toMatch(/45\.4642/);
    expect(viewer.textContent).not.toMatch(/9\.1914/);
  });

  it('delete action removes the photo and closes the viewer', async () => {
    usePhotoStore.getState().upsertPhoto(photo('p1', { takenAtISO: '2023-01-01T00:00:00.000Z' }));
    usePhotoStore.getState().setSelectedPhoto('p1');

    render(<FullSizeViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(usePhotoStore.getState().selectedPhotoId).toBeNull();
    await waitFor(() => expect(usePhotoStore.getState().photos.has('p1')).toBe(false));
  });
});

describe('StatusPanel', () => {
  beforeEach(() => resetStore());
  afterEach(() => cleanup());

  it('renders live processed/withGPS/withoutGPS counts', () => {
    usePhotoStore.setState({
      status: { total: 10, processed: 4, withGPS: 3, withoutGPS: 1, skipped: 0, parsing: true },
    });
    render(<StatusPanel />);
    expect(screen.getByText('Processed: 4')).toBeInTheDocument();
    expect(screen.getByText('With GPS: 3')).toBeInTheDocument();
    expect(screen.getByText('Without GPS: 1')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows a storage warning message when set', () => {
    usePhotoStore.setState({
      status: {
        total: 1,
        processed: 1,
        withGPS: 0,
        withoutGPS: 1,
        skipped: 0,
        parsing: false,
        storageWarning: 'Storage is full',
      },
    });
    render(<StatusPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Storage is full');
  });
});

describe('PrivacyNote', () => {
  afterEach(() => cleanup());

  it('always shows the privacy statement', () => {
    render(<PrivacyNote />);
    expect(screen.getByText('Guest mode: your photos never leave this device.')).toBeInTheDocument();
  });
});

describe('TopBanner (inert auth placeholder)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the wordmark and disabled, non-functional login controls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called from the login placeholder');
    });

    render(<TopBanner />);
    expect(screen.getByText('Photomap')).toBeInTheDocument();

    const username = screen.getByPlaceholderText('Username') as HTMLInputElement;
    const password = screen.getByPlaceholderText('Password') as HTMLInputElement;
    const button = screen.getByRole('button', { name: /login \/ register/i });

    expect(username).toBeDisabled();
    expect(password).toBeDisabled();
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
