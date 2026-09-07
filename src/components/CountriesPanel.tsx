import { useEffect, useState } from 'react';
import type { PhotoRecord } from '../types';
import { computeCountryVisits, formatVisitDate, loadCountryBoundaries, type CountryVisit } from '../lib/countries';
import './CountriesPanel.css';

/**
 * Collapsible panel (same UX convention as UnlocatedPhotosPanel) listing every country a photo
 * was taken in, with the distinct month/year(s) visited — computed entirely client-side from
 * the bundled country-boundary dataset (see src/lib/countryLookup.ts), with zero network calls
 * beyond the one-time fetch of that bundled static asset. Works identically in guest mode,
 * account mode, and the read-only share view.
 */
export function CountriesPanel({ photos }: { photos: PhotoRecord[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [visits, setVisits] = useState<CountryVisit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCountryBoundaries()
      .then(() => {
        if (!cancelled) setVisits(computeCountryVisits(photos));
      })
      .catch(() => {
        if (!cancelled) setVisits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [photos]);

  if (visits === null) return null;
  if (visits.length === 0) return null;

  return (
    <div className="countries-panel" data-testid="countries-panel">
      <button
        type="button"
        className="countries-panel__toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? '▸' : '▾'} Countries visited ({visits.length})
      </button>
      {!collapsed && (
        <ul className="countries-panel__list">
          {visits.map((visit) => (
            <li key={visit.countryName} className="countries-panel__item">
              <span className="countries-panel__country">{visit.countryName}</span>
              {' — '}
              <span className="countries-panel__dates">
                {visit.visits.map(formatVisitDate).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
