import { usePhotoStore } from '../state/photoStore';
import { useObjectUrl } from '../lib/useObjectUrl';
import { formatDateTime } from '../lib/format';
import './FullSizeViewer.css';

/**
 * Full-size modal view. Phase 1 shows datetime only — no place name / reverse geocoding, and no
 * raw lat/long is ever surfaced as a label (see plan: geocoding deliberately omitted this phase).
 */
export function FullSizeViewer() {
  const selectedPhotoId = usePhotoStore((s) => s.selectedPhotoId);
  const photo = usePhotoStore((s) => (selectedPhotoId ? s.photos.get(selectedPhotoId) : undefined));
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
          <button type="button" onClick={handleDelete}>
            Delete
          </button>
          <button type="button" onClick={() => setSelectedPhoto(null)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
