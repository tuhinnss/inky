import { describe, expect, it } from 'vitest';
import {
  backingStoreSize,
  clientToPage,
  deviceToPage,
  drawScale,
  pageToClient,
  pageToDevice,
  resolveBackingSize,
  sanitizeDpr,
} from '../../src/canvas/coords';

const DPRS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.625, 3, 4];

describe('backingStoreSize', () => {
  it('equals the CSS size at a ratio of 1', () => {
    expect(backingStoreSize({ width: 800, height: 600 }, 1)).toEqual({ width: 800, height: 600 });
  });

  it('doubles on a Retina display', () => {
    expect(backingStoreSize({ width: 800, height: 600 }, 2)).toEqual({ width: 1600, height: 1200 });
  });

  it('triples on a 3× phone', () => {
    expect(backingStoreSize({ width: 390, height: 844 }, 3)).toEqual({ width: 1170, height: 2532 });
  });

  it('rounds to whole pixels at fractional ratios', () => {
    expect(backingStoreSize({ width: 801, height: 601 }, 1.25)).toEqual({
      width: 1001, // 1001.25
      height: 751, // 751.25
    });
    expect(backingStoreSize({ width: 333, height: 333 }, 1.5)).toEqual({ width: 500, height: 500 });
  });

  it('handles fractional CSS sizes, as layout often produces', () => {
    expect(backingStoreSize({ width: 412.5, height: 300.25 }, 2)).toEqual({
      width: 825,
      height: 601, // 600.5 rounds up
    });
  });

  it('never returns a zero-sized canvas', () => {
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
  });

  it.each(DPRS)('always returns integers at ratio %s', (dpr) => {
    const size = backingStoreSize({ width: 1023.4, height: 767.9 }, dpr);
    expect(Number.isInteger(size.width)).toBe(true);
    expect(Number.isInteger(size.height)).toBe(true);
  });
});

describe('resolveBackingSize', () => {
  const css = { width: 801, height: 601 };

  it('computes from the ratio when the browser measured nothing', () => {
    expect(resolveBackingSize(css, 1.25)).toEqual({ width: 1001, height: 751 });
  });

  it('prefers a measurement that agrees to within a pixel', () => {
    // The element sits on the pixel grid such that it really covers 1002 × 751.
    expect(resolveBackingSize(css, 1.25, { width: 1002, height: 751 })).toEqual({
      width: 1002,
      height: 751,
    });
  });

  it('ignores a measurement that contradicts the device pixel ratio', () => {
    // Device emulation: the ratio says 2×, the measurement reports unscaled pixels.
    // Trusting it would give a half-resolution, blurry canvas.
    expect(resolveBackingSize({ width: 836, height: 500 }, 2, { width: 836, height: 500 })).toEqual(
      { width: 1672, height: 1000 },
    );
  });

  it('ignores a measurement that is wrong on only one axis', () => {
    expect(resolveBackingSize(css, 2, { width: 1602, height: 601 })).toEqual({
      width: 1602,
      height: 1202,
    });
  });
});

describe('sanitizeDpr', () => {
  it('passes real ratios through', () => {
    for (const dpr of DPRS) expect(sanitizeDpr(dpr)).toBe(dpr);
  });

  it('falls back to 1 for unusable values', () => {
    for (const bad of [0, -1, NaN, Infinity, undefined]) expect(sanitizeDpr(bad)).toBe(1);
  });

  it('makes backingStoreSize safe against a bad ratio', () => {
    expect(backingStoreSize({ width: 100, height: 50 }, NaN)).toEqual({ width: 100, height: 50 });
  });
});

