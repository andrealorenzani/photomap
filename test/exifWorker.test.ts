import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as exifr from 'exifr';
import { extractMeta } from '../src/workers/exifWorker';
import { isUsableGPS } from '../src/types';

function fixtureFile(name: string, type = 'image/jpeg'): File {
  const buf = readFileSync(path.join(__dirname, 'fixtures', name));
  return new File([buf], name, { type });
}

describe('extractMeta (worker EXIF pipeline, unit)', () => {
  it('parses GPS + DateTimeOriginal from a valid JPEG', async () => {
    const file = fixtureFile('with-gps-and-datetime.jpg');
    const meta = await extractMeta(file);
    expect(meta.lat).toBeCloseTo(45.4642, 3);
    expect(meta.lon).toBeCloseTo(9.1914, 3);
    expect(meta.takenAtISO).toBeDefined();
    expect(new Date(meta.takenAtISO!).getUTCFullYear()).toBe(2023);
    expect(isUsableGPS(meta.lat, meta.lon)).toBe(true);
  });

  it('classifies a datetime-only JPEG (no GPS) as "no GPS", not a failure', async () => {
    const file = fixtureFile('datetime-only-no-gps.jpg');
    const meta = await extractMeta(file);
    expect(meta.lat).toBeUndefined();
    expect(meta.lon).toBeUndefined();
    expect(meta.takenAtISO).toBeDefined();
    expect(isUsableGPS(meta.lat, meta.lon)).toBe(false);
  });

  it('treats GPS exactly (0,0) as no-GPS per the Null Island rule', async () => {
    const file = fixtureFile('null-island.jpg');
    const meta = await extractMeta(file);
    // exifr may still report 0,0 as the parsed coordinate; our classification rule (applied at
    // the ingest layer via isUsableGPS) is what must treat it as unusable.
    expect(isUsableGPS(meta.lat, meta.lon)).toBe(false);
  });

  it('does not throw when OffsetTimeOriginal is missing (falls back to DateTimeOriginal)', async () => {
    const file = fixtureFile('gps-no-offset.jpg');
    await expect(extractMeta(file)).resolves.toBeDefined();
    const meta = await extractMeta(file);
    expect(meta.takenAtISO).toBeDefined();
    expect(isUsableGPS(meta.lat, meta.lon)).toBe(true);
  });

  it('does not crash on a corrupted/truncated JPEG and returns empty metadata', async () => {
    const file = fixtureFile('corrupted-truncated.jpg');
    const meta = await extractMeta(file);
    expect(meta.lat).toBeUndefined();
    expect(meta.takenAtISO).toBeUndefined();
  });

  it('does not crash on a non-image file renamed to .jpg', async () => {
    const file = fixtureFile('not-an-image.jpg');
    await expect(extractMeta(file)).resolves.toBeDefined();
  });

  // The repo includes a real HEIC fixture (test/fixtures/with-gps-and-datetime.heic, produced
  // via ImageMagick) for manual/documentation purposes, but exifr fails to parse its EXIF box
  // ("Malformed EXIF data") — apparently an encoder-conformance quirk of that synthetic file,
  // not a real Phase 1 code path, and not practical to fix by regenerating without a real
  // device-produced sample. Per the plan's explicitly authorized fallback ("if not practical to
  // source/generate, document as a gap and rely on unit-level mocking of exifr's HEIC parsing
  // behavior instead"), this test mocks exifr's output to verify our extraction/mapping logic.
  describe('HEIC (mocked exifr output — see comment above for why)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('extracts HEIC metadata (GPS + datetime) even though thumbnail decode may be unsupported', async () => {
      vi.spyOn(exifr, 'parse').mockResolvedValueOnce({
        latitude: 45.4642,
        longitude: 9.1914,
        DateTimeOriginal: new Date('2023-06-15T10:30:00.000Z'),
      });
      const file = fixtureFile('with-gps-and-datetime.heic', 'image/heic');
      const meta = await extractMeta(file);
      expect(meta.lat).toBeCloseTo(45.4642, 2);
      expect(meta.lon).toBeCloseTo(9.1914, 2);
      expect(meta.takenAtISO).toBeDefined();
    });
  });
});

describe('isUsableGPS', () => {
  it('returns false for undefined coordinates', () => {
    expect(isUsableGPS(undefined, undefined)).toBe(false);
  });

  it('returns false for exact Null Island (0,0)', () => {
    expect(isUsableGPS(0, 0)).toBe(false);
  });

  it('returns true for any other coordinate pair, including 0-adjacent values', () => {
    expect(isUsableGPS(0, 5)).toBe(true);
    expect(isUsableGPS(5, 0)).toBe(true);
    expect(isUsableGPS(45.4642, 9.1914)).toBe(true);
  });

  it('returns false for NaN coordinates', () => {
    expect(isUsableGPS(NaN, NaN)).toBe(false);
  });
});
