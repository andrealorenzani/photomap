import { useCallback, useEffect, useState } from 'react';
import {
  activateUser,
  disableUser,
  fetchAdminUsers,
  type AdminUser,
  type AdminUserStatus,
} from '../../lib/api/adminApi';
import {
  DEFAULT_ADMIN_USERS_FILTER,
  buildAdminUsersQuery,
  formatBytes,
  formatShareLinkStatus,
  formatUserStatusLabel,
  nextSortState,
  type AdminUsersFilterState,
} from '../../lib/adminUsers';
import { formatServerDateTime } from '../../lib/format';
import './AdminUsersPanel.css';

const STATUS_OPTIONS: Array<{ value: AdminUserStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];

interface ActivateRowState {
  userId: number;
  quota: string;
}

/**
 * Admin user list: search (email), filter (status), sort (created_at/email, asc/desc), and
 * per-row activate (with an editable, default-quota-prefilled quota input)/disable actions.
 * The share-link column deliberately renders only existence + timestamp — never a URL/token
 * (see `formatShareLinkStatus`) — and this component never requests one either, since the API
 * itself never returns one.
 */
export function AdminUsersPanel({ defaultQuotaBytes }: { defaultQuotaBytes: number | null }) {
  const [filters, setFilters] = useState<AdminUsersFilterState>(DEFAULT_ADMIN_USERS_FILTER);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState<ActivateRowState | null>(null);
  const [confirmingDisableId, setConfirmingDisableId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (current: AdminUsersFilterState) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdminUsers(buildAdminUsersQuery(current));
      setUsers(response.users);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  function updateFilters(patch: Partial<AdminUsersFilterState>) {
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  }

  function handleSort(column: 'created_at' | 'email') {
    setFilters((f) => ({ ...f, ...nextSortState(f, column), page: 1 }));
  }

  function startActivate(user: AdminUser) {
    setActionError(null);
    setActivating({
      userId: user.id,
      quota: String(user.storageQuotaBytes ?? defaultQuotaBytes ?? ''),
    });
  }

  async function confirmActivate() {
    if (!activating) return;
    const quotaBytes = Number(activating.quota);
    if (!Number.isFinite(quotaBytes) || quotaBytes < 0) {
      setActionError('Storage quota must be a non-negative number.');
      return;
    }
    setActionError(null);
    try {
      await activateUser(activating.userId, quotaBytes);
      setActivating(null);
      await load(filters);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to activate user.');
    }
  }

  async function confirmDisable(id: number) {
    setActionError(null);
    try {
      await disableUser(id);
      setConfirmingDisableId(null);
      await load(filters);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to disable user.');
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="admin-users">
      <div className="admin-users__controls">
        <input
          type="search"
          aria-label="Search by email"
          placeholder="Search by email…"
          value={filters.q}
          onChange={(e) => updateFilters({ q: e.target.value })}
        />
        <select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) => updateFilters({ status: e.target.value as AdminUserStatus | '' })}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="admin-users__error">
          {error}
        </div>
      )}
      {actionError && (
        <div role="alert" className="admin-users__error">
          {actionError}
        </div>
      )}

      <table className="admin-users__table">
        <thead>
          <tr>
            <th>
              <button type="button" onClick={() => handleSort('email')}>
                Email {filters.sort === 'email' ? (filters.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th>Status</th>
            <th>Storage quota</th>
            <th>Used</th>
            <th>
              <button type="button" onClick={() => handleSort('created_at')}>
                Registered {filters.sort === 'created_at' ? (filters.dir === 'asc' ? '▲' : '▼') : ''}
              </button>
            </th>
            <th>Share link</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} data-testid={`admin-user-row-${user.id}`}>
              <td>{user.email}</td>
              <td>{formatUserStatusLabel(user.status)}</td>
              <td>{user.storageQuotaBytes !== null ? formatBytes(user.storageQuotaBytes) : '—'}</td>
              <td>{formatBytes(user.usedBytes)}</td>
              <td>{formatServerDateTime(user.createdAt)}</td>
              <td>{formatShareLinkStatus(user.hasShareLink, user.shareLinkCreatedAt)}</td>
              <td className="admin-users__actions">
                {user.status !== 'active' && activating?.userId !== user.id && (
                  <button type="button" onClick={() => startActivate(user)}>
                    Activate
                  </button>
                )}
                {activating?.userId === user.id && (
                  <span className="admin-users__activate-form">
                    <label>
                      Quota (bytes)
                      <input
                        type="number"
                        min={0}
                        aria-label={`Storage quota for ${user.email}`}
                        value={activating.quota}
                        onChange={(e) => setActivating({ userId: user.id, quota: e.target.value })}
                      />
                    </label>
                    <button type="button" onClick={confirmActivate}>
                      Confirm activate
                    </button>
                    <button type="button" onClick={() => setActivating(null)}>
                      Cancel
                    </button>
                  </span>
                )}
                {user.status !== 'disabled' && confirmingDisableId !== user.id && (
                  <button type="button" onClick={() => setConfirmingDisableId(user.id)}>
                    Disable
                  </button>
                )}
                {confirmingDisableId === user.id && (
                  <span className="admin-users__confirm-disable">
                    Disable this account?
                    <button type="button" onClick={() => confirmDisable(user.id)}>
                      Yes, disable
                    </button>
                    <button type="button" onClick={() => setConfirmingDisableId(null)}>
                      Cancel
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {!loading && users.length === 0 && (
            <tr>
              <td colSpan={7}>No users match the current filters.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="admin-users__pagination">
        <button
          type="button"
          disabled={filters.page <= 1}
          onClick={() => updateFilters({ page: filters.page - 1 })}
        >
          Previous
        </button>
        <span>
          Page {filters.page} of {lastPage} ({total} users)
        </span>
        <button
          type="button"
          disabled={filters.page >= lastPage}
          onClick={() => updateFilters({ page: filters.page + 1 })}
        >
          Next
        </button>
      </div>
    </div>
  );
}
