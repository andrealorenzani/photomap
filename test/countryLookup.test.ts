import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCountryBoundariesCacheForTests,
  findCountryForPoint,
  loadCountryBoundaries,
} from '../src/lib/countryLookup';

const GEOJSON_PATH = resolve(__dirname, '../public/data/countries-110m.geo.json');
const RAW_GEOJSON = readFileSync(GEOJSON_PATH, 'utf-8');

describe('countryLookup (against the real bundled GeoJSON asset)', () => {
  let fetchCallCount = 0;

  beforeEach(() => {
    __resetCountryBoundariesCacheForTests();
    fetchCallCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      fetchCallCount += 1;
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/data/countries-110m.geo.json')) {
        return Promise.resolve(
          new Response(RAW_GEOJSON, { status: 200, headers: { 'Content-Type': 'application/json' } })
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetCountryBoundariesCacheForTests();
  });

  it('resolves known landmark coordinates to the correct country', async () => {
    const features = await loadCountryBoundaries();

    expect(findCountryForPoint(48.8584, 2.2945, features)).toBe('France'); // Eiffel Tower
    expect(findCountryForPoint(35.6895, 139.6917, features)).toBe('Japan'); // Tokyo
    expect(findCountryForPoint(40.7128, -74.006, features)).toBe('United States of America'); // NYC
    expect(findCountryForPoint(-33.8688, 151.2093, features)).toBe('Australia'); // Sydney
    expect(findCountryForPoint(41.9028, 12.4964, features)).toBe('Italy'); // Rome
  });

  it('returns null for a mid-ocean point', async () => {
    const features = await loadCountryBoundaries();
    expect(findCountryForPoint(30.0, -30.0, features)).toBeNull(); // mid-Atlantic
  });

  it('resolves coastal near-border points to the correct side', async () => {
    const features = await loadCountryBoundaries();
    expect(findCountryForPoint(43.7009, 7.2661, features)).toBe('France'); // Nice, near Italy
    expect(findCountryForPoint(49.2827, -123.1207, features)).toBe('Canada'); // Vancouver, near US
  });

  it('caches the fetch across repeated loadCountryBoundaries() calls', async () => {
    await loadCountryBoundaries();
    await loadCountryBoundaries();
    expect(fetchCallCount).toBe(1);
  });
});
