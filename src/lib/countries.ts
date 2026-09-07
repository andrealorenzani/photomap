import type { PhotoRecord } from '../types';
import { computeMarkerGroups } from './grouping';
import { findCountryForPoint, loadCountryBoundaries } from './countryLookup';

export interface CountryVisitDate {
  year: number;
  month: number; // 1-12
}

export interface CountryVisit {
  countryName: string;
  visits: CountryVisitDate[];
}

/**
 * For every photo with usable GPS, resolves which country it was taken in and which distinct
 * month/year(s) photos exist for that country, returning a sorted (by country name)
 * `CountryVisit[]`. Reuses `computeMarkerGroups()` so that only one country lookup runs per
 * marker group (one per ~50m cluster of photos), not one per photo — this matters because a
 * folder import can easily contain thousands of photos at only a handful of distinct locations.
 *
 * Must be called after `loadCountryBoundaries()` has resolved at least once; if the boundary
 * data hasn't loaded yet, this returns an empty array rather than throwing (callers should
 * await `loadCountryBoundaries()` before calling, e.g. from a `useEffect`).
 */
export function computeCountryVisits(photos: PhotoRecord[]): CountryVisit[] {
  const photosById = new Map(photos.map((p) => [p.id, p] as const));
  const groups = computeMarkerGroups(photos);

  // country name -> Set of "year-month" keys -> {year, month}
  const byCountry = new Map<string, Map<string, CountryVisitDate>>();

  for (const group of groups) {
    const countryName = findCountryForPoint(group.lat, group.lon);
    if (!countryName) continue;

    let dateMap = byCountry.get(countryName);
    if (!dateMap) {
      dateMap = new Map();
      byCountry.set(countryName, dateMap);
    }

    for (const photoId of group.photoIds) {
      const photo = photosById.get(photoId);
      if (!photo?.takenAtISO) continue;
      const date = new Date(photo.takenAtISO);
      if (Number.isNaN(date.getTime())) continue;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      if (!dateMap.has(key)) dateMap.set(key, { year, month });
    }
  }

  const result: CountryVisit[] = [];
  for (const [countryName, dateMap] of byCountry) {
    const visits = Array.from(dateMap.values()).sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    );
    result.push({ countryName, visits });
  }

  result.sort((a, b) => a.countryName.localeCompare(b.countryName));
  return result;
}

/** Formats a `{year, month}` pair as e.g. "Jun 2019", for display in CountriesPanel. */
export function formatVisitDate({ year, month }: CountryVisitDate): string {
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${monthName} ${year}`;
}

export { loadCountryBoundaries };
