import { describe, expect, it } from 'vitest';
import {
  adaptiveBinCount,
  binIndexForOffset,
  binIntensity,
  computeBins,
  computeDomain,
  photosInRange,
  photosWithUnknownDate,
} from '../src/lib/timeline';
import type { PhotoRecord } from '../src/types';

function photo(id: string, takenAtISO?: string): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    takenAtISO,
  };
}

describe('computeDomain', () => {
  it('falls back to the current year when there are no photos', () => {
    const now = new Date(2024, 5, 1);
    const domain = computeDomain([], now);
    expect(domain.isFallback).toBe(true);
    expect(domain.min.getFullYear()).toBe(2024);
    expect(domain.max.getFullYear()).toBe(2024);
  });

  it('spans from earliest to latest date across photos', () => {
    const photos = [
      photo('a', '2020-01-01T00:00:00.000Z'),
      photo('b', '2022-06-15T00:00:00.000Z'),
      photo('c', '2021-03-03T00:00:00.000Z'),
    ];
    const domain = computeDomain(photos);
    expect(domain.isFallback).toBe(false);
    expect(domain.min.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(domain.max.toISOString()).toBe('2022-06-15T00:00:00.000Z');
  });

  it('ignores photos with no parseable date when computing the domain', () => {
    const photos = [photo('a', '2020-01-01T00:00:00.000Z'), photo('b', undefined)];
    const domain = computeDomain(photos);
    expect(domain.min.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('adaptiveBinCount', () => {
  it('clamps to at least 12 bins', () => {
    const domain = computeDomain([photo('a', '2020-01-01T00:00:00.000Z')]);
    expect(adaptiveBinCount(10, domain)).toBeGreaterThanOrEqual(12);
  });

  it('clamps to at most 366 bins', () => {
    const domain = computeDomain([
      photo('a', '2000-01-01T00:00:00.000Z'),
      photo('b', '2020-01-01T00:00:00.000Z'),
    ]);
    expect(adaptiveBinCount(100000, domain)).toBeLessThanOrEqual(366);
  });
});

describe('computeBins', () => {
  it('buckets photos into their correct bin (single-day span)', () => {
    const domain = {
      min: new Date('2023-01-01T00:00:00.000Z'),
      max: new Date('2023-01-02T00:00:00.000Z'),
      isFallback: false,
    };
    const photos = [
      photo('a', '2023-01-01T01:00:00.000Z'),
      photo('b', '2023-01-01T23:00:00.000Z'),
    ];
    const bins = computeBins(photos, domain, 24);
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(2);
  });

  it('produces sane non-overlapping bins for a multi-year span', () => {
    const domain = computeDomain([
      photo('a', '2000-01-01T00:00:00.000Z'),
      photo('b', '2020-01-01T00:00:00.000Z'),
    ]);
    const bins = computeBins([], domain, 20);
    expect(bins).toHaveLength(20);
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i].start.getTime()).toBe(bins[i - 1].end.getTime());
    }
  });

  it('does not double count or drop a photo exactly on a bin boundary', () => {
    const domain = { min: new Date(0), max: new Date(1000), isFallback: false };
    const photos = [photo('a', new Date(500).toISOString())];
    const bins = computeBins(photos, domain, 10);
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(1);
  });
});

describe('binIntensity', () => {
  it('returns 0 for an empty bin', () => {
    expect(binIntensity(0, 10)).toBe(0);
  });

  it('returns 1 for the max bin', () => {
    expect(binIntensity(10, 10)).toBe(1);
  });

  it('log-scales so one very busy bin does not flatten smaller bins to near-zero', () => {
    // Linear scaling would make count=2 look like ~0.2% of count=1000; log scaling keeps it
    // visually distinguishable.
    const linear = 2 / 1000;
    const logScaled = binIntensity(2, 1000);
    expect(logScaled).toBeGreaterThan(linear * 10);
  });
});

describe('binIndexForOffset', () => {
  it('maps offset 0 to bin 0', () => {
    expect(binIndexForOffset(0, 100, 10)).toBe(0);
  });

  it('maps the far right edge to the last bin', () => {
    expect(binIndexForOffset(99, 100, 10)).toBe(9);
  });

  it('maps the middle to a middle bin', () => {
    expect(binIndexForOffset(50, 100, 10)).toBe(5);
  });
});

describe('photosWithUnknownDate / photosInRange', () => {
  it('identifies photos with no parseable date as unknown-date', () => {
    const photos = [photo('a', '2020-01-01T00:00:00.000Z'), photo('b', undefined), photo('c', 'not-a-date')];
    const unknown = photosWithUnknownDate(photos);
    expect(unknown.map((p) => p.id).sort()).toEqual(['b', 'c']);
  });

  it('filters photos within [start, end) and excludes photos with no date', () => {
    const photos = [
      photo('a', '2020-01-01T00:00:00.000Z'),
      photo('b', '2020-06-01T00:00:00.000Z'),
      photo('c', undefined),
    ];
    const inRange = photosInRange(photos, new Date('2020-01-01'), new Date('2020-12-31'));
    expect(inRange.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
