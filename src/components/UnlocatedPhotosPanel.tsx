import { useState } from 'react';
import { usePhotoStore } from '../state/photoStore';
import { useObjectUrl } from '../lib/useObjectUrl';
import { DRAG_PHOTO_ID_MIME } from './MapView';
import type { PhotoRecord } from '../types';
import './UnlocatedPhotosPanel.css';

function UnlocatedThumb({ photo }: { photo: PhotoRecord }) {
  const url = useObjectUrl(photo.id, 'thumbnail');

  return (
    <div
      className="unlocated-panel__item"
      draggable
      data-testid="unlocated-photo"
      data-photo-id={photo.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_PHOTO_ID_MIME, photo.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={`Drag onto the map to set a location for ${photo.fileName}`}
    >
      {url ? (
        <img src={url} alt={photo.fileName} />
      ) : (
        <div className="unlocated-panel__placeholder" aria-hidden="true">
          🖼
        </div>
      )}
      <span className="unlocated-panel__name">{photo.fileName}</span>
    </div>
  );
}

/**
 * Collapsible list of GPS-less photos, each draggable onto the map (see MapView's drop handler)
 * to assign them a location. Guest mode uses the previously-unused
 * `IndexedDbPhotoRepository.updateLocation`; account mode uses the new PATCH endpoint — both via
 * the store's `reassignLocation` action, called from MapView's drop handler.
 */
export function UnlocatedPhotosPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const photos = usePhotoStore((s) => s.photos);
  const unlocated = Array.from(photos.values()).filter((p) => !p.hasGPS);

  if (unlocated.length === 0) return null;

  return (
    <div className="unlocated-panel" data-testid="unlocated-panel">
      <button
        type="button"
        className="unlocated-panel__toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? '▸' : '▾'} Photos without a location ({unlocated.length}) — drag onto the
        map to place them
      </button>
      {!collapsed && (
        <div className="unlocated-panel__list">
          {unlocated.map((photo) => (
            <UnlocatedThumb key={photo.id} photo={photo} />
          ))}
        </div>
      )}
    </div>
  );
}
