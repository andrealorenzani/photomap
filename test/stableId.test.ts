import { describe, expect, it } from 'vitest';
import { computeStableId, relativePathOf, stableIdForFile } from '../src/lib/stableId';

describe('computeStableId', () => {
  it('is deterministic for the same inputs', () => {
    const id1 = computeStableId('folder/photo.jpg', 12345, 1690000000000);
    const id2 = computeStableId('folder/photo.jpg', 12345, 1690000000000);
    expect(id1).toBe(id2);
  });

  it('differs when the relative path differs', () => {
    const id1 = computeStableId('a/photo.jpg', 12345, 1690000000000);
    const id2 = computeStableId('b/photo.jpg', 12345, 1690000000000);
    expect(id1).not.toBe(id2);
  });

  it('differs when the file size differs (changed file, same name)', () => {
    const id1 = computeStableId('a/photo.jpg', 12345, 1690000000000);
    const id2 = computeStableId('a/photo.jpg', 99999, 1690000000000);
    expect(id1).not.toBe(id2);
  });

  it('differs when lastModified differs', () => {
    const id1 = computeStableId('a/photo.jpg', 12345, 1690000000000);
    const id2 = computeStableId('a/photo.jpg', 12345, 1690000000001);
    expect(id1).not.toBe(id2);
  });
});

describe('relativePathOf / stableIdForFile', () => {
  it('falls back to file.name when webkitRelativePath is absent', () => {
    const file = new File(['x'], 'photo.jpg', { lastModified: 1000 });
    expect(relativePathOf(file)).toBe('photo.jpg');
  });

  it('produces the same id for the same file twice', () => {
    const file = new File(['x'], 'photo.jpg', { lastModified: 1000 });
    expect(stableIdForFile(file)).toBe(stableIdForFile(file));
  });
});
