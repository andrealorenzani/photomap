import { useEffect, useMemo, useState } from 'react';
import { fetchShare } from '../lib/api/shareApi';
import { ApiPhotoRepository, getActiveRepository, setActiveRepository } from '../lib/db';
import type { PhotoRecord } from '../types';
import { MapView } from '../components/MapView';
import { TimelineStrip } from '../components/TimelineStrip';
import { PhotoThumbStrip } from '../components/PhotoThumbStrip';
import { FullSizeViewer } from '../components/FullSizeViewer';
import { FilterBar } from '../components/FilterBar';
import { applyFilters, type SearchFilters } from '../lib/filters';
import { photosInRange, photosWithUnknownDate } from '../lib/timeline';
import { usePhotoStore, type DateRange } from '../state/photoStore';
import './SharePage.css';

type LoadStatus = 'loading' | 'ready' | 'error';

export interface SharePageProps {
  token: string;
}

/**
 * Public, read-only view of `GET /api/share/{token}`. Photo data lives entirely in this
 * component's own local state — never the global Zustand store — so an unauthenticated public
 * view can never touch guest-mode or another account's data. No upload/delete/login
 * affordances; filters and the map-style toggle remain available (both non-mutating).
 */
export function SharePage({ token }: SharePageProps) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    const previousRepository = getActiveRepository();
    setStatus('loading');
    setPhotos([]);
    setFilters({});
    setDateRange(null);

    fetchShare(token)
      .then((dtos) => {
        if (cancelled) return;
        // A dedicated repository instance, primed from this share's own signed URLs and made
        // temporarily active so MapView/PhotoThumbStrip/FullSizeViewer's existing
        // getBlob()-via-objectUrlCache machinery works unchanged. This only affects which
        // repository backs blob lookups, never the global photo store.
        const repo = new ApiPhotoRepository();
        const records = repo.primeFromDtos(dtos);
        setActiveRepository(repo);
        setPhotos(records);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
      setActiveRepository(previousRepository);
      usePhotoStore.getState().setSelectedPhoto(null);
    };
  }, [token]);

  const searchFiltered = useMemo(() => applyFilters(photos, filters), [photos, filters]);
  const timelineFiltered = useMemo(() => {
    if (!dateRange) return searchFiltered;
    if (dateRange.isUnknownBucket) return photosWithUnknownDate(searchFiltered);
    return photosInRange(searchFiltered, dateRange.start, dateRange.end);
  }, [searchFiltered, dateRange]);

  if (status === 'loading') {
    return (
      <div className="share-page share-page--loading" data-testid="share-page-loading">
        Loading shared photos…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="share-page share-page--error" data-testid="share-page-error">
        This share link is invalid or has been revoked.
      </div>
    );
  }

  return (
    <div className="share-page" data-testid="share-page">
      <header className="share-page__banner">Photomap — shared photos (read-only)</header>
      <FilterBar photos={photos} filters={filters} onChange={setFilters} />
      <main className="share-page__main">
        <MapView photos={timelineFiltered} readOnly />
      </main>
      <TimelineStrip photos={searchFiltered} dateFilter={dateRange} onDateFilterChange={setDateRange} />
      <PhotoThumbStrip photos={timelineFiltered} readOnly />
      <FullSizeViewer photos={timelineFiltered} readOnly />
    </div>
  );
}
