import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPage } from '../src/pages/AdminPage';
import { useAdminStore } from '../src/state/adminStore';
import { usePhotoStore } from '../src/state/photoStore';
import { useAuthStore } from '../src/state/authStore';
import { resetCsrfTokenCache } from '../src/lib/api/http';

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

function resetAll() {
  useAdminStore.setState({ status: 'idle', username: null, error: null });
  resetCsrfTokenCache();
}

describe('AdminPage (fully self-contained, like SharePage — never touches the main app state)', () => {
  beforeEach(() => {
    resetAll();
    usePhotoStore.setState({
      photos: new Map(),
      status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
      dateFilter: null,
      selectedPhotoId: null,
      searchFilters: {},
    });
    useAuthStore.setState({ status: 'idle', user: null, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetAll();
  });

  it('shows the login form when there is no admin session, and never touches the guest-mode/auth stores', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/admin/me')) return jsonResponse({ error: 'unauthorized' }, 401);
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminPage />);

    await waitFor(() => expect(screen.getByLabelText(/admin login/i)).toBeInTheDocument());
    expect(usePhotoStore.getState().photos.size).toBe(0);
    expect(useAuthStore.getState().status).toBe('idle');
  });

  it('shows a 401 error on failed admin login and stays on the login form', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/admin/me')) return jsonResponse({ error: 'unauthorized' }, 401);
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/admin/login')) {
        return jsonResponse({ error: 'invalid_credentials', message: 'Invalid username or password.' }, 401);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminPage />);
    await waitFor(() => expect(screen.getByLabelText(/admin login/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid username or password.'));
    expect(screen.getByLabelText(/admin login/i)).toBeInTheDocument();
  });

  it('renders the dashboard (users tab) with the admin username and a working logout on successful login', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/admin/me')) return jsonResponse({ error: 'unauthorized' }, 401);
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.endsWith('/api/admin/login')) return jsonResponse({ username: 'operator' });
      if (url.includes('/api/admin/users')) {
        return jsonResponse({
          users: [
            {
              id: 1,
              email: 'someone@example.com',
              status: 'pending',
              storageQuotaBytes: null,
              createdAt: '2026-01-01 00:00:00',
              approvedAt: null,
              usedBytes: 0,
              hasShareLink: false,
              shareLinkCreatedAt: null,
            },
          ],
          total: 1,
          page: 1,
          perPage: 25,
        });
      }
      if (url.endsWith('/api/admin/settings')) {
        return jsonResponse({ defaultStorageQuotaBytes: 104857600, uploadsEnabled: true, updatedAt: '2026-01-01 00:00:00' });
      }
      if (url.endsWith('/api/admin/logout')) return jsonResponse({ ok: true });
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminPage />);
    await waitFor(() => expect(screen.getByLabelText(/admin login/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByText('someone@example.com')).toBeInTheDocument());
    expect(screen.getByText('operator')).toBeInTheDocument();
    // Never renders a raw share-link URL/token — only existence + timestamp.
    expect(screen.getByText('No share link')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    await waitFor(() => expect(screen.getByLabelText(/admin login/i)).toBeInTheDocument());

    // The main app's own auth/photo stores were never touched by any of this.
    expect(usePhotoStore.getState().photos.size).toBe(0);
    expect(useAuthStore.getState().status).toBe('idle');
  });
});
