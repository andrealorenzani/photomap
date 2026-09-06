import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADMIN_USERS_FILTER,
  buildAdminUsersQuery,
  formatBytes,
  formatShareLinkStatus,
  formatUserStatusLabel,
  nextSortState,
} from '../src/lib/adminUsers';

describe('buildAdminUsersQuery', () => {
  it('omits empty/default fields from the query', () => {
    const query = buildAdminUsersQuery(DEFAULT_ADMIN_USERS_FILTER);
    expect(query).toEqual({
      q: undefined,
      status: undefined,
      sort: 'created_at',
      dir: 'desc',
      page: 1,
      perPage: 25,
    });
  });

  it('trims whitespace from the search term and passes through status/sort/dir/page', () => {
    const query = buildAdminUsersQuery({
      q: '  someone@example.com  ',
      status: 'pending',
      sort: 'email',
      dir: 'asc',
      page: 3,
    });
    expect(query.q).toBe('someone@example.com');
    expect(query.status).toBe('pending');
    expect(query.sort).toBe('email');
    expect(query.dir).toBe('asc');
    expect(query.page).toBe(3);
  });
});

describe('nextSortState', () => {
  it('switches to a new column at a sensible default direction', () => {
    expect(nextSortState({ sort: 'created_at', dir: 'desc' }, 'email')).toEqual({
      sort: 'email',
      dir: 'asc',
    });
    expect(nextSortState({ sort: 'email', dir: 'asc' }, 'created_at')).toEqual({
      sort: 'created_at',
      dir: 'desc',
    });
  });

  it('toggles direction when re-clicking the already-active column', () => {
    expect(nextSortState({ sort: 'email', dir: 'asc' }, 'email')).toEqual({
      sort: 'email',
      dir: 'desc',
    });
    expect(nextSortState({ sort: 'email', dir: 'desc' }, 'email')).toEqual({
      sort: 'email',
      dir: 'asc',
    });
  });
});

describe('formatShareLinkStatus', () => {
  it('never renders a URL/token — existence + timestamp only', () => {
    expect(formatShareLinkStatus(false, null)).toBe('No share link');
    const formatted = formatShareLinkStatus(true, '2026-08-01 12:00:00');
    expect(formatted).toContain('Active since');
    expect(formatted).not.toMatch(/https?:\/\//);
    expect(formatted).not.toMatch(/[a-f0-9]{16,}/i); // no raw token-looking string
  });
});

describe('formatUserStatusLabel', () => {
  it('renders a human label per status', () => {
    expect(formatUserStatusLabel('pending')).toBe('Pending approval');
    expect(formatUserStatusLabel('active')).toBe('Active');
    expect(formatUserStatusLabel('disabled')).toBe('Disabled');
  });
});

describe('formatBytes', () => {
  it('formats bytes into a human-readable unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB');
  });
});
