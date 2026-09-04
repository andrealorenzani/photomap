import { useEffect, useMemo } from 'react';
import { TopBanner } from './components/TopBanner';
import { PrivacyNote } from './components/PrivacyNote';
import { AccountNotice } from './components/AccountNotice';
import { UploadControl } from './components/UploadControl';
import { MapView } from './components/MapView';
import { StatusPanel } from './components/StatusPanel';
import { TimelineStrip } from './components/TimelineStrip';
import { PhotoThumbStrip } from './components/PhotoThumbStrip';
import { FullSizeViewer } from './components/FullSizeViewer';
import { FilterBar } from './components/FilterBar';
import { UnlocatedPhotosPanel } from './components/UnlocatedPhotosPanel';
import { usePhotoStore } from './state/photoStore';
import { useAuthStore } from './state/authStore';
import { photosInRange, photosWithUnknownDate } from './lib/timeline';
import { applyFilters } from './lib/filters';
import { photoRepository } from './lib/db';
import './App.css';

function App() {
  const photos = usePhotoStore((s) => s.photos);
  const dateFilter = usePhotoStore((s) => s.dateFilter);
  const searchFilters = usePhotoStore((s) => s.searchFilters);
  const setSearchFilters = usePhotoStore((s) => s.setSearchFilters);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    // Resolves guest vs. account mode first (GET /api/me), then hydrates from whichever
    // repository is active — a page reload with a live session cookie re-enters account mode.
    restoreSession().then(() => {
      photoRepository.requestPersistence();
    });
  }, [restoreSession]);

  const allPhotos = useMemo(() => Array.from(photos.values()), [photos]);
  const searchFilteredPhotos = useMemo(
    () => applyFilters(allPhotos, searchFilters),
    [allPhotos, searchFilters]
  );

  const filteredPhotos = useMemo(() => {
    if (!dateFilter) return [];
    if (dateFilter.isUnknownBucket) return photosWithUnknownDate(searchFilteredPhotos);
    return photosInRange(searchFilteredPhotos, dateFilter.start, dateFilter.end);
  }, [searchFilteredPhotos, dateFilter]);

  return (
    <div className="app">
      <TopBanner />
      <PrivacyNote />
      <AccountNotice />
      <FilterBar photos={allPhotos} filters={searchFilters} onChange={setSearchFilters} />
      <main className="app__main">
        <UploadControl>
          <MapView />
          <StatusPanel />
        </UploadControl>
      </main>
      <UnlocatedPhotosPanel />
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
