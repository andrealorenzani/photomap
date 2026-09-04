import { apiRequest } from './http';

export function deleteAccount(): Promise<void> {
  return apiRequest<{ ok: boolean }>('/account', { method: 'DELETE' }).then(() => undefined);
}
