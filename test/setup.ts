import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom doesn't implement ResizeObserver; TimelineStrip uses it to react to layout changes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom's canvas 2d context is not implemented (no native canvas backend in this environment).
// Component tests only need drawing calls to not throw, not real pixel output; pure binning /
// intensity / hit-testing math is covered separately in src/lib/timeline.ts unit tests.
const fake2dContext = {
  clearRect: () => {},
  fillRect: () => {},
  fillText: () => {},
  measureText: () => ({ width: 0 }) as TextMetrics,
  setTransform: () => {},
  save: () => {},
  restore: () => {},
  drawImage: () => {},
  fillStyle: '',
  font: '',
  strokeStyle: '',
} as unknown as CanvasRenderingContext2D;

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    if (contextId === '2d') return fake2dContext;
    return null;
  }) as typeof HTMLCanvasElement.prototype.getContext;
}