describe('drawScale', () => {
  it('equals the device pixel ratio when nothing was rounded', () => {
    const css = { width: 800, height: 600 };
    expect(drawScale(css, backingStoreSize(css, 2))).toEqual({ x: 2, y: 2 });
  });

  it('absorbs backing-store rounding so the page still maps onto the whole canvas', () => {
    const css = { width: 801, height: 601 };
    const backing = backingStoreSize(css, 1.25);
    const scale = drawScale(css, backing);

    expect(scale.x).not.toBe(1.25);
    expect(scale.x).toBeCloseTo(1.25, 2);
    // The bottom-right corner of the page lands exactly on the last device pixel.
    expect(pageToDevice({ x: css.width, y: css.height }, scale)).toEqual({
      x: backing.width,
      y: backing.height,
    });
  });

  it('does not divide by zero for a collapsed canvas', () => {
    expect(drawScale({ width: 0, height: 0 }, { width: 1, height: 1 })).toEqual({ x: 1, y: 1 });
  });
});

describe('CSS pixels ↔ canvas pixels', () => {
  it.each(DPRS)('maps a page point to device pixels at ratio %s', (dpr) => {
    const css = { width: 800, height: 600 };
    const scale = drawScale(css, backingStoreSize(css, dpr));
    const device = pageToDevice({ x: 100, y: 40 }, scale);
    expect(device.x).toBeCloseTo(100 * dpr, 6);
    expect(device.y).toBeCloseTo(40 * dpr, 6);
  });

  it.each(DPRS)('round-trips page → device → page at ratio %s', (dpr) => {
    const css = { width: 1023.4, height: 767.9 };
    const scale = drawScale(css, backingStoreSize(css, dpr));
    for (const page of [
      { x: 0, y: 0 },
      { x: 12.5, y: 700.25 },
      { x: 1023.4, y: 767.9 },
    ]) {
      const back = deviceToPage(pageToDevice(page, scale), scale);
      expect(back.x).toBeCloseTo(page.x, 9);
      expect(back.y).toBeCloseTo(page.y, 9);
    }
  });

  it('keeps a stroke the same CSS size on every display', () => {
    // A 100 px stroke must span 100 CSS px whether the screen is 1× or 3×.
    for (const dpr of DPRS) {
      const css = { width: 800, height: 600 };
      const scale = drawScale(css, backingStoreSize(css, dpr));
      const start = pageToDevice({ x: 50, y: 0 }, scale);
      const end = pageToDevice({ x: 150, y: 0 }, scale);
      expect((end.x - start.x) / scale.x).toBeCloseTo(100, 9);
    }
  });
});

describe('clientToPage', () => {
  it('subtracts the canvas origin', () => {
    expect(clientToPage(250, 180, { left: 56, top: 0 })).toEqual({ x: 194, y: 180 });
  });

  it('is unaffected by the device pixel ratio: both sides are CSS pixels', () => {
    // Pointer events report CSS pixels at every ratio, so no scaling belongs here.
    const origin = { left: 10, top: 20 };
    expect(clientToPage(110, 120, origin)).toEqual({ x: 100, y: 100 });
  });

  it('handles a canvas scrolled partly out of view (negative origin)', () => {
    expect(clientToPage(30, 40, { left: -100, top: -250 })).toEqual({ x: 130, y: 290 });
  });

  it('preserves sub-pixel positions from high-resolution pens', () => {
    const page = clientToPage(100.375, 200.625, { left: 0.5, top: 0.25 });
    expect(page.x).toBeCloseTo(99.875, 9);
    expect(page.y).toBeCloseTo(200.375, 9);
  });

  it('is the inverse of pageToClient', () => {
    const origin = { left: 56.5, top: 12.25 };
    const page = { x: 321.5, y: 87.75 };
    expect(clientToPage(...toArgs(pageToClient(page, origin)), origin)).toEqual(page);
  });

  it('chains with pageToDevice to find the device pixel under the pointer', () => {
    const css = { width: 800, height: 600 };
    const scale = drawScale(css, backingStoreSize(css, 2));
    const page = clientToPage(156, 100, { left: 56, top: 0 });
    expect(pageToDevice(page, scale)).toEqual({ x: 200, y: 200 });
  });
});

function toArgs(position: { x: number; y: number }): [number, number] {
  return [position.x, position.y];
}
