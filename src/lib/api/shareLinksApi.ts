import { apiRequest } from './http';

export interface ShareLink {
  id: number;
  token: string;
  url: string;
}

export function createShareLink(): Promise<ShareLink> {
  return apiRequest<ShareLink>('/share-links', { method: 'POST', json: {} });
}

export function revokeShareLink(id: number): Promise<void> {
  return apiRequest<{ ok: boolean }>(`/share-links/${id}`, { method: 'DELETE' }).then(() => undefined);
}
