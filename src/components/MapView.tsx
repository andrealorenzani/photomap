import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import type { PhotoRecord } from '../types';
import { usePhotoStore } from '../state/photoStore';
import { computeMarkerGroups } from '../lib/grouping';
import { photosInRange } from '../lib/timeline';
import { applyFilters } from '../lib/filters';
import { objectUrlCache } from '../lib/objectUrlCache';
import { formatDateTime } from '../lib/format';
import { getMapStyles, loadStoredMapStyle, saveMapStylePreference, type MapStyleId } from '../lib/mapStyles';
import { MapStyleToggle } from './MapStyleToggle';
import './MapView.css';

// Default marker icon URLs break under bundlers (Leaflet's built-in path detection assumes a
// classic <script> tag setup); point them at the bundled asset URLs instead.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/** MIME type used to carry a dragged photo's id from UnlocatedPhotosPanel onto the map. */
export const DRAG_PHOTO_ID_MIME = 'application/x-photomap-photo-id';

/**
 * Builds a marker popup as plain DOM (not a React tree) per the plan, calling store actions
 * directly via the imported zustand store instance. Thumbnails are sorted chronologically.
 * `readOnly` omits the delete button (share view).
 */
function buildPopupContent(photoIds: string[], photosById: Map<string, PhotoRecord>, readOnly: boolean): HTMLElement {
  const container = document.createElement('div');
  container.className = 'marker-popup';

  const photos = photoIds
    .map((id) => photosById.get(id))
    .filter((p): p is PhotoRecord => Boolean(p))
    .sort((a, b) => {
      const ta = a.takenAtISO ? new Date(a.takenAtISO).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.takenAtISO ? new Date(b.takenAtISO).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

  for (const photo of photos) {
    const item = document.createElement('div');
    item.className = 'marker-popup__item';
    item.setAttribute('data-photo-id', photo.id);

    const img = document.createElement('img');
    img.alt = photo.fileName;
    objectUrlCache.get(photo.id, 'thumbnail').then((url) => {
      if (url) img.src = url;
    });
    item.appendChild(img);

    const label = document.createElement('div');
    label.className = 'marker-popup__label';
    label.textContent = formatDateTime(photo.takenAtISO);
    item.appendChild(label);

    if (!readOnly) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'marker-popup__delete';
      deleteButton.textContent = 'Delete';
      deleteButton.setAttribute('aria-label', `Delete photo ${photo.fileName}`);
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        usePhotoStore.getState().removePhoto(photo.id);
      });
      item.appendChild(deleteButton);
    }

    item.addEventListener('click', () => {
      usePhotoStore.getState().setSelectedPhoto(photo.id);
    });

    container.appendChild(item);
  }

  return container;
}

export interface MapViewProps {
  /** When supplied, renders this set instead of the global store (used by the read-only share
   * view, which keeps photo data in local component state, never the global Zustand store). */
  photos?: PhotoRecord[];
  /** Omits delete buttons and disables marker dragging / drop-to-reassign when true. */
  readOnly?: boolean;
}

