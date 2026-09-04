/**
 * Resolves runtime-configurable settings. Layering, in priority order:
 *   1. `window.__PHOTOMAP_CONFIG__` (set by `public/config.js`, a plain static file loaded via a
 *      <script> tag before the bundle) — lets the *same* built `dist/` be pointed at a different
 *      backend/tile config with no rebuild, which a purely build-time env var could not do.
 *   2. Build-time `import.meta.env.VITE_*` values (baked in at `npm run build` time).
 *   3. Hardcoded defaults below.
 */

export interface PhotomapRuntimeConfig {
  apiBaseUrl?: string;
  mapTileUrlDetailed?: string;
  mapAttributionDetailed?: string;
  mapMaxZoomDetailed?: number;
  mapTileUrlTreasure?: string;
  mapAttributionTreasure?: string;
  mapMaxZoomTreasure?: number;
  mapTreasureCssFilter?: string;
}

declare global {
  interface Window {
    __PHOTOMAP_CONFIG__?: PhotomapRuntimeConfig;
  }
}

function runtimeConfig(): PhotomapRuntimeConfig {
  if (typeof window === 'undefined') return {};
  return window.__PHOTOMAP_CONFIG__ ?? {};
}

function envString(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return value === undefined || value === '' ? undefined : value;
}

function envNumber(key: string): number | undefined {
  const raw = envString(key);
  if (raw === undefined) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

export function getApiBaseUrl(): string {
  return runtimeConfig().apiBaseUrl ?? envString('VITE_API_BASE_URL') ?? '/api';
}

export function getMapConfig() {
  const rt = runtimeConfig();
  return {
    detailed: {
      tileUrl:
        rt.mapTileUrlDetailed ??
        envString('VITE_MAP_TILE_URL_DETAILED') ??
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution:
        rt.mapAttributionDetailed ??
        envString('VITE_MAP_ATTRIBUTION_DETAILED') ??
        '&copy; OpenStreetMap contributors',
      maxZoom: rt.mapMaxZoomDetailed ?? envNumber('VITE_MAP_MAX_ZOOM_DETAILED') ?? 19,
    },
    treasure: {
      tileUrl:
        rt.mapTileUrlTreasure ??
        envString('VITE_MAP_TILE_URL_TREASURE') ??
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution:
        rt.mapAttributionTreasure ??
        envString('VITE_MAP_ATTRIBUTION_TREASURE') ??
        '&copy; OpenStreetMap contributors',
      maxZoom: rt.mapMaxZoomTreasure ?? envNumber('VITE_MAP_MAX_ZOOM_TREASURE') ?? 10,
      cssFilter:
        rt.mapTreasureCssFilter ??
        envString('VITE_MAP_TREASURE_CSS_FILTER') ??
        'sepia(0.65) saturate(1.6) hue-rotate(-8deg) contrast(1.1)',
    },
  };
}
