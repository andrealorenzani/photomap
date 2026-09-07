import { apiRequest, ApiError } from './http';

export interface ApiUser {
  id: number;
  email: string;
}

/**
 * `honeypot`/`formRenderedAt` feed the backend's registration anti-spam checks (a hidden
 * off-screen form field a bot would fill in, and a minimum elapsed-time-since-form-render
 * check) -- see TopBanner.tsx for how they're captured, and backend/src/Controllers/
 * AuthController.php's register() for how they're validated.
 */
export function register(
  email: string,
  password: string,
  honeypot: string,
  formRenderedAt: number
): Promise<ApiUser> {
  return apiRequest<ApiUser>('/register', {
    method: 'POST',
    json: { email, password, website: honeypot, formRenderedAt },
  });
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
