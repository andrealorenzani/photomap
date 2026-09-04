import { apiRequest } from './http';
import type { ApiPhotoDTO } from './photosApi';

export function fetchShare(token: string): Promise<ApiPhotoDTO[]> {
  return apiRequest<{ photos: ApiPhotoDTO[] }>(`/share/${encodeURIComponent(token)}`, { method: 'GET' }).then(
    (r) => r.photos
  );
}
