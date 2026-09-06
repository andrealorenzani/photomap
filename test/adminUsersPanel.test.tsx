import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminUsersPanel } from '../src/components/admin/AdminUsersPanel';
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

const oneUserPage = (overrides: Partial<Record<string, unknown>> = {}) =>
  jsonResponse({
    users: [
      {
        id: 7,
        email: 'pending@example.com',
        status: 'pending',
        storageQuotaBytes: null,
        createdAt: '2026-01-01 00:00:00',
        approvedAt: null,
        usedBytes: 0,
        hasShareLink: true,
        shareLinkCreatedAt: '2026-02-01 00:00:00',
        ...overrides,
      },
    ],
    total: 1,
    page: 1,
    perPage: 25,
  });

describe('AdminUsersPanel', () => {
  beforeEach(() => {
    resetCsrfTokenCache();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads and renders users, with the share-link column showing existence+timestamp only', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={104857600} />);

    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());
    expect(screen.getByText(/Active since/)).toBeInTheDocument();
  });

  it('typing in the search box re-fetches with the q query param', async () => {
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={null} />);
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'pending' } });

    await waitFor(() => {
      const call = fetchSpy.mock.calls
        .map(([input]) => (typeof input === 'string' ? input : input.toString()))
        .find((u) => u.includes('q=pending'));
      expect(call).toBeDefined();
    });
  });

  it('changing the status filter re-fetches with the status query param', async () => {
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={null} />);
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } });

    await waitFor(() => {
      const call = fetchSpy.mock.calls
        .map(([input]) => (typeof input === 'string' ? input : input.toString()))
        .find((u) => u.includes('status=active'));
      expect(call).toBeDefined();
    });
  });

  it('clicking the Email sort header re-fetches sorted by email', async () => {
    const fetchSpy = installFetchMock((url) => {
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={null} />);
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^email/i }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls
        .map(([input]) => (typeof input === 'string' ? input : input.toString()))
        .find((u) => u.includes('sort=email'));
      expect(call).toBeDefined();
    });
  });

  it('activating a user pre-fills the quota input from the global default and confirms via POST activate', async () => {
    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.includes('/api/admin/users/7/activate') && init?.method === 'POST') {
        return oneUserPage({ status: 'active', storageQuotaBytes: 104857600 });
      }
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={104857600} />);
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^activate$/i }));
    const quotaInput = screen.getByLabelText(/storage quota for pending@example.com/i) as HTMLInputElement;
    expect(quotaInput.value).toBe('104857600');

    fireEvent.click(screen.getByRole('button', { name: /confirm activate/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /confirm activate/i })).not.toBeInTheDocument());
  });

  it('disabling a user requires an explicit confirm step before calling POST disable', async () => {
    let disableCalled = false;
    installFetchMock((url, init) => {
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ csrfToken: 'tok' });
      if (url.includes('/api/admin/users/7/disable') && init?.method === 'POST') {
        disableCalled = true;
        return oneUserPage({ status: 'disabled' });
      }
      if (url.includes('/api/admin/users')) return oneUserPage();
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<AdminUsersPanel defaultQuotaBytes={null} />);
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));
    expect(screen.getByText(/disable this account/i)).toBeInTheDocument();
    expect(disableCalled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /yes, disable/i }));

    await waitFor(() => expect(disableCalled).toBe(true));
  });
});
