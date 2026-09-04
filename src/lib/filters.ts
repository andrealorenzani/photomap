import type { PhotoRecord } from '../types';

export type HasLocationFilter = 'any' | 'located' | 'unlocated';

/**
 * Date-range/camera/has-location search filters. Client-side only, orthogonal to the existing
 * timeline-click `dateFilter` in photoStore.ts (that one continues to drive click-to-open the
 * thumbnail strip unchanged); the two compose (search narrows the base set the timeline itself
 * is built from). Ships identically in both guest and account mode — no backend query-param
 * filtering exists or is needed, since `GET /api/photos` already returns the full list.
 */
export interface SearchFilters {
  dateStart?: Date;
  dateEnd?: Date;
  cameraMake?: string;
  cameraModel?: string;
  hasLocation?: HasLocationFilter;
}

export function applyFilters(photos: PhotoRecord[], filters: SearchFilters): PhotoRecord[] {
  return photos.filter((photo) => {
    if (filters.dateStart || filters.dateEnd) {
      if (!photo.takenAtISO) return false;
      const takenAt = new Date(photo.takenAtISO).getTime();
      if (filters.dateStart && takenAt < filters.dateStart.getTime()) return false;
      if (filters.dateEnd && takenAt > filters.dateEnd.getTime()) return false;
    }

    if (filters.cameraMake && photo.cameraMake !== filters.cameraMake) return false;
    if (filters.cameraModel && photo.cameraModel !== filters.cameraModel) return false;

    if (filters.hasLocation === 'located' && !photo.hasGPS) return false;
    if (filters.hasLocation === 'unlocated' && photo.hasGPS) return false;

    return true;
  });
}

export function distinctCameraMakes(photos: PhotoRecord[]): string[] {
  return Array.from(
    new Set(photos.map((p) => p.cameraMake).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b));
}

export function distinctCameraModels(photos: PhotoRecord[]): string[] {
  return Array.from(
    new Set(photos.map((p) => p.cameraModel).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b));
}
