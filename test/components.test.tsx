import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhotoThumbStrip } from '../src/components/PhotoThumbStrip';
import { FullSizeViewer } from '../src/components/FullSizeViewer';
import { StatusPanel } from '../src/components/StatusPanel';
import { PrivacyNote } from '../src/components/PrivacyNote';
import { TopBanner } from '../src/components/TopBanner';
import { usePhotoStore } from '../src/state/photoStore';
import { useAuthStore } from '../src/state/authStore';
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
      status: { total: 10, processed: 4, withGPS: 3, withoutGPS: 1, skipped: 0, parsing: true, uploadFailures: 0 },
    });
    render(<StatusPanel />);
    expect(screen.getByText('Processed: 4')).toBeInTheDocument();
    expect(screen.getByText('With GPS: 3')).toBeInTheDocument();
    expect(screen.getByText('Discarded (No GPS): 1')).toBeInTheDocument();
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
        uploadFailures: 0,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  });
}

async function resetAuthAndRepoState() {
  const { resetCsrfTokenCache } = await import('../src/lib/api/http');
  const { setActiveRepository, IndexedDbPhotoRepository } = await import('../src/lib/db');
  resetCsrfTokenCache();
  setActiveRepository(new IndexedDbPhotoRepository());
  useAuthStore.setState({ status: 'idle', user: null, error: null });
}

describe('TopBanner (real login/register, account-mode controls)', () => {
  beforeEach(async () => {
    await resetAuthAndRepoState();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await resetAuthAndRepoState();
  });

  it('renders the wordmark and a real, functional login/register form in guest mode, with zero fetch calls before any login action', () => {
    const fetchSpy = installFetchMock(() => {
      throw new Error('fetch should never be called before the user submits the form');
    });

    render(<TopBanner />);
    expect(screen.getByText('Photomap')).toBeInTheDocument();

    const email = screen.getByPlaceholderText('Email') as HTMLInputElement;
    const password = screen.getByPlaceholderText('Password') as HTMLInputElement;
    const button = screen.getByRole('button', { name: /log in/i });

    expect(email).not.toBeDisabled();
    expect(password).not.toBeDisabled();
    expect(button).not.toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('successful login switches to the authenticated account view (email, copy-share-link, delete-account)', async () => {
    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/login') && init?.method === 'POST') {
        return jsonResponse({ id: 1, email: 'user@example.com' });
      }
      if (url.endsWith('/api/photos')) return jsonResponse({ photos: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<TopBanner />);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByTestId('account-email')).toHaveTextContent('user@example.com'));
    expect(screen.getByRole('button', { name: /copy share link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('login failure surfaces the backend error message and stays in the logged-out form', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/login')) {
        return jsonResponse({ error: 'invalid_credentials', message: 'Invalid email or password.' }, 401);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<TopBanner />);
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'));
    expect(screen.queryByTestId('account-email')).not.toBeInTheDocument();
  });

  it('copy-share-link calls POST /api/share-links and copies the full URL to the clipboard', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { email: 'user@example.com' }, error: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/share-links') && init?.method === 'POST') {
        return jsonResponse({ id: 1, token: 'abc123', url: '/share/abc123' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<TopBanner />);
    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/share/abc123')));
  });

  it('delete-account requires a confirm step, then calls DELETE /api/account and reverts to the guest view', async () => {
    useAuthStore.setState({ status: 'authenticated', user: { email: 'user@example.com' }, error: null });

    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/account') && init?.method === 'DELETE') return jsonResponse({ ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<TopBanner />);
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('guest'));
    await waitFor(() => expect(screen.getByPlaceholderText('Email')).toBeInTheDocument());
  });
});

describe('TopBanner registration notice (gates account creation on acknowledgment)', () => {
  beforeEach(async () => {
    await resetAuthAndRepoState();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await resetAuthAndRepoState();
  });

  function switchToRegisterMode() {
    fireEvent.click(screen.getByRole('button', { name: /need an account\? register/i }));
  }

  it('submitting the register form shows the notice and does not create the account yet', () => {
    const fetchSpy = installFetchMock(() => {
      throw new Error('fetch should never be called before the notice is acknowledged');
    });

    render(<TopBanner />);
    switchToRegisterMode();
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));

    expect(screen.getByRole('dialog', { name: /before you register/i })).toBeInTheDocument();
    expect(screen.getByText(/admin approval is required/i)).toBeInTheDocument();
    expect(screen.getByText(/private by default/i)).toBeInTheDocument();
    expect(screen.getByText(/notification address/i)).toBeInTheDocument();
    expect(screen.getByText(/guest mode uploads nothing/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('acknowledging the notice actually registers the account', async () => {
    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/register') && init?.method === 'POST') {
        return jsonResponse({ id: 1, email: 'new@example.com' });
      }
      if (url.endsWith('/api/login') && init?.method === 'POST') {
        return jsonResponse({ id: 1, email: 'new@example.com' });
      }
      if (url.endsWith('/api/photos')) return jsonResponse({ photos: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<TopBanner />);
    switchToRegisterMode();
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));

    fireEvent.click(screen.getByRole('button', { name: /i understand, create my account/i }));

    await waitFor(() => expect(screen.getByTestId('account-email')).toHaveTextContent('new@example.com'));
    expect(screen.queryByRole('dialog', { name: /before you register/i })).not.toBeInTheDocument();
  });

  it('cancelling the notice closes it without ever registering', () => {
    const fetchSpy = installFetchMock(() => {
      throw new Error('fetch should never be called when the notice is cancelled');
    });

    render(<TopBanner />);
    switchToRegisterMode();
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByRole('dialog', { name: /before you register/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