export function MapView({ photos: photosProp, readOnly = false }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const lastFitHashRef = useRef<string>('');

  const storePhotos = usePhotoStore((s) => s.photos);
  const storeDateFilter = usePhotoStore((s) => s.dateFilter);
  const searchFilters = usePhotoStore((s) => s.searchFilters);
  const reassignLocation = usePhotoStore((s) => s.reassignLocation);

  const [mapStyle, setMapStyle] = useState<MapStyleId>(() => loadStoredMapStyle());

  function handleStyleChange(style: MapStyleId) {
    setMapStyle(style);
    saveMapStylePreference(style);
  }

  // When `photos` is supplied (the read-only share view), it's already final/authoritative —
  // the share view composes its own local search-filter + timeline-range state before passing
  // photos down, so the global store's dateFilter/searchFilters are neither read nor applied
  // again here. Store-backed usage (the main app) is unchanged: both filters still compose here
  // exactly as before.
  const usingExternalPhotos = photosProp !== undefined;
  const dateFilter = usingExternalPhotos ? null : storeDateFilter;
  const allPhotos = photosProp ?? Array.from(storePhotos.values());
  const visible = usingExternalPhotos
    ? allPhotos
    : applyFilters(
        dateFilter ? photosInRange(allPhotos, dateFilter.start, dateFilter.end) : allPhotos,
        searchFilters
      );
  const photosById = new Map(allPhotos.map((p) => [p.id, p] as const));

  // Create the map once. An initial maxZoom is required here (not just on the tile layer added
  // by the style effect right after) because markercluster's `addLayer()` below can query the
  // map's maxZoom before that later effect has run.
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;
    // minZoom/maxBounds/maxBoundsViscosity prevent the standard Leaflet low-zoom behavior of
    // repeating the world horizontally when zoomed out past a single world-width -- with no
    // minZoom/maxBounds set, zooming out further than that shows duplicate copies of the map
    // side by side. maxBoundsViscosity: 1.0 makes the bounds "solid" (no rubber-banding past
    // the edge) rather than just resistant.
    const map = L.map(mapRef.current, {
      maxZoom: 19,
      minZoom: 2,
      maxBounds: L.latLngBounds([-90, -180], [90, 180]),
      maxBoundsViscosity: 1.0,
    }).setView([20, 0], 2);
    const clusterGroup = L.markerClusterGroup();
    map.addLayer(clusterGroup);

    leafletMapRef.current = map;
    clusterGroupRef.current = clusterGroup;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      clusterGroupRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // Swap the tile layer + CSS filter class when the style changes. This never touches
  // markers/photo data — only the tile layer and its maxZoom/CSS class are swapped.
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const styleConfig = getMapStyles()[mapStyle];

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const tileLayer = L.tileLayer(styleConfig.tileUrl, {
      attribution: styleConfig.attribution,
      maxZoom: styleConfig.maxZoom,
      // Paired with the map's own minZoom/maxBounds above: without noWrap, Leaflet still tiles
      // additional world copies horizontally at low zoom even with maxBounds set.
      noWrap: true,
    });
    tileLayer.addTo(map);
    tileLayer.bringToBack();
    tileLayerRef.current = tileLayer;

    map.setMaxZoom(styleConfig.maxZoom);
    if (map.getZoom() > styleConfig.maxZoom) {
      map.setZoom(styleConfig.maxZoom);
    }

    const container = mapRef.current;
    if (container) {
      container.classList.toggle('map-view__map--treasure', mapStyle === 'treasure');
      if (styleConfig.cssFilter) {
        container.style.setProperty('--map-treasure-filter', styleConfig.cssFilter);
      }
    }
  }, [mapStyle]);

  // Rebuild markers whenever the visible photo set changes (data mutation or filters).
  useEffect(() => {
    const map = leafletMapRef.current;
    const clusterGroup = clusterGroupRef.current;
    if (!map || !clusterGroup) return;

    const groups = computeMarkerGroups(visible);

    clusterGroup.clearLayers();
    for (const group of groups) {
      const marker = L.marker([group.lat, group.lon], { draggable: !readOnly });
      marker.bindPopup(() => buildPopupContent(group.photoIds, photosById, readOnly), { maxWidth: 320 });
      if (!readOnly) {
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLatLng();
          // A marker can represent a group of photos taken at effectively the same spot;
          // repositioning it reassigns every photo in that group to the new point.
          for (const photoId of group.photoIds) {
            usePhotoStore.getState().reassignLocation(photoId, lat, lng);
          }
        });
      }
      clusterGroup.addLayer(marker);
    }

    // Guard against redundant fits: only re-fit when the set of visible marker groups actually
    // changed, comparing a cheap hash of their keys.
    const hash = groups
      .map((g) => g.groupKey)
      .sort()
      .join(',');
    if (hash !== lastFitHashRef.current) {
      lastFitHashRef.current = hash;
      if (groups.length > 0) {
        const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lon] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
      // If there are zero groups (e.g. a filter matches only no-GPS photos), we deliberately
      // keep the prior view rather than resetting to the whole-world default — see the
      // empty-state hint rendered below.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, readOnly]);

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    if (!event.dataTransfer.types.includes(DRAG_PHOTO_ID_MIME)) return;
    event.preventDefault();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    const photoId = event.dataTransfer.getData(DRAG_PHOTO_ID_MIME);
    const map = leafletMapRef.current;
    const container = mapRef.current;
    if (!photoId || !map || !container) return;
    event.preventDefault();

    const rect = container.getBoundingClientRect();
    const point = L.point(event.clientX - rect.left, event.clientY - rect.top);
    const { lat, lng } = map.containerPointToLatLng(point);
    reassignLocation(photoId, lat, lng);
  }

  const mappedGroupCount = computeMarkerGroups(visible).length;
  const showEmptyHint = Boolean(dateFilter) && mappedGroupCount === 0 && visible.length >= 0;

  return (
    <div className="map-view">
      <div
        ref={mapRef}
        className="map-view__map"
        data-testid="map-container"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      />
      <MapStyleToggle active={mapStyle} onChange={handleStyleChange} />
      {showEmptyHint && (
        <div className="map-view__empty-hint" data-testid="map-empty-hint">
          No photos with a location in this range.
        </div>
      )}
    </div>
  );
}
