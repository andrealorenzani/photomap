import { getMapConfig } from './config';

export type MapStyleId = 'detailed' | 'treasure';

export interface MapStyleConfig {
  id: MapStyleId;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  /** CSS `filter` value applied to the tile layer container; undefined for Detailed. */
  cssFilter?: string;
}

const STORAGE_KEY = 'photomap.mapStyle';

/**
 * Two presets, both sourced from the same OSM tile source by default (config-driven, so a
 * different tile provider could be substituted later with no code change) — coordinates always
 * line up identically between the two; only rendering (a CSS filter) and available zoom range
 * differ. Detailed is the unchanged, default Phase 1 behavior; Treasure Map is purely additive.
 */
export function getMapStyles(): Record<MapStyleId, MapStyleConfig> {
  const cfg = getMapConfig();
  return {
    detailed: {
      id: 'detailed',
      tileUrl: cfg.detailed.tileUrl,
      attribution: cfg.detailed.attribution,
      maxZoom: cfg.detailed.maxZoom,
    },
    treasure: {
      id: 'treasure',
      tileUrl: cfg.treasure.tileUrl,
      attribution: cfg.treasure.attribution,
      // Country/region-level cap: no street names/house numbers reachable in this style. A
      // dense marker cluster can't be zoomed in far enough to visually separate the way
      // Detailed mode allows — inherent to the feature as specified, not a bug.
      maxZoom: cfg.treasure.maxZoom,
      cssFilter: cfg.treasure.cssFilter,
    },
  };
}

/** Default is always Detailed on first load with no stored preference. */
export function loadStoredMapStyle(): MapStyleId {
  if (typeof localStorage === 'undefined') return 'detailed';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'treasure' ? 'treasure' : 'detailed';
}

/** Persisted to localStorage only (per-browser) — not synced to the account. */
export function saveMapStylePreference(style: MapStyleId): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, style);
}
