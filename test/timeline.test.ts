import { describe, expect, it } from 'vitest';
import {
  adaptiveBinCount,
  binIndexForOffset,
  binIntensity,
  computeBins,
  computeDayBins,
  computeDomain,
  computeMonthBins,
  computeYearBins,
  photosInRange,
  photosWithUnknownDate,
  yearsPresent,
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

describe('calendar-axis navigation (year/month/day drill-down, layered on the density heatmap)', () => {
  describe('yearsPresent', () => {
    it('falls back to the current year when there are no dated photos', () => {
      const now = new Date(2026, 0, 1);
      expect(yearsPresent([], now)).toEqual([2026]);
      expect(yearsPresent([photo('a', undefined)], now)).toEqual([2026]);
    });

    it('returns sorted, unique years across photos', () => {
      const photos = [
        photo('a', '2022-03-01T00:00:00.000Z'),
        photo('b', '2020-01-01T00:00:00.000Z'),
        photo('c', '2022-11-01T00:00:00.000Z'),
      ];
      expect(yearsPresent(photos)).toEqual([2020, 2022]);
    });
  });

  describe('computeYearBins', () => {
    it('buckets photos into the correct calendar year, labeled by year', () => {
      // Times deliberately kept well away from a year boundary (noon, not midnight) so this
      // assertion holds regardless of the test runner's local timezone offset.
      const photos = [
        photo('a', '2020-06-01T12:00:00.000Z'),
        photo('b', '2021-06-01T12:00:00.000Z'),
        photo('c', '2020-08-15T12:00:00.000Z'),
      ];
      const bins = computeYearBins(photos, [2020, 2021]);
      expect(bins.map((b) => b.label)).toEqual(['2020', '2021']);
      expect(bins[0].count).toBe(2);
      expect(bins[1].count).toBe(1);
    });
  });

  describe('computeMonthBins', () => {
    it('produces 12 month bins labeled Jan..Dec for the given year only', () => {
      const photos = [
        photo('a', '2020-03-15T12:00:00.000Z'),
        photo('b', '2021-03-15T12:00:00.000Z'), // different year: must not be counted
      ];
      const bins = computeMonthBins(photos, 2020);
      expect(bins).toHaveLength(12);
      expect(bins[0].label).toBe('Jan');
      expect(bins[2].label).toBe('Mar');
      expect(bins[2].count).toBe(1);
      expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(1);
    });
  });

  describe('computeDayBins', () => {
    it('produces one bin per day in the given month, honoring month length', () => {
      const bins = computeDayBins([], 2024, 1); // February 2024 (leap year: 29 days)
      expect(bins).toHaveLength(29);
      expect(bins[0].label).toBe('1');
      expect(bins[28].label).toBe('29');
    });

    it('counts photos into the correct day bin', () => {
      const photos = [photo('a', '2024-02-15T12:00:00.000Z')];
      const bins = computeDayBins(photos, 2024, 1);
      expect(bins[14].count).toBe(1);
      expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(1);
    });
  });
});
