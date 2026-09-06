import { apiRequest, ApiError } from './http';

/** The admin console's own identity — a single hardcoded operator account, never a `users` row. */
export interface AdminIdentity {
  username: string;
}

export function adminLogin(username: string, password: string): Promise<AdminIdentity> {
  return apiRequest<AdminIdentity>('/admin/login', { method: 'POST', json: { username, password } });
}

export function adminLogout(): Promise<void> {
  return apiRequest<{ ok: boolean }>('/admin/logout', { method: 'POST', json: {} }).then(() => undefined);
}

/** Returns null (rather than throwing) for the expected "not logged in as admin" 401 case. */
export async function adminMe(): Promise<AdminIdentity | null> {
  try {
    return await apiRequest<AdminIdentity>('/admin/me', { method: 'GET' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export type AdminUserStatus = 'pending' | 'active' | 'disabled';

/**
 * Shape of a user row as returned by AdminUsersController — deliberately never includes a
 * share-link URL/token, only existence (`hasShareLink`) + a timestamp (`shareLinkCreatedAt`).
 */
export interface AdminUser {
  id: number;
  email: string;
  status: AdminUserStatus;
  storageQuotaBytes: number | null;
  createdAt: string;
  approvedAt: string | null;
  usedBytes: number;
  hasShareLink: boolean;
  shareLinkCreatedAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  perPage: number;
}

export interface AdminUsersQuery {
  q?: string;
  status?: AdminUserStatus | '';
  sort?: 'created_at' | 'email';
  dir?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export function fetchAdminUsers(query: AdminUsersQuery = {}): Promise<AdminUsersResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.sort) params.set('sort', query.sort);
  if (query.dir) params.set('dir', query.dir);
  if (query.page) params.set('page', String(query.page));
  if (query.perPage) params.set('perPage', String(query.perPage));
  const qs = params.toString();
  return apiRequest<AdminUsersResponse>(`/admin/users${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

export function activateUser(id: number, storageQuotaBytes: number): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/activate`, {
    method: 'POST',
    json: { storageQuotaBytes },
  });
}

export function disableUser(id: number): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${id}/disable`, { method: 'POST', json: {} });
}

export interface AdminSettings {
  defaultStorageQuotaBytes: number;
  uploadsEnabled: boolean;
  updatedAt: string;
}

export function fetchAdminSettings(): Promise<AdminSettings> {
  return apiRequest<AdminSettings>('/admin/settings', { method: 'GET' });
}

export function updateAdminSettings(
  patch: Partial<Pick<AdminSettings, 'defaultStorageQuotaBytes' | 'uploadsEnabled'>>
): Promise<AdminSettings> {
  return apiRequest<AdminSettings>('/admin/settings', { method: 'PATCH', json: patch });
}

export interface AdminStats {
  usersByStatus: Record<string, number>;
  totalUsers: number;
  totalPhotos: number;
  totalBytesStored: number;
}

export function fetchAdminStats(): Promise<AdminStats> {
  return apiRequest<AdminStats>('/admin/stats', { method: 'GET' });
}
