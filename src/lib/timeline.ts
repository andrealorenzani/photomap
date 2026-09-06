import type { PhotoRecord } from '../types';

export interface TimelineBin {
  /** Inclusive start of the bin's date range. */
  start: Date;
  /** Exclusive end of the bin's date range. */
  end: Date;
  count: number;
  /** Present only for calendar-axis bins (see `CalendarBin` below) — a short axis-tick label
   * (e.g. "2024", "Mar", "17"). Absent for the original adaptive-width density bins. */
  label?: string;
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

/**
 * Calendar-axis navigation (year -> month -> day drill-down), layered on top of the existing
 * density-heatmap machinery above rather than replacing it: `TimelineStrip` reuses the same
 * `TimelineBin`/`binIntensity`/canvas-drawing pipeline for calendar-aligned bins, it just bins
 * by real calendar boundaries (a year, a month, a day) instead of equal-width adaptive slices.
 */
export interface CalendarBin extends TimelineBin {
  /** Short display label for the bin's axis tick (e.g. "2024", "Mar", "17"). Always present
   * (unlike the base `TimelineBin.label`, which is optional). */
  label: string;
}

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Sorted, unique calendar years with at least one dated photo, or `[now's year]` if none. */
export function yearsPresent(photos: PhotoRecord[], now: Date = new Date()): number[] {
  const years = new Set<number>();
  for (const p of photos) {
    if (!p.takenAtISO) continue;
    const d = new Date(p.takenAtISO);
    if (Number.isNaN(d.getTime())) continue;
    years.add(d.getFullYear());
  }
  if (years.size === 0) years.add(now.getFullYear());
  return Array.from(years).sort((a, b) => a - b);
}

/** One bin per year in `years`, each spanning that whole calendar year. */
export function computeYearBins(photos: PhotoRecord[], years: number[]): CalendarBin[] {
  return years.map((year) => {
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    return { start, end, count: photosInRange(photos, start, end).length, label: String(year) };
  });
}

/** 12 bins (Jan-Dec) for a single calendar year. */
export function computeMonthBins(photos: PhotoRecord[], year: number): CalendarBin[] {
  return MONTH_LABELS.map((label, month) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    return { start, end, count: photosInRange(photos, start, end).length, label };
  });
}

/** One bin per day of a single calendar month (`month` is 0-11). */
export function computeDayBins(photos: PhotoRecord[], year: number, month: number): CalendarBin[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const start = new Date(year, month, day);
    const end = new Date(year, month, day + 1);
    return { start, end, count: photosInRange(photos, start, end).length, label: String(day) };
  });
}
