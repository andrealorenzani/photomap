import { formatServerDateTime } from './format';
import type { AdminUserStatus, AdminUsersQuery } from './api/adminApi';

/** Pure client-side filter/sort/search state for the admin user list — kept separate from the
 * component so it's trivially unit-testable without rendering anything. */
export interface AdminUsersFilterState {
  q: string;
  status: AdminUserStatus | '';
  sort: 'created_at' | 'email';
  dir: 'asc' | 'desc';
  page: number;
}

export const DEFAULT_ADMIN_USERS_FILTER: AdminUsersFilterState = {
  q: '',
  status: '',
  sort: 'created_at',
  dir: 'desc',
  page: 1,
};

const PER_PAGE = 25;

/** Builds the exact query object `fetchAdminUsers()` sends, given the current filter state. */
export function buildAdminUsersQuery(filters: AdminUsersFilterState): AdminUsersQuery {
  return {
    q: filters.q.trim() || undefined,
    status: filters.status || undefined,
    sort: filters.sort,
    dir: filters.dir,
    page: filters.page,
    perPage: PER_PAGE,
  };
}

/** Toggles sort direction when re-clicking the currently-active sort column, otherwise starts a
 * new column sort at a sensible default direction. */
export function nextSortState(
  current: Pick<AdminUsersFilterState, 'sort' | 'dir'>,
  column: 'created_at' | 'email'
): Pick<AdminUsersFilterState, 'sort' | 'dir'> {
  if (current.sort !== column) {
    return { sort: column, dir: column === 'created_at' ? 'desc' : 'asc' };
  }
  return { sort: column, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * Existence + timestamp only, per the plan's deliberate privacy constraint: the admin console
 * must never render (or even fetch) a share link's raw URL/token, since that would hand the
 * admin de facto access to view that user's private shared photos.
 */
export function formatShareLinkStatus(hasShareLink: boolean, shareLinkCreatedAt: string | null): string {
  if (!hasShareLink) return 'No share link';
  return `Active since ${formatServerDateTime(shareLinkCreatedAt)}`;
}

export function formatUserStatusLabel(status: AdminUserStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending approval';
    case 'active':
      return 'Active';
    case 'disabled':
      return 'Disabled';
    default:
      return status;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
