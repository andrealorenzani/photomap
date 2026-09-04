import { useMemo } from 'react';
import type { PhotoRecord } from '../types';
import { distinctCameraMakes, distinctCameraModels, type HasLocationFilter, type SearchFilters } from '../lib/filters';
import './FilterBar.css';

export interface FilterBarProps {
  /** The unfiltered photo set, used only to compute available camera make/model options. */
  photos: PhotoRecord[];
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Date-range/camera-make/camera-model/has-location search filters. Ships in both guest and
 * account mode, and remains available (non-mutating) in the read-only share view. */
export function FilterBar({ photos, filters, onChange }: FilterBarProps) {
  const makes = useMemo(() => distinctCameraMakes(photos), [photos]);
  const models = useMemo(() => distinctCameraModels(photos), [photos]);

  function update(patch: Partial<SearchFilters>) {
    onChange({ ...filters, ...patch });
  }

  const hasAnyFilter = Boolean(
    filters.dateStart ||
      filters.dateEnd ||
      filters.cameraMake ||
      filters.cameraModel ||
      (filters.hasLocation && filters.hasLocation !== 'any')
  );

  return (
    <div className="filter-bar" data-testid="filter-bar">
      <label>
        From
        <input
          type="date"
          aria-label="From date"
          value={filters.dateStart ? toDateInputValue(filters.dateStart) : ''}
          onChange={(e) => update({ dateStart: e.target.value ? new Date(e.target.value) : undefined })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          aria-label="To date"
          value={filters.dateEnd ? toDateInputValue(filters.dateEnd) : ''}
          onChange={(e) => update({ dateEnd: e.target.value ? new Date(e.target.value) : undefined })}
        />
      </label>
      <label>
        Camera make
        <select
          aria-label="Camera make"
          value={filters.cameraMake ?? ''}
          onChange={(e) => update({ cameraMake: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {makes.map((make) => (
            <option key={make} value={make}>
              {make}
            </option>
          ))}
        </select>
      </label>
      <label>
        Camera model
        <select
          aria-label="Camera model"
          value={filters.cameraModel ?? ''}
          onChange={(e) => update({ cameraModel: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
      <label>
        Location
        <select
          aria-label="Has location"
          value={filters.hasLocation ?? 'any'}
          onChange={(e) => update({ hasLocation: e.target.value as HasLocationFilter })}
        >
          <option value="any">Any</option>
          <option value="located">Located</option>
          <option value="unlocated">No location</option>
        </select>
      </label>
      {hasAnyFilter && (
        <button type="button" className="filter-bar__clear" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
    </div>
  );
}
