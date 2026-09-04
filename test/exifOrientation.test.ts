import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resizeCanvas } from '../src/workers/exifWorker';

/**
 * Fake OffscreenCanvas/2D context recording width/height and the sequence of transform() calls,
 * so we can assert the orientation-correction transform matches the parsed EXIF tag without
 * needing a real (jsdom-unavailable) OffscreenCanvas/createImageBitmap implementation.
 */
class FakeCtx {
  public transforms: number[][] = [];
  public draws: unknown[] = [];
  transform(...args: number[]) {
    this.transforms.push(args);
  }
  drawImage(...args: unknown[]) {
    this.draws.push(args);
  }
}

class FakeOffscreenCanvas {
  public ctx = new FakeCtx();
  constructor(
    public width: number,
    public height: number
  ) {}
  getContext(kind: string) {
    return kind === '2d' ? this.ctx : null;
  }
}

function fakeBitmap(width: number, height: number) {
  return { width, height } as unknown as ImageBitmap;
}

describe('resizeCanvas EXIF orientation correction', () => {
  let originalOffscreenCanvas: unknown;

  beforeEach(() => {
    originalOffscreenCanvas = (globalThis as Record<string, unknown>).OffscreenCanvas;
    (globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreenCanvas;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).OffscreenCanvas = originalOffscreenCanvas;
  });

  it('orientation 1 (or undefined): no transform call, canvas dims match the scaled source (no swap)', () => {
    const canvas = resizeCanvas(fakeBitmap(2000, 1000), 200, 1, false) as unknown as FakeOffscreenCanvas;
    expect(canvas.ctx.transforms).toHaveLength(0);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
  });

  it('when the browser already applied orientation (orientationAppliedByBrowser=true), no manual transform is applied even for a rotate value', () => {
    const canvas = resizeCanvas(fakeBitmap(1000, 2000), 200, 6, true) as unknown as FakeOffscreenCanvas;
    expect(canvas.ctx.transforms).toHaveLength(0);
  });

  it('orientation 6 (rotate 90 CW): applies a transform and swaps canvas width/height relative to the scaled source', () => {
    // Source is landscape (1000x500); orientation 6 means the final image should be portrait.
    const canvas = resizeCanvas(fakeBitmap(1000, 500), 200, 6, false) as unknown as FakeOffscreenCanvas;
    expect(canvas.ctx.transforms).toHaveLength(1);
    const [a, b, c, d, e, f] = canvas.ctx.transforms[0];
    // Standard EXIF-6 correction matrix: transform(0, 1, -1, 0, drawHeight, 0).
    expect([a, b, c, d]).toEqual([0, 1, -1, 0]);
    expect(e).toBeGreaterThan(0);
    expect(f).toBe(0);
    // drawWidth=200, drawHeight=100 (scaled from 1000x500) -> swapped canvas is 100x200.
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);
  });

  it('orientation 3 (rotate 180): applies a flip-both transform with no dimension swap', () => {
    const canvas = resizeCanvas(fakeBitmap(1000, 500), 200, 3, false) as unknown as FakeOffscreenCanvas;
    const [a, b, c, d] = canvas.ctx.transforms[0];
    expect([a, b, c, d]).toEqual([-1, 0, 0, -1]);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
  });

  it('orientation 8 (rotate 270 CW / 90 CCW): applies a transform and swaps canvas dims', () => {
    const canvas = resizeCanvas(fakeBitmap(1000, 500), 200, 8, false) as unknown as FakeOffscreenCanvas;
    const [a, b, c, d] = canvas.ctx.transforms[0];
    expect([a, b, c, d]).toEqual([0, -1, 1, 0]);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);
  });
});
