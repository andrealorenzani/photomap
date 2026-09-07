import { describe, expect, it, vi, afterEach } from 'vitest';
import { computeCountryVisits, formatVisitDate } from '../src/lib/countries';
import * as countryLookup from '../src/lib/countryLookup';
import type { PhotoRecord } from '../src/types';

function photo(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

// findCountryForPoint is mocked here (rather than loading the real bundled GeoJSON) so this
// suite tests only computeCountryVisits' own grouping/dedup/sort logic in isolation --
// countryLookup.test.ts is what verifies real coordinate resolution against the bundled data.
// Coordinates round-trip through computeMarkerGroups' centroid averaging, which can introduce
// tiny floating-point drift (e.g. averaging three copies of the same value) -- round to 4
// decimal places (~11m precision) before matching against the fixture map so tests aren't
// sensitive to that.
function roundCoord(n: number): string {
  return n.toFixed(4);
}

function mockCountryFor(map: Record<string, string | null>) {
  return vi.spyOn(countryLookup, 'findCountryForPoint').mockImplementation((lat, lon) => {
    const key = `${roundCoord(lat)},${roundCoord(lon)}`;
    return map[key] ?? null;
  });
}

describe('computeCountryVisits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups photos by country and dedups repeat month/year visits', () => {
    mockCountryFor({ '48.8584,2.2945': 'France' });

    const photos = [
      photo('p1', { hasGPS: true, lat: 48.8584, lon: 2.2945, takenAtISO: '2019-06-15T10:00:00Z' }),
      photo('p2', { hasGPS: true, lat: 48.8584, lon: 2.2945, takenAtISO: '2019-06-20T10:00:00Z' }), // same month/year, dedup
      photo('p3', { hasGPS: true, lat: 48.8584, lon: 2.2945, takenAtISO: '2021-08-01T10:00:00Z' }),
    ];

    const visits = computeCountryVisits(photos);
    expect(visits).toHaveLength(1);
    expect(visits[0].countryName).toBe('France');
    expect(visits[0].visits).toEqual([
      { year: 2019, month: 6 },
      { year: 2021, month: 8 },
    ]);
  });

  it('handles multiple countries and sorts the result by country name', () => {
    mockCountryFor({
      '35.6895,139.6917': 'Japan',
      '48.8584,2.2945': 'France',
    });

    const photos = [
      photo('p1', { hasGPS: true, lat: 35.6895, lon: 139.6917, takenAtISO: '2020-01-01T00:00:00Z' }),
      photo('p2', { hasGPS: true, lat: 48.8584, lon: 2.2945, takenAtISO: '2018-03-01T00:00:00Z' }),
    ];

    const visits = computeCountryVisits(photos);
    expect(visits.map((v) => v.countryName)).toEqual(['France', 'Japan']);
  });

  it('sorts visit dates chronologically within a country regardless of input order', () => {
    mockCountryFor({ '10.0000,10.0000': 'Testland' });

    const photos = [
      photo('p1', { hasGPS: true, lat: 10, lon: 10, takenAtISO: '2022-05-01T00:00:00Z' }),
      photo('p2', { hasGPS: true, lat: 10, lon: 10, takenAtISO: '2020-11-01T00:00:00Z' }),
      photo('p3', { hasGPS: true, lat: 10, lon: 10, takenAtISO: '2022-01-01T00:00:00Z' }),
    ];

    const visits = computeCountryVisits(photos);
    expect(visits[0].visits).toEqual([
      { year: 2020, month: 11 },
      { year: 2022, month: 1 },
      { year: 2022, month: 5 },
    ]);
  });

  it('excludes photos with no usable GPS entirely (never even looked up)', () => {
    const spy = mockCountryFor({});
    const photos = [photo('p1', { hasGPS: false })];

    const visits = computeCountryVisits(photos);
    expect(visits).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips a group when the point resolves to no country (e.g. open ocean)', () => {
    mockCountryFor({ '0.0000,-30.0000': null as unknown as string });
    const photos = [photo('p1', { hasGPS: true, lat: 0, lon: -30, takenAtISO: '2020-01-01T00:00:00Z' })];

    expect(computeCountryVisits(photos)).toEqual([]);
  });

  it('excludes photos with no parseable takenAtISO from the date list, without dropping the country', () => {
    mockCountryFor({ '10.0000,10.0000': 'Testland' });
    const photos = [
      photo('p1', { hasGPS: true, lat: 10, lon: 10 }), // no takenAtISO
      photo('p2', { hasGPS: true, lat: 10, lon: 10, takenAtISO: '2022-01-01T00:00:00Z' }),
    ];

    const visits = computeCountryVisits(photos);
    expect(visits).toHaveLength(1);
    expect(visits[0].visits).toEqual([{ year: 2022, month: 1 }]);
  });
});

describe('formatVisitDate', () => {
  it('formats a {year, month} pair as an abbreviated month + year', () => {
    expect(formatVisitDate({ year: 2019, month: 6 })).toBe('Jun 2019');
    expect(formatVisitDate({ year: 2021, month: 12 })).toBe('Dec 2021');
    expect(formatVisitDate({ year: 2020, month: 1 })).toBe('Jan 2020');
  });
});
