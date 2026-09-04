import { apiRequest, ApiError } from './http';

export interface ApiUser {
  id: number;
  email: string;
}

export function register(email: string, password: string): Promise<ApiUser> {
  return apiRequest<ApiUser>('/register', { method: 'POST', json: { email, password } });
}

export function login(email: string, password: string): Promise<ApiUser> {
  return apiRequest<ApiUser>('/login', { method: 'POST', json: { email, password } });
}

export function logout(): Promise<void> {
  return apiRequest<{ ok: boolean }>('/logout', { method: 'POST', json: {} }).then(() => undefined);
}

/** Returns null (rather than throwing) for the expected "not logged in" 401 case. */
export async function me(): Promise<ApiUser | null> {
  try {
    return await apiRequest<ApiUser>('/me', { method: 'GET' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}
