import type { PhotoRecord } from '../types';
import { usePhotoStore } from '../state/photoStore';
import { useObjectUrl } from '../lib/useObjectUrl';
import { formatDateTime } from '../lib/format';
import './PhotoThumbStrip.css';

function ThumbItem({ photo, readOnly }: { photo: PhotoRecord; readOnly: boolean }) {
  const url = useObjectUrl(photo.id, 'thumbnail');
  const setSelectedPhoto = usePhotoStore((s) => s.setSelectedPhoto);
  const removePhoto = usePhotoStore((s) => s.removePhoto);

  return (
    <div className="photo-thumb" data-testid="photo-thumb" data-photo-id={photo.id}>
      <button
        type="button"
        className="photo-thumb__image-button"
        onClick={() => setSelectedPhoto(photo.id)}
        aria-label={`Open photo ${photo.fileName}`}
      >
        {url ? (
          <img src={url} alt={photo.fileName} />
        ) : (
          <div className="photo-thumb__placeholder" aria-hidden="true">
            🖼
          </div>
        )}
        <span className={`photo-thumb__badge ${photo.hasGPS ? 'has-gps' : 'no-gps'}`}>
          {photo.hasGPS ? 'Located' : 'No location'}
        </span>
      </button>
      <div className="photo-thumb__meta">
        <span className="photo-thumb__datetime">{formatDateTime(photo.takenAtISO)}</span>
        {!readOnly && (
          <button
            type="button"
            className="photo-thumb__delete"
            onClick={() => removePhoto(photo.id)}
            aria-label={`Delete photo ${photo.fileName}`}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function sortChronologically(photos: PhotoRecord[]): PhotoRecord[] {
  return [...photos].sort((a, b) => {
    const ta = a.takenAtISO ? new Date(a.takenAtISO).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.takenAtISO ? new Date(b.takenAtISO).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

export function PhotoThumbStrip({
  photos,
  readOnly = false,
}: {
  photos: PhotoRecord[];
  readOnly?: boolean;
}) {
  const sorted = sortChronologically(photos);

  if (sorted.length === 0) {
    return <div className="photo-thumb-strip photo-thumb-strip--empty">No photos to show.</div>;
  }

  return (
    <div className="photo-thumb-strip" data-testid="photo-thumb-strip">
      {sorted.map((photo) => (
        <ThumbItem key={photo.id} photo={photo} readOnly={readOnly} />
      ))}
    </div>
  );
}
