// Ambient module declaration for leaflet.markercluster, which has no first-party TS types.
// This augments the Leaflet namespace with the minimal surface Photomap uses.
import * as L from 'leaflet';

declare module 'leaflet' {
  interface MarkerClusterGroupOptions extends L.LayerOptions {
    showCoverageOnHover?: boolean;
    zoomToBoundsOnClick?: boolean;
    spiderfyOnMaxZoom?: boolean;
    removeOutsideVisibleBounds?: boolean;
    disableClusteringAtZoom?: number;
    maxClusterRadius?: number | ((zoom: number) => number);
  }

  class MarkerClusterGroup extends L.FeatureGroup {
    constructor(options?: MarkerClusterGroupOptions);
    addLayer(layer: L.Layer): this;
    removeLayer(layer: L.Layer): this;
    clearLayers(): this;
    getBounds(): L.LatLngBounds;
  }

  function markerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup;
}

declare module 'leaflet.markercluster';
