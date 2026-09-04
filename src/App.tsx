import { useEffect, useMemo } from 'react';
import { TopBanner } from './components/TopBanner';
import { PrivacyNote } from './components/PrivacyNote';
import { UploadControl } from './components/UploadControl';
import { MapView } from './components/MapView';
import { StatusPanel } from './components/StatusPanel';
import { TimelineStrip } from './components/TimelineStrip';
import { PhotoThumbStrip } from './components/PhotoThumbStrip';
import { FullSizeViewer } from './components/FullSizeViewer';
import { usePhotoStore } from './state/photoStore';
import { photosInRange, photosWithUnknownDate } from './lib/timeline';
import { photoRepository } from './lib/db';
import './App.css';

function App() {
  const photos = usePhotoStore((s) => s.photos);
  const dateFilter = usePhotoStore((s) => s.dateFilter);
  const hydrateFromDB = usePhotoStore((s) => s.hydrateFromDB);

  useEffect(() => {
    hydrateFromDB();
    photoRepository.requestPersistence();
  }, [hydrateFromDB]);

  const allPhotos = useMemo(() => Array.from(photos.values()), [photos]);

  const filteredPhotos = useMemo(() => {
    if (!dateFilter) return [];
    if (dateFilter.isUnknownBucket) return photosWithUnknownDate(allPhotos);
    return photosInRange(allPhotos, dateFilter.start, dateFilter.end);
  }, [allPhotos, dateFilter]);

  return (
    <div className="app">
      <TopBanner />
      <PrivacyNote />
      <main className="app__main">
        <UploadControl>
          <MapView />
          <StatusPanel />
        </UploadControl>
      </main>
      {dateFilter && (
        <section className="app__filtered-strip" aria-label="Photos in selected time range">
          <PhotoThumbStrip photos={filteredPhotos} />
        </section>
      )}
      <TimelineStrip />
      <FullSizeViewer />
    </div>
  );
}

export default App;
