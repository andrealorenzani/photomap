import { create } from 'zustand';
import type { IngestStatus, PhotoRecord } from '../types';
import { getActiveRepository, photoRepository } from '../lib/db';
import { objectUrlCache } from '../lib/objectUrlCache';
import { gridKey } from '../lib/grouping';
import type { SearchFilters } from '../lib/filters';

export interface DateRange {
  start: Date;
  end: Date;
  /** True for the dedicated "Unknown date" bin — matches photos with no parseable date. */
  isUnknownBucket?: boolean;
}

interface PhotoStoreState {
  photos: Map<string, PhotoRecord>;
  status: IngestStatus;
  dateFilter: DateRange | null;
  selectedPhotoId: string | null;
  searchFilters: SearchFilters;

  hydrateFromDB: () => Promise<void>;
  upsertPhoto: (record: PhotoRecord) => void;
  removePhoto: (id: string) => Promise<void>;
  setDateFilter: (range: DateRange | null) => void;
  setSelectedPhoto: (id: string | null) => void;
  clearAll: () => Promise<void>;
  setStatus: (patch: Partial<IngestStatus>) => void;
  resetIngestCounters: (total: number) => void;
  setSearchFilters: (filters: SearchFilters) => void;
  /**
   * Moves a store entry from a client-generated optimistic id to the server-assigned final id
   * returned by `PhotoRepository.add()` (account mode only — guest mode's id never changes).
   * Removes the old Map entry, inserts the new one, and updates selectedPhotoId if it referenced
   * the old id.
   */
  reconcileId: (oldId: string, newRecord: PhotoRecord) => void;
  /**
   * Drag-to-reassign a photo's location (works in both modes via
   * `getActiveRepository().updateLocation()`). Optimistically updates in-memory state; rolls
   * back to the prior record/counts if the repository call fails (e.g. a 404/422 in account
   * mode), so a rejected location is never silently shown as accepted.
   */
  reassignLocation: (id: string, lat: number, lon: number) => Promise<void>;
}

const initialStatus: IngestStatus = {
  total: 0,
  processed: 0,
  withGPS: 0,
  withoutGPS: 0,
  skipped: 0,
  parsing: false,
  uploadFailures: 0,
};

export const usePhotoStore = create<PhotoStoreState>((set, get) => ({
  photos: new Map(),
  status: { ...initialStatus },
  dateFilter: null,
  selectedPhotoId: null,
  searchFilters: {},

  hydrateFromDB: async () => {
    const records = await photoRepository.list();
    const photos = new Map<string, PhotoRecord>();
    let withGPS = 0;
    let withoutGPS = 0;
    for (const record of records) {
      photos.set(record.id, record);
      if (record.hasGPS) withGPS += 1;
      else withoutGPS += 1;
    }
    set({
      photos,
      status: {
        ...get().status,
        total: records.length,
        processed: records.length,
        withGPS,
        withoutGPS,
      },
    });
  },

  upsertPhoto: (record: PhotoRecord) => {
    set((state) => {
      const photos = new Map(state.photos);
      const existed = photos.get(record.id);
      photos.set(record.id, record);
      if (existed) return { photos };
      const withGPS = state.status.withGPS + (record.hasGPS ? 1 : 0);
      const withoutGPS = state.status.withoutGPS + (record.hasGPS ? 0 : 1);
      return {
        photos,
        status: {
          ...state.status,
          processed: state.status.processed + 1,
          withGPS,
          withoutGPS,
        },
      };
    });
  },

  removePhoto: async (id: string) => {
    const existing = get().photos.get(id);
    await photoRepository.remove(id);
    objectUrlCache.revokeForPhoto(id);
    set((state) => {
      const photos = new Map(state.photos);
      photos.delete(id);
      if (!existing) return { photos };
      return {
        photos,
        status: {
          ...state.status,
          processed: Math.max(0, state.status.processed - 1),
          withGPS: existing.hasGPS ? Math.max(0, state.status.withGPS - 1) : state.status.withGPS,
          withoutGPS: existing.hasGPS
            ? state.status.withoutGPS
            : Math.max(0, state.status.withoutGPS - 1),
        },
      };
    });
  },

  setDateFilter: (range) => set({ dateFilter: range }),

  setSelectedPhoto: (id) => set({ selectedPhotoId: id }),

  clearAll: async () => {
    await photoRepository.clearAll();
    set({ photos: new Map(), status: { ...initialStatus }, dateFilter: null, selectedPhotoId: null });
  },

  setStatus: (patch) => set((state) => ({ status: { ...state.status, ...patch } })),

  resetIngestCounters: (total: number) =>
    set((state) => ({
      status: { ...state.status, total: state.status.total + total, parsing: true },
    })),

  setSearchFilters: (filters) => set({ searchFilters: filters }),

  reconcileId: (oldId, newRecord) => {
    set((state) => {
      if (!state.photos.has(oldId)) return {};
      const photos = new Map(state.photos);
      photos.delete(oldId);
      photos.set(newRecord.id, newRecord);
      const selectedPhotoId =
        state.selectedPhotoId === oldId ? newRecord.id : state.selectedPhotoId;
      return { photos, selectedPhotoId };
    });
  },

  reassignLocation: async (id, lat, lon) => {
    const prior = get().photos.get(id);
    if (!prior) return;

    set((state) => {
      const existing = state.photos.get(id);
      if (!existing) return {};
      const photos = new Map(state.photos);
      photos.set(id, { ...existing, lat, lon, hasGPS: true, groupKey: gridKey(lat, lon) });
      const withGPS = existing.hasGPS ? state.status.withGPS : state.status.withGPS + 1;
      const withoutGPS = existing.hasGPS
        ? state.status.withoutGPS
        : Math.max(0, state.status.withoutGPS - 1);
      return { photos, status: { ...state.status, withGPS, withoutGPS } };
    });

    try {
      await getActiveRepository().updateLocation(id, lat, lon);
    } catch (err) {
      // Roll back to the exact prior record/counts — a rejected location is never silently
      // shown as accepted.
      set((state) => {
        const photos = new Map(state.photos);
        photos.set(id, prior);
        const withGPS = prior.hasGPS ? state.status.withGPS : Math.max(0, state.status.withGPS - 1);
        const withoutGPS = prior.hasGPS ? state.status.withoutGPS : state.status.withoutGPS + 1;
        return { photos, status: { ...state.status, withGPS, withoutGPS } };
      });
      throw err;
    }
  },
}));
