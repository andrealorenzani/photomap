import { beforeEach, describe, expect, it } from 'vitest';
import { usePhotoStore } from '../src/state/photoStore';
import type { PhotoRecord } from '../src/types';

function photo(id: string, hasGPS: boolean): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS,
    lat: hasGPS ? 1 : undefined,
    lon: hasGPS ? 1 : undefined,
    hasPreview: false,
  };
}

function resetStore() {
  usePhotoStore.setState({
    photos: new Map(),
    status: { total: 0, processed: 0, withGPS: 0, withoutGPS: 0, skipped: 0, parsing: false, uploadFailures: 0 },
    dateFilter: null,
    selectedPhotoId: null,
  });
}

describe('photoStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('never drops no-GPS photos from state; status counts stay internally consistent', () => {
    usePhotoStore.getState().upsertPhoto(photo('gps1', true));
    usePhotoStore.getState().upsertPhoto(photo('nogps1', false));
    usePhotoStore.getState().upsertPhoto(photo('nogps2', false));

    const { photos, status } = usePhotoStore.getState();
    expect(photos.size).toBe(3);
    expect(photos.has('nogps1')).toBe(true);
    expect(status.processed).toBe(status.withGPS + status.withoutGPS);
    expect(status.withGPS).toBe(1);
    expect(status.withoutGPS).toBe(2);
  });

  it('upserting an existing id updates the record without double-counting status', () => {
    usePhotoStore.getState().upsertPhoto(photo('p1', false));
    usePhotoStore.getState().upsertPhoto({ ...photo('p1', false), fileName: 'renamed.jpg' });

    const { photos, status } = usePhotoStore.getState();
    expect(photos.size).toBe(1);
    expect(photos.get('p1')?.fileName).toBe('renamed.jpg');
    expect(status.processed).toBe(1);
    expect(status.withoutGPS).toBe(1);
  });

  it('removePhoto removes from state and updates counts immediately', async () => {
    usePhotoStore.getState().upsertPhoto(photo('gps1', true));
    usePhotoStore.getState().upsertPhoto(photo('nogps1', false));

    await usePhotoStore.getState().removePhoto('gps1');

    const { photos, status } = usePhotoStore.getState();
    expect(photos.has('gps1')).toBe(false);
    expect(photos.has('nogps1')).toBe(true);
    expect(status.withGPS).toBe(0);
    expect(status.withoutGPS).toBe(1);
    expect(status.processed).toBe(1);
  });

  it('removing a no-GPS photo updates its own count (reachability via timeline, not map)', async () => {
    usePhotoStore.getState().upsertPhoto(photo('nogps1', false));
    await usePhotoStore.getState().removePhoto('nogps1');

    const { status } = usePhotoStore.getState();
    expect(status.withoutGPS).toBe(0);
    expect(status.processed).toBe(0);
  });

  it('setDateFilter / clearing filter round-trips through state', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2020-02-01') };
    usePhotoStore.getState().setDateFilter(range);
    expect(usePhotoStore.getState().dateFilter).toEqual(range);
    usePhotoStore.getState().setDateFilter(null);
    expect(usePhotoStore.getState().dateFilter).toBeNull();
  });
});
