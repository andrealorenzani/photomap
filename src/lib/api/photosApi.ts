import { apiRequest } from './http';

/** Shape of a photo as returned by the backend's PhotoPresenter. */
export interface ApiPhotoDTO {
  id: number;
  lat: number | null;
  lon: number | null;
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  createdAt: string;
  thumbnailUrl: string;
  previewUrl: string;
}

export function listPhotos(): Promise<ApiPhotoDTO[]> {
  return apiRequest<{ photos: ApiPhotoDTO[] }>('/photos', { method: 'GET' }).then((r) => r.photos);
}

export interface UploadFields {
  lat?: number;
  lon?: number;
  takenAt?: string;
  cameraMake?: string;
  cameraModel?: string;
}

export function uploadPhoto(blob: Blob, fileName: string, fields: UploadFields): Promise<ApiPhotoDTO> {
  const formData = new FormData();
  formData.append('photo', blob, fileName);
  if (fields.lat !== undefined) formData.append('lat', String(fields.lat));
  if (fields.lon !== undefined) formData.append('lon', String(fields.lon));
  if (fields.takenAt) formData.append('takenAt', fields.takenAt);
  if (fields.cameraMake) formData.append('cameraMake', fields.cameraMake);
  if (fields.cameraModel) formData.append('cameraModel', fields.cameraModel);

  return apiRequest<ApiPhotoDTO>('/photos', { method: 'POST', formData });
}

export function deletePhoto(id: number): Promise<void> {
  return apiRequest<{ ok: boolean }>(`/photos/${id}`, { method: 'DELETE' }).then(() => undefined);
}

export function updatePhotoLocation(id: number, lat: number, lon: number): Promise<ApiPhotoDTO> {
  return apiRequest<ApiPhotoDTO>(`/photos/${id}`, { method: 'PATCH', json: { lat, lon } });
}
