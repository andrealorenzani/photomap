import type { MarkerGroup, PhotoRecord } from '../types';

const METERS_PER_DEGREE_LAT = 111320;

/**
 * Latitude-corrected grid bucket key for ~cellMeters grouping.
 *
 * Longitude degrees shrink in real-world meters as cos(latitude), so a naive fixed-decimal
 * rounding would produce grid cells that are far too small (in meters) near the poles and
 * roughly correct only near the equator. Instead we compute separate lat/lon step sizes in
 * degrees for the given latitude and bucket by dividing/rounding into those steps.
 */
export function gridKey(lat: number, lon: number, cellMeters = 50): string {
  const latStep = cellMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6); // avoid div-by-zero at poles
  const lonStep = cellMeters / (METERS_PER_DEGREE_LAT * cosLat);

  const latBucket = Math.round(lat / latStep);
  const lonBucket = Math.round(lon / lonStep);
  return `${latBucket}:${lonBucket}`;
}

export function computeMarkerGroups(photos: PhotoRecord[], cellMeters = 50): MarkerGroup[] {
  const groups = new Map<string, { latSum: number; lonSum: number; photoIds: string[] }>();

  for (const photo of photos) {
    if (!photo.hasGPS || photo.lat === undefined || photo.lon === undefined) continue;
    const key = gridKey(photo.lat, photo.lon, cellMeters);
    let group = groups.get(key);
    if (!group) {
      group = { latSum: 0, lonSum: 0, photoIds: [] };
      groups.set(key, group);
    }
    group.latSum += photo.lat;
    group.lonSum += photo.lon;
    group.photoIds.push(photo.id);
  }

  const result: MarkerGroup[] = [];
  for (const [groupKey, group] of groups) {
    const n = group.photoIds.length;
    result.push({
      groupKey,
      lat: group.latSum / n,
      lon: group.lonSum / n,
      photoIds: group.photoIds,
    });
  }
  return result;
}
