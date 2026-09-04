import { create } from 'zustand';
import type { IngestStatus, PhotoRecord } from '../types';
import { photoRepository } from '../lib/db';
import { objectUrlCache } from '../lib/objectUrlCache';

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

  hydrateFromDB: () => Promise<void>;
  upsertPhoto: (record: PhotoRecord) => void;
  removePhoto: (id: string) => Promise<void>;
  setDateFilter: (range: DateRange | null) => void;
  setSelectedPhoto: (id: string | null) => void;
  clearAll: () => Promise<void>;
  setStatus: (patch: Partial<IngestStatus>) => void;
  resetIngestCounters: (total: number) => void;
}

const initialStatus: IngestStatus = {
  total: 0,
  processed: 0,
  withGPS: 0,
  withoutGPS: 0,
  skipped: 0,
  parsing: false,
};

export const usePhotoStore = create<PhotoStoreState>((set, get) => ({
  photos: new Map(),
  status: { ...initialStatus },
  dateFilter: null,
  selectedPhotoId: null,

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
}));
