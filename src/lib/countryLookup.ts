/**
 * Fully client-side, offline country-boundary lookup for the "countries visited" feature.
 *
 * Deliberately NOT backed by the existing `GET /api/geocode`/Nominatim path: that path is
 * account-mode-only (requires a login session), would violate guest mode's "GPS coordinates
 * never leave this device" guarantee, and stores an unstructured `place_name` display string
 * rather than a structured country field (unreliable to parse). This module instead resolves a
 * lat/lon to a country name entirely in-browser, against a bundled simplified world-country
 * boundary dataset (Natural Earth 1:110m admin-0 countries, public domain) — zero network calls
 * beyond the one-time fetch of the bundled static asset itself, works identically in guest mode,
 * account mode, and the read-only share view.
 */

export type GeoJsonPosition = [number, number]; // [lon, lat]
export type GeoJsonLinearRing = GeoJsonPosition[];
export type GeoJsonPolygonCoordinates = GeoJsonLinearRing[]; // [exterior, ...holes]

interface CountryFeature {
  name: string;
  /** Each entry is one polygon's rings (exterior + holes); a MultiPolygon has multiple entries. */
  polygons: GeoJsonPolygonCoordinates[];
  /** Cheap [minLon, minLat, maxLon, maxLat] bounding box, precomputed once, to short-circuit
   * the full ray-cast for most countries most of the time. */
  bbox: [number, number, number, number];
}

interface RawGeoJsonFeature {
  type: 'Feature';
  properties: { name?: string };
  geometry:
    | { type: 'Polygon'; coordinates: GeoJsonPolygonCoordinates }
    | { type: 'MultiPolygon'; coordinates: GeoJsonPolygonCoordinates[] }
    | { type: string; coordinates: unknown };
}

interface RawGeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: RawGeoJsonFeature[];
}

let cachedFeatures: CountryFeature[] | null = null;
let loadPromise: Promise<CountryFeature[]> | null = null;

function computeBbox(polygons: GeoJsonPolygonCoordinates[]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseFeatureCollection(raw: RawGeoJsonFeatureCollection): CountryFeature[] {
  const features: CountryFeature[] = [];
  for (const feature of raw.features) {
    const name = feature.properties?.name;
    if (!name) continue;
    let polygons: GeoJsonPolygonCoordinates[];
    if (feature.geometry.type === 'Polygon') {
      polygons = [feature.geometry.coordinates as GeoJsonPolygonCoordinates];
    } else if (feature.geometry.type === 'MultiPolygon') {
      polygons = feature.geometry.coordinates as GeoJsonPolygonCoordinates[];
    } else {
      continue;
    }
    features.push({ name, polygons, bbox: computeBbox(polygons) });
  }
  return features;
}

/**
 * Fetches and caches the bundled country-boundary GeoJSON. Safe to call repeatedly — only
 * fetches once per page load (subsequent calls reuse the in-flight/completed promise).
 */
export async function loadCountryBoundaries(): Promise<CountryFeature[]> {
  if (cachedFeatures) return cachedFeatures;
  if (loadPromise) return loadPromise;

  loadPromise = fetch('/data/countries-110m.geo.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load country boundaries: HTTP ${res.status}`);
      return res.json() as Promise<RawGeoJsonFeatureCollection>;
    })
    .then((raw) => {
      const features = parseFeatureCollection(raw);
      cachedFeatures = features;
      return features;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

/** Only used by tests to reset module-level caching between cases. */
export function __resetCountryBoundariesCacheForTests(): void {
  cachedFeatures = null;
  loadPromise = null;
}

function pointInRing(lon: number, lat: number, ring: GeoJsonLinearRing): boolean {
  // Standard ray-casting (even-odd rule): count crossings of a horizontal ray extending from
  // the point to +infinity longitude against every edge of the ring.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, rings: GeoJsonPolygonCoordinates): boolean {
  // rings[0] is the exterior ring; any subsequent rings are holes to be excluded.
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

function inBbox(lon: number, lat: number, bbox: [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Resolves a lat/lon to a country name using the already-loaded boundary set, or `null` if the
 * point doesn't fall inside any known country polygon (e.g. open ocean). Call
 * `loadCountryBoundaries()` first — this is a synchronous, pure lookup over already-fetched
 * data so it can be called once per marker group without re-awaiting a fetch each time.
 */
export function findCountryForPoint(
  lat: number,
  lon: number,
  features: CountryFeature[] = cachedFeatures ?? []
): string | null {
  for (const feature of features) {
    if (!inBbox(lon, lat, feature.bbox)) continue;
    for (const rings of feature.polygons) {
      if (pointInPolygon(lon, lat, rings)) return feature.name;
    }
  }
  return null;
}
