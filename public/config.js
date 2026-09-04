// Runtime configuration, loaded as a plain static file before the app bundle (see index.html).
// This lets the same built `dist/` be deployed against a different backend/tile config with no
// rebuild — override any of these values by editing this file after `npm run build`, or by
// substituting a different config.js at deploy time (e.g. a different one per environment).
//
// Any key left undefined here falls back to the build-time VITE_* value baked in at build time,
// and finally to a hardcoded default. See src/lib/config.ts.
window.__PHOTOMAP_CONFIG__ = {
  apiBaseUrl: '/api',
  // mapTileUrlDetailed: undefined,
  // mapAttributionDetailed: undefined,
  // mapMaxZoomDetailed: undefined,
  // mapTileUrlTreasure: undefined,
  // mapAttributionTreasure: undefined,
  // mapMaxZoomTreasure: undefined,
  // mapTreasureCssFilter: undefined,
};
