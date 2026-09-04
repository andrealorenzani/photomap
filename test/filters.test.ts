import { describe, expect, it } from 'vitest';
import { applyFilters, distinctCameraMakes, distinctCameraModels } from '../src/lib/filters';
import type { PhotoRecord } from '../src/types';

function photo(id: string, overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id,
    fileName: `${id}.jpg`,
    relativePath: `${id}.jpg`,
    size: 10,
    lastModified: 0,
    hasGPS: false,
    hasPreview: false,
    ...overrides,
  };
}

describe('applyFilters', () => {
  const photos = [
    photo('a', { takenAtISO: '2020-01-01T00:00:00.000Z', cameraMake: 'Canon', cameraModel: 'EOS 5D', hasGPS: true }),
    photo('b', { takenAtISO: '2021-06-15T00:00:00.000Z', cameraMake: 'Nikon', cameraModel: 'D850', hasGPS: false }),
    photo('c', { cameraMake: 'Canon', cameraModel: 'R5', hasGPS: true }), // no takenAtISO
  ];

  it('with no filters set, returns everything unchanged', () => {
    expect(applyFilters(photos, {})).toEqual(photos);
  });

  it('filters by date range (inclusive of photos with dates in range, excludes undated)', () => {
    const result = applyFilters(photos, {
      dateStart: new Date('2020-06-01T00:00:00.000Z'),
      dateEnd: new Date('2021-12-31T00:00:00.000Z'),
    });
    expect(result.map((p) => p.id)).toEqual(['b']);
  });

  it('filters by camera make', () => {
    const result = applyFilters(photos, { cameraMake: 'Canon' });
    expect(result.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });

  it('filters by camera model', () => {
    const result = applyFilters(photos, { cameraModel: 'D850' });
    expect(result.map((p) => p.id)).toEqual(['b']);
  });

  it('filters by hasLocation: located', () => {
    const result = applyFilters(photos, { hasLocation: 'located' });
    expect(result.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });

  it('filters by hasLocation: unlocated', () => {
    const result = applyFilters(photos, { hasLocation: 'unlocated' });
    expect(result.map((p) => p.id)).toEqual(['b']);
  });

  it('composes multiple filter dimensions together (AND semantics)', () => {
    const result = applyFilters(photos, { cameraMake: 'Canon', hasLocation: 'located' });
    expect(result.map((p) => p.id).sort()).toEqual(['a', 'c']);

    const none = applyFilters(photos, { cameraMake: 'Canon', hasLocation: 'unlocated' });
    expect(none).toEqual([]);
  });
});

describe('distinctCameraMakes / distinctCameraModels', () => {
  it('returns sorted, deduplicated, defined-only values', () => {
    const photos = [
      photo('a', { cameraMake: 'Nikon' }),
      photo('b', { cameraMake: 'Canon' }),
      photo('c', { cameraMake: 'Canon' }),
      photo('d', {}),
    ];
    expect(distinctCameraMakes(photos)).toEqual(['Canon', 'Nikon']);
  });

  it('distinctCameraModels mirrors the same behavior for models', () => {
    const photos = [
      photo('a', { cameraModel: 'D850' }),
      photo('b', { cameraModel: 'EOS 5D' }),
      photo('c', {}),
    ];
    expect(distinctCameraModels(photos)).toEqual(['D850', 'EOS 5D']);
  });
});
