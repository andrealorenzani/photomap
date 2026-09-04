import { describe, expect, it } from 'vitest';
import { computeMarkerGroups, gridKey } from '../src/lib/grouping';
import type { PhotoRecord } from '../src/types';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function photo(id: string, lat: number, lon: number): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 100,
    lastModified: 0,
    lat,
    lon,
    hasGPS: true,
    hasPreview: false,
  };
}

const METERS_PER_DEGREE_LAT = 111320;

describe('gridKey', () => {
  // These tests anchor the base coordinate exactly on a grid-cell center (an integer multiple
  // of the cell step), so an offset of up to ±0.5 cells is guaranteed to stay in the same
  // bucket and an offset past that boundary is guaranteed to land in a different one. Using
  // arbitrary real-world coordinates instead would make the "inside/outside" outcome depend on
  // where that specific point happens to fall relative to an (arbitrary) grid line — a boundary
  // artifact inherent to any fixed-grid bucketing scheme, not something worth asserting on.
  const latStep = 50 / METERS_PER_DEGREE_LAT;
  const baseLat = 40 * latStep; // exact cell center

  it('buckets two points <50m apart (well within the same cell) into the same key', () => {
    const nearLat = baseLat + latStep * 0.3; // ~15m away, safely inside the same cell
    expect(haversineMeters(baseLat, 2.3522, nearLat, 2.3522)).toBeLessThan(50);
    expect(gridKey(baseLat, 2.3522)).toBe(gridKey(nearLat, 2.3522));
  });

  it('buckets two points >50m apart (crossing a cell boundary) into different keys', () => {
    const farLat = baseLat + latStep * 1.5; // crosses at least one cell boundary
    expect(haversineMeters(baseLat, 2.3522, farLat, 2.3522)).toBeGreaterThan(50);
    expect(gridKey(baseLat, 2.3522)).not.toBe(gridKey(farLat, 2.3522));
  });

  it('is deterministic (same inputs -> same output)', () => {
    const key1 = gridKey(10.12345, 20.6789);
    const key2 = gridKey(10.12345, 20.6789);
    expect(key1).toBe(key2);
  });

  it('applies latitude correction so longitude cells stay ~50m wide at high latitude', () => {
    // At 70 degrees latitude, naive fixed-decimal-degree rounding would make longitude cells
    // ~3x too wide in real-world meters (cos(70deg) ~= 0.342). Verify our grid still separates
    // two points that cross a longitude cell boundary at this latitude, and keeps points well
    // within the same cell together.
    const lat = 70;
    const lonStep = 50 / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
    const baseLon = 40 * lonStep; // exact cell center

    const lon2 = baseLon + lonStep * 1.5; // crosses a cell boundary
    expect(gridKey(lat, baseLon)).not.toBe(gridKey(lat, lon2));

    const lon3 = baseLon + lonStep * 0.3; // well within the same cell
    expect(gridKey(lat, baseLon)).toBe(gridKey(lat, lon3));
  });
});

describe('computeMarkerGroups', () => {
  it('groups nearby photos into a single marker with a centroid location', () => {
    const photos = [photo('p1', 48.8566, 2.3522), photo('p2', 48.85662, 2.3522)];
    const groups = computeMarkerGroups(photos);
    expect(groups).toHaveLength(1);
    expect(groups[0].photoIds.sort()).toEqual(['p1', 'p2']);
  });

  it('creates separate markers for photos far apart', () => {
    const photos = [photo('p1', 48.8566, 2.3522), photo('p2', 40.7128, -74.006)];
    const groups = computeMarkerGroups(photos);
    expect(groups).toHaveLength(2);
  });

  it('excludes photos without GPS', () => {
    const noGps: PhotoRecord = {
      id: 'p3',
      fileName: 'p3.jpg',
      relativePath: 'p3.jpg',
      size: 10,
      lastModified: 0,
      hasGPS: false,
      hasPreview: false,
    };
    const groups = computeMarkerGroups([photo('p1', 48.8566, 2.3522), noGps]);
    expect(groups).toHaveLength(1);
    expect(groups[0].photoIds).toEqual(['p1']);
  });
});
