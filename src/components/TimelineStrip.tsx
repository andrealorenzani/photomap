import { useEffect, useMemo, useRef } from 'react';
import { usePhotoStore } from '../state/photoStore';
import {
  adaptiveBinCount,
  binIndexForOffset,
  binIntensity,
  computeBins,
  computeDomain,
  photosWithUnknownDate,
  type TimelineBin,
} from '../lib/timeline';
import './TimelineStrip.css';

const HEIGHT = 72;
const UNKNOWN_SEGMENT_WIDTH = 90;

export function TimelineStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const photos = usePhotoStore((s) => s.photos);
  const dateFilter = usePhotoStore((s) => s.dateFilter);
  const setDateFilter = usePhotoStore((s) => s.setDateFilter);

  const allPhotos = useMemo(() => Array.from(photos.values()), [photos]);
  const domain = useMemo(() => computeDomain(allPhotos), [allPhotos]);
  const unknownDatePhotos = useMemo(() => photosWithUnknownDate(allPhotos), [allPhotos]);

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

  useEffect(() => {
    function render() {
      const container = containerRef.current;
      if (!container) return;
      const totalWidth = container.clientWidth || 800;
      const mainWidth = Math.max(50, totalWidth - UNKNOWN_SEGMENT_WIDTH);
      const binCount = adaptiveBinCount(mainWidth, domain);
      const bins = computeBins(allPhotos, domain, binCount);
      binsRef.current = bins;
      mainWidthRef.current = mainWidth;
      draw(bins, mainWidth);
    }

    render();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(render) : undefined;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', render);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [allPhotos, domain, draw]);

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const mainWidth = mainWidthRef.current;

    if (offsetX >= mainWidth) {
      if (unknownDatePhotos.length > 0) {
        setDateFilter({ start: new Date(0), end: new Date(0), isUnknownBucket: true });
      }
      return;
    }

    const bins = binsRef.current;
    if (bins.length === 0) return;
    const idx = binIndexForOffset(offsetX, mainWidth, bins.length);
    const bin = bins[idx];
    if (!bin) return;
    setDateFilter({ start: bin.start, end: bin.end });
  }

  return (
    <div className="timeline-strip" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="timeline-strip__canvas"
        data-testid="timeline-canvas"
        onClick={handleClick}
        role="img"
        aria-label="Photo date density timeline"
      />
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
