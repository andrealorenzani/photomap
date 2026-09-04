import { useEffect, useRef } from 'react';
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
import { objectUrlCache } from '../lib/objectUrlCache';
import { formatDateTime } from '../lib/format';
import './MapView.css';

// Default marker icon URLs break under bundlers (Leaflet's built-in path detection assumes a
// classic <script> tag setup); point them at the bundled asset URLs instead.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/**
 * Builds a marker popup as plain DOM (not a React tree) per the plan, calling store actions
 * directly via the imported zustand store instance. Thumbnails are sorted chronologically.
 */
function buildPopupContent(photoIds: string[]): HTMLElement {
  const store = usePhotoStore.getState();
  const container = document.createElement('div');
  container.className = 'marker-popup';

  const photos = photoIds
    .map((id) => store.photos.get(id))
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

    item.addEventListener('click', () => {
      usePhotoStore.getState().setSelectedPhoto(photo.id);
    });

    container.appendChild(item);
  }

  return container;
}

export function MapView() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const lastFitHashRef = useRef<string>('');

  const photos = usePhotoStore((s) => s.photos);
  const dateFilter = usePhotoStore((s) => s.dateFilter);

  // Create the map once.
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;
    const map = L.map(mapRef.current).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    const clusterGroup = L.markerClusterGroup();
    map.addLayer(clusterGroup);

    leafletMapRef.current = map;
    clusterGroupRef.current = clusterGroup;

    return () => {
      map.remove();
      leafletMapRef.current = null;
      clusterGroupRef.current = null;
    };
  }, []);

  // Rebuild markers whenever the visible photo set changes (data mutation or timeline filter).
  useEffect(() => {
    const map = leafletMapRef.current;
    const clusterGroup = clusterGroupRef.current;
    if (!map || !clusterGroup) return;

    const allPhotos = Array.from(photos.values());
    const visible = dateFilter ? photosInRange(allPhotos, dateFilter.start, dateFilter.end) : allPhotos;
    const groups = computeMarkerGroups(visible);

    clusterGroup.clearLayers();
    for (const group of groups) {
      const marker = L.marker([group.lat, group.lon]);
      marker.bindPopup(() => buildPopupContent(group.photoIds), { maxWidth: 320 });
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
      // If there are zero groups (e.g. a timeline filter matches only no-GPS photos), we
      // deliberately keep the prior view rather than resetting to the whole-world default —
      // see the empty-state hint rendered below.
    }
  }, [photos, dateFilter]);

  const allPhotos = Array.from(photos.values());
  const visible = dateFilter ? photosInRange(allPhotos, dateFilter.start, dateFilter.end) : allPhotos;
  const mappedGroupCount = computeMarkerGroups(visible).length;
  const showEmptyHint = Boolean(dateFilter) && mappedGroupCount === 0 && visible.length >= 0;

  return (
    <div className="map-view">
      <div ref={mapRef} className="map-view__map" data-testid="map-container" />
      {showEmptyHint && (
        <div className="map-view__empty-hint" data-testid="map-empty-hint">
          No photos with a location in this range.
        </div>
      )}
    </div>
  );
}
