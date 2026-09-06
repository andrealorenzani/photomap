import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoRecord } from '../types';
import { usePhotoStore, type DateRange } from '../state/photoStore';
import {
  MONTH_LABELS,
  adaptiveBinCount,
  binIndexForOffset,
  binIntensity,
  computeBins,
  computeDayBins,
  computeDomain,
  computeMonthBins,
  computeYearBins,
  photosWithUnknownDate,
  yearsPresent,
  type TimelineBin,
} from '../lib/timeline';
import './TimelineStrip.css';

const HEIGHT = 72;
const UNKNOWN_SEGMENT_WIDTH = 90;

/**
 * Calendar-axis drill-down level. 'density' is the original, unchanged default view (a
 * continuous adaptive-bin heatmap across the full domain); 'year'/'month'/'day' are the new
 * calendar-aligned navigation levels layered on top, reusing the same bin/intensity/canvas
 * rendering pipeline as 'density'.
 */
type CalendarLevel = 'density' | 'year' | 'month' | 'day';

export interface TimelineStripProps {
  /** When supplied, bins this set instead of the global store (used by the read-only share
   * view, which keeps photo data in local component state, never the global Zustand store). */
  photos?: PhotoRecord[];
  /**
   * Controlled date-range selection. When supplied (with `onDateFilterChange`), the component
   * neither reads nor writes the global store's `dateFilter` — used by the share view, so
   * clicking its timeline doesn't leak into the main app's own timeline selection. Omitted (the
   * default), the component falls back to the global store exactly as before.
   */
  dateFilter?: DateRange | null;
  onDateFilterChange?: (range: DateRange | null) => void;
}

