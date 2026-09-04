import type { PhotoRecord } from '../types';
import { usePhotoStore } from '../state/photoStore';
import { useObjectUrl } from '../lib/useObjectUrl';
import { formatDateTime } from '../lib/format';
import './FullSizeViewer.css';

export interface FullSizeViewerProps {
  /** When supplied, looks the selected photo up in this set instead of the global store (used
   * by the read-only share view, which keeps photo data in local component state, never the
   * global Zustand store). */
  photos?: PhotoRecord[];
  /** Omits the delete action when true (share view). */
  readOnly?: boolean;
}

/**
 * Full-size modal view. Phase 1 shows datetime only — no place name / reverse geocoding, and no
 * raw lat/long is ever surfaced as a label (see plan: geocoding deliberately omitted this phase).
 */
export function FullSizeViewer({ photos: photosProp, readOnly = false }: FullSizeViewerProps = {}) {
  const selectedPhotoId = usePhotoStore((s) => s.selectedPhotoId);
  const storePhoto = usePhotoStore((s) => (selectedPhotoId ? s.photos.get(selectedPhotoId) : undefined));
  const photo = photosProp
    ? photosProp.find((p) => p.id === selectedPhotoId)
    : storePhoto;
  const setSelectedPhoto = usePhotoStore((s) => s.setSelectedPhoto);
  const removePhoto = usePhotoStore((s) => s.removePhoto);
  const previewUrl = useObjectUrl(selectedPhotoId ?? '', 'preview');

  if (!selectedPhotoId || !photo) return null;

  function handleDelete() {
    if (!selectedPhotoId) return;
    removePhoto(selectedPhotoId);
    setSelectedPhoto(null);
  }

  return (
    <div className="full-size-viewer" role="dialog" aria-modal="true" data-testid="full-size-viewer">
      <div className="full-size-viewer__backdrop" onClick={() => setSelectedPhoto(null)} />
      <div className="full-size-viewer__content">
        <div className="full-size-viewer__overlay-banner">{formatDateTime(photo.takenAtISO)}</div>
        {previewUrl ? (
          <img src={previewUrl} alt={photo.fileName} className="full-size-viewer__image" />
        ) : (
          <div className="full-size-viewer__placeholder" aria-label="No preview available">
            🖼
            <p>No preview available for this file in this browser.</p>
          </div>
        )}
        <div className="full-size-viewer__actions">
          {!readOnly && (
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="button" onClick={() => setSelectedPhoto(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
