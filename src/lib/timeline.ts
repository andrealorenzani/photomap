import type { PhotoRecord } from '../types';

export interface TimelineBin {
  /** Inclusive start of the bin's date range. */
  start: Date;
  /** Exclusive end of the bin's date range. */
  end: Date;
  count: number;
}

export interface TimelineDomain {
  min: Date;
  max: Date;
  /** True when there is no real date data and we fell back to "current year". */
  isFallback: boolean;
}

const MIN_BINS = 12;
const MAX_BINS = 366;

/** Computes the [min,max] date domain for a set of photos, or falls back to the current year. */
export function computeDomain(photos: PhotoRecord[], now: Date = new Date()): TimelineDomain {
  const dates = photos
    .map((p) => (p.takenAtISO ? new Date(p.takenAtISO) : undefined))
    .filter((d): d is Date => d !== undefined && !Number.isNaN(d.getTime()));

  if (dates.length === 0) {
    return {
      min: new Date(now.getFullYear(), 0, 1),
      max: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      isFallback: true,
    };
  }

  let min = dates[0];
  let max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  // Guard against a zero-width domain (e.g. a single photo, or all photos on the same
  // millisecond) so that binning below always has a positive span to divide.
  if (min.getTime() === max.getTime()) {
    max = new Date(min.getTime() + 24 * 60 * 60 * 1000);
  }
  return { min, max, isFallback: false };
}

/** Picks an adaptive bin count based on available pixel width, clamped to [MIN_BINS, MAX_BINS]. */
export function adaptiveBinCount(widthPx: number, domain: TimelineDomain): number {
  const spanDays = (domain.max.getTime() - domain.min.getTime()) / (1000 * 60 * 60 * 24);
  const pxPerBin = 4; // don't bother with bins narrower than this
  const byWidth = Math.floor(widthPx / pxPerBin);
  const bySpan = Math.max(1, Math.ceil(spanDays));
  const count = Math.min(byWidth, bySpan);
  return Math.max(MIN_BINS, Math.min(MAX_BINS, count || MIN_BINS));
}

/** Buckets photos with a valid date into `binCount` equal-width bins across the domain. */
export function computeBins(
  photos: PhotoRecord[],
  domain: TimelineDomain,
  binCount: number
): TimelineBin[] {
  const span = domain.max.getTime() - domain.min.getTime();
  const binWidth = span / binCount;

  const bins: TimelineBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const start = new Date(domain.min.getTime() + i * binWidth);
    const end = new Date(domain.min.getTime() + (i + 1) * binWidth);
    bins.push({ start, end, count: 0 });
  }

  for (const photo of photos) {
    if (!photo.takenAtISO) continue;
    const t = new Date(photo.takenAtISO).getTime();
    if (Number.isNaN(t)) continue;
    if (t < domain.min.getTime() || t > domain.max.getTime()) continue;
    let idx = Math.floor((t - domain.min.getTime()) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }

  return bins;
}

/** Log-scaled bar intensity in [0,1] for a bin, given the max count across all bins. */
export function binIntensity(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  // log1p avoids a single very busy bin flattening the visual scale for everything else.
  return Math.log1p(count) / Math.log1p(maxCount);
}

/** Converts a pixel x-offset within a canvas of `widthPx` into the corresponding bin index. */
export function binIndexForOffset(offsetX: number, widthPx: number, binCount: number): number {
  const ratio = Math.min(Math.max(offsetX / widthPx, 0), 0.999999);
  return Math.floor(ratio * binCount);
}

/** Photos with no parseable takenAtISO — reachable via a dedicated "Unknown date" bin. */
export function photosWithUnknownDate(photos: PhotoRecord[]): PhotoRecord[] {
  return photos.filter((p) => {
    if (!p.takenAtISO) return true;
    return Number.isNaN(new Date(p.takenAtISO).getTime());
  });
}

/** Returns photos whose takenAtISO falls within [start, end) (inclusive start, exclusive end). */
export function photosInRange(photos: PhotoRecord[], start: Date, end: Date): PhotoRecord[] {
  return photos.filter((p) => {
    if (!p.takenAtISO) return false;
    const t = new Date(p.takenAtISO).getTime();
    if (Number.isNaN(t)) return false;
    return t >= start.getTime() && t < end.getTime();
  });
}