export function TimelineStrip({
  photos: photosProp,
  dateFilter: dateFilterProp,
  onDateFilterChange,
}: TimelineStripProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const storePhotos = usePhotoStore((s) => s.photos);
  const storeDateFilter = usePhotoStore((s) => s.dateFilter);
  const storeSetDateFilter = usePhotoStore((s) => s.setDateFilter);
  const controlled = onDateFilterChange !== undefined;
  const dateFilter = controlled ? dateFilterProp ?? null : storeDateFilter;
  const setDateFilter = controlled ? (onDateFilterChange as (r: DateRange | null) => void) : storeSetDateFilter;

  const allPhotos = useMemo(
    () => photosProp ?? Array.from(storePhotos.values()),
    [photosProp, storePhotos]
  );
  const domain = useMemo(() => computeDomain(allPhotos), [allPhotos]);
  const unknownDatePhotos = useMemo(() => photosWithUnknownDate(allPhotos), [allPhotos]);

  // Calendar-axis drill-down navigation (year -> month -> day), layered on top of the original
  // density-heatmap view ('density', the unchanged default) rather than replacing it.
  const [calendarLevel, setCalendarLevel] = useState<CalendarLevel>('density');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [mainWidth, setMainWidth] = useState(0);
  const years = useMemo(() => yearsPresent(allPhotos), [allPhotos]);

  function enterCalendarView() {
    setCalendarLevel('year');
    setSelectedYear(null);
    setSelectedMonth(null);
  }

  function exitCalendarView() {
    setCalendarLevel('density');
    setSelectedYear(null);
    setSelectedMonth(null);
  }

  const draw = useMemo(() => {
    return (bins: TimelineBin[], mainWidth: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const totalWidth = mainWidth + UNKNOWN_SEGMENT_WIDTH;
      canvas.width = Math.max(1, Math.round(totalWidth * dpr));
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${totalWidth}px`;
      canvas.style.height = `${HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, totalWidth, HEIGHT);

      const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);
      const binWidth = mainWidth / Math.max(1, bins.length);

      bins.forEach((bin, i) => {
        const intensity = binIntensity(bin.count, maxCount);
        const barHeight = Math.max(bin.count > 0 ? 2 : 0, intensity * (HEIGHT - 4));
        const isSelected =
          dateFilter &&
          !dateFilter.isUnknownBucket &&
          bin.start.getTime() === dateFilter.start.getTime();
        ctx.fillStyle = isSelected ? '#e0672a' : '#2f7de1';
        ctx.fillRect(i * binWidth, HEIGHT - barHeight, Math.max(1, binWidth - 1), barHeight);
      });

      // Unknown-date segment, drawn to the right of the main timeline.
      const unknownIntensity = unknownDatePhotos.length > 0 ? 1 : 0;
      const unknownHeight = unknownIntensity * (HEIGHT - 4);
      ctx.fillStyle = dateFilter?.isUnknownBucket ? '#e0672a' : '#999';
      ctx.fillRect(mainWidth + 8, HEIGHT - unknownHeight, UNKNOWN_SEGMENT_WIDTH - 16, unknownHeight || 4);
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      ctx.fillText('Unknown date', mainWidth + 8, HEIGHT - 2);
    };
  }, [dateFilter, unknownDatePhotos.length]);

  const binsRef = useRef<TimelineBin[]>([]);
  const mainWidthRef = useRef(0);
  // Mirrors calendar-mode bins into React state (rather than only the ref above) so the axis
  // label row re-renders reliably even when `mainWidth` itself doesn't change value between
  // calendar-navigation clicks (a same-value setState is a no-op in React, which would otherwise
  // leave the axis row showing a stale pre-navigation bin set).
  const [calendarBins, setCalendarBins] = useState<TimelineBin[] | null>(null);

  useEffect(() => {
    function render() {
      const container = containerRef.current;
      if (!container) return;
      const totalWidth = container.clientWidth || 800;
      const mainW = Math.max(50, totalWidth - UNKNOWN_SEGMENT_WIDTH);

      let bins: TimelineBin[];
      if (calendarLevel === 'year') {
        bins = computeYearBins(allPhotos, years);
        setCalendarBins(bins);
      } else if (calendarLevel === 'month' && selectedYear !== null) {
        bins = computeMonthBins(allPhotos, selectedYear);
        setCalendarBins(bins);
      } else if (calendarLevel === 'day' && selectedYear !== null && selectedMonth !== null) {
        bins = computeDayBins(allPhotos, selectedYear, selectedMonth);
        setCalendarBins(bins);
      } else {
        const binCount = adaptiveBinCount(mainW, domain);
        bins = computeBins(allPhotos, domain, binCount);
        setCalendarBins(null);
      }

      binsRef.current = bins;
      mainWidthRef.current = mainW;
      setMainWidth(mainW);
      draw(bins, mainW);
    }

    render();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(render) : undefined;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', render);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [allPhotos, domain, draw, calendarLevel, selectedYear, selectedMonth, years]);

  /**
   * At the 'year'/'month' calendar levels, selecting a bin drills further down; at 'day' (the
   * finest calendar granularity) and at 'density' (the original default view), selecting a bin
   * applies it as the date filter, exactly as the pre-calendar-axis behavior always did.
   */
  function selectBinAt(idx: number) {
    const bins = binsRef.current;
    const bin = bins[idx];
    if (!bin) return;

    if (calendarLevel === 'year') {
      setSelectedYear(years[idx]);
      setCalendarLevel('month');
      return;
    }
    if (calendarLevel === 'month') {
      setSelectedMonth(idx);
      setCalendarLevel('day');
      return;
    }
    setDateFilter({ start: bin.start, end: bin.end });
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const mw = mainWidthRef.current;

    if (offsetX >= mw) {
      if (unknownDatePhotos.length > 0) {
        setDateFilter({ start: new Date(0), end: new Date(0), isUnknownBucket: true });
      }
      return;
    }

    const bins = binsRef.current;
    if (bins.length === 0) return;
    const idx = binIndexForOffset(offsetX, mw, bins.length);
    selectBinAt(idx);
  }

  return (
    <div className="timeline-strip" ref={containerRef}>
      <div className="timeline-strip__nav" data-testid="timeline-calendar-nav">
        {calendarLevel === 'density' ? (
          <button type="button" onClick={enterCalendarView}>
            Browse by year / month / day
          </button>
        ) : (
          <>
            <button type="button" onClick={exitCalendarView}>
              Density timeline
            </button>
            <span aria-hidden="true"> › </span>
            <button
              type="button"
              onClick={() => {
                setCalendarLevel('year');
                setSelectedMonth(null);
              }}
              disabled={calendarLevel === 'year'}
            >
              Years
            </button>
            {selectedYear !== null && (
              <>
                <span aria-hidden="true"> › </span>
                <button
                  type="button"
                  onClick={() => setCalendarLevel('month')}
                  disabled={calendarLevel === 'month'}
                >
                  {selectedYear}
                </button>
              </>
            )}
            {selectedYear !== null && selectedMonth !== null && calendarLevel === 'day' && (
              <>
                <span aria-hidden="true"> › </span>
                <span>{MONTH_LABELS[selectedMonth]}</span>
              </>
            )}
          </>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="timeline-strip__canvas"
        data-testid="timeline-canvas"
        onClick={handleClick}
        role="img"
        aria-label="Photo date density timeline"
      />
      {calendarBins && calendarBins.length > 0 && (
        <div
          className="timeline-strip__axis"
          data-testid="timeline-calendar-axis"
          style={{ width: `${mainWidth}px` }}
        >
          {calendarBins.map((bin, i) => (
            <button
              key={i}
              type="button"
              className="timeline-strip__axis-label"
              style={{ width: `${mainWidth / calendarBins.length}px` }}
              onClick={() => selectBinAt(i)}
            >
              {bin.label}
            </button>
          ))}
        </div>
      )}
      {dateFilter && (
        <button
          type="button"
          className="timeline-strip__clear"
          onClick={() => setDateFilter(null)}
        >
          Clear filter
        </button>
      )}
    </div>
  );
}
