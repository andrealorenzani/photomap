import { getApiBaseUrl } from '../config';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Thrown for any non-2xx JSON API response, carrying the parsed error body when available. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let cachedCsrfTokenPromise: Promise<string> | undefined;

/** Fetches (and caches for the session) the CSRF token, per Deep Dives: once per session. */
export function ensureCsrfToken(): Promise<string> {
  if (!cachedCsrfTokenPromise) {
    cachedCsrfTokenPromise = rawFetch('/csrf-token', { method: 'GET' })
      .then((res) => res.json())
      .then((body) => {
        const token = body?.csrfToken;
        if (typeof token !== 'string' || token === '') {
          throw new Error('csrf-token response missing csrfToken');
        }
        return token;
      })
      .catch((err) => {
        // Don't poison the cache with a rejected promise forever — allow retry on next call.
        cachedCsrfTokenPromise = undefined;
        throw err;
      });
  }
  return cachedCsrfTokenPromise;
}

/** Test/logout-only: forces the next ensureCsrfToken() call to fetch a fresh token. */
export function resetCsrfTokenCache(): void {
  cachedCsrfTokenPromise = undefined;
}

function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
  });
}

export interface ApiRequestOptions {
  method?: string;
  json?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
}

/**
 * Core JSON API request helper. Always sends `credentials: 'include'` (required for the
 * session cookie to be sent/received cross-origin-capable, and harmless same-origin). Attaches
 * `X-CSRF-Token` on every mutating verb (POST/PUT/PATCH/DELETE).
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.json || options.formData ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...options.headers };

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
    // Do not set Content-Type: the browser sets the correct multipart boundary itself.
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  if (MUTATING_METHODS.has(method.toUpperCase())) {
    headers['X-CSRF-Token'] = await ensureCsrfToken();
  }

  const response = await rawFetch(path, { method, headers, body });

  const contentType = response.headers.get('Content-Type') ?? '';
  const parsed = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const code = (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string')
      ? parsed.error
      : `http_${response.status}`;
    const message = (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string')
      ? parsed.message
      : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message, parsed);
  }

  return parsed as T;
}
