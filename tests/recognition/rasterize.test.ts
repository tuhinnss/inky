import { describe, expect, it } from 'vitest';
import { createStroke } from '../../src/ink';
import { MODEL, PIXELS_PER_SYMBOL } from '../../src/recognition/model';
import { frameFor, rasterizeSymbol } from '../../src/recognition/rasterize';
import { ink } from '../fixtures/ink';
import { inkBox, rasterize, toRaster } from './helpers';

const horizontal = (length: number, penWidth = 4, x = 0, y = 0) =>
  createStroke(
    [
      { x, y, pressure: 0.5 },
      { x: x + length, y, pressure: 0.5 },
    ],
    penWidth,
    '#000',
  );
const vertical = (length: number, penWidth = 4) =>
  createStroke(
    [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 0, y: length, pressure: 0.5 },
    ],
    penWidth,
    '#000',
  );

function maxDifference(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('normalising a symbol to the model input', () => {
  it('produces one 64×64 image of floats', () => {
    const image = rasterize(ink('8', { size: 80 })[0].strokes);
    expect(image).toBeInstanceOf(Float32Array);
    expect(image).toHaveLength(64 * 64);
    expect(PIXELS_PER_SYMBOL).toBe(4096);
  });

  it('draws ink as 1 on a background of 0, never outside that range', () => {
    const image = rasterize(ink('8', { size: 80 })[0].strokes);
    expect(Math.min(...image)).toBe(0);
    expect(Math.max(...image)).toBe(1);
    expect(image[0]).toBe(0); // corners are background
    expect(image[image.length - 1]).toBe(0);
  });

  it('scales the longer side of the ink to fill 1/1.3 of the frame', () => {
    for (const char of ['0', '7', '+', '×']) {
      const box = inkBox(rasterize(ink(char, { size: 80, wobble: 0 })[0].strokes));
      expect(Math.max(box.width, box.height)).toBeGreaterThanOrEqual(48);
      expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(51);
    }
  });

  it('centres the symbol on its bounding box', () => {
    for (const char of ['2', '7', '9', '+']) {
      const box = inkBox(rasterize(ink(char, { size: 80, wobble: 0 })[0].strokes));
      const left = box.minX;
      const right = MODEL.size - 1 - box.maxX;
      const top = box.minY;
      const bottom = MODEL.size - 1 - box.maxY;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the aspect ratio: a tall stroke stays narrow', () => {
    const box = inkBox(rasterize([vertical(100)]));
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeLessThanOrEqual(6);
  });

  it('keeps the aspect ratio: a flat stroke stays thin', () => {
    const box = inkBox(rasterize([horizontal(100)]));
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeLessThanOrEqual(6);
  });

  it('pads the shorter side with background instead of stretching', () => {
    const image = rasterize([horizontal(100)]);
    const topRow = image.subarray(0, MODEL.size);
    expect(Math.max(...topRow)).toBe(0);
  });

  it('gives the same image wherever the symbol is on the page', () => {
    const near = rasterize(ink('5', { x: 0, y: 0, size: 80, wobble: 0 })[0].strokes);
    const far = rasterize(ink('5', { x: 2000, y: 3000, size: 80, wobble: 0 })[0].strokes);
    expect(maxDifference(near, far)).toBeLessThan(0.02);
  });

  it('gives the same image for the same symbol written at twice the size', () => {
    // Twice the size with twice the pen: geometrically the same drawing.
    const small = rasterize(ink('3', { size: 60, wobble: 0, penWidth: 3 })[0].strokes);
    const large = rasterize(ink('3', { size: 120, wobble: 0, penWidth: 6 })[0].strokes);
    // Not identical because the fixture samples a larger glyph more densely.
    expect(maxDifference(small, large)).toBeLessThan(0.35);
    expect(inkBox(small)).toEqual(inkBox(large));
  });

  it('combines the strokes of a multi-stroke symbol in one frame', () => {
    const [plus] = ink('+', { size: 80, wobble: 0 });
    expect(plus.strokes).toHaveLength(2);
    const box = inkBox(rasterize(plus.strokes));
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
    // The centre pixel is where the two bars cross.
    const image = rasterize(plus.strokes);
    expect(image[32 * MODEL.size + 32]).toBe(1);
  });

  it('does not let crossings get brighter than a single stroke', () => {
    const image = rasterize(ink('×', { size: 80, wobble: 0 })[0].strokes);
    expect(Math.max(...image)).toBe(1);
  });

  it('anti-aliases the stroke edge', () => {
    const image = rasterize(ink('0', { size: 80, wobble: 0 })[0].strokes);
    const partial = image.filter((value) => value > 0 && value < 1).length;
    expect(partial).toBeGreaterThan(50);
  });
});

describe('stroke width in the model frame', () => {
  it('scales the pen with the symbol, as the training images did', () => {
    // An 80 px symbol drawn with a 4 px pen shrinks to 49.2 px: the pen shrinks with it.
    const { strokeWidth, scale } = frameFor(toRaster([vertical(80, 4)]));
    expect(scale).toBeCloseTo(MODEL.inkExtent / 84, 5);
    expect(strokeWidth).toBeCloseTo(4 * scale, 5);
  });

  it('draws small symbols with relatively thicker strokes', () => {
    const small = frameFor(toRaster([horizontal(30, 4)])).strokeWidth;
    const large = frameFor(toRaster([horizontal(60, 4)])).strokeWidth;
    expect(small).toBeGreaterThan(large);
  });

  it('never goes thinner than the model was trained on', () => {
    const { strokeWidth } = frameFor(toRaster([vertical(400, 2.5)]));
    expect(strokeWidth).toBe(MODEL.minStrokeWidth);
  });

  it('never goes thicker than the model was trained on', () => {
    const { strokeWidth } = frameFor(toRaster([vertical(20, 9)]));
    expect(strokeWidth).toBe(MODEL.maxStrokeWidth);
  });

  it('still spans the full ink extent when the width is clamped', () => {
    for (const stroke of [vertical(400, 2.5), vertical(20, 9)]) {
      const box = inkBox(rasterize([stroke]));
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeLessThanOrEqual(51);
    }
  });
});

describe('degenerate input', () => {
  it('draws a single point as a centred dot without dividing by zero', () => {
    const dot = createStroke([{ x: 500, y: 300, pressure: 0.5 }], 4, '#000');
    const image = rasterize([dot]);
    expect(image.every(Number.isFinite)).toBe(true);
    const box = inkBox(image);
    expect(Math.abs(box.minX - (MODEL.size - 1 - box.maxX))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.minY - (MODEL.size - 1 - box.maxY))).toBeLessThanOrEqual(1);
  });

  it('renders nothing for a symbol with no strokes', () => {
    const image = new Float32Array(PIXELS_PER_SYMBOL).fill(0.5);
    rasterizeSymbol([], image);
    expect(Math.max(...image)).toBe(0);
  });

  it('copes with a stroke whose points all coincide', () => {
    const blob = createStroke(
      Array.from({ length: 5 }, () => ({ x: 10, y: 10, pressure: 0.5 })),
      4,
      '#000',
    );
    expect(rasterize([blob]).every(Number.isFinite)).toBe(true);
  });
});

describe('writing into a shared batch buffer', () => {
  it('fills only its own slot', () => {
    const batch = new Float32Array(3 * PIXELS_PER_SYMBOL).fill(-1);
    rasterizeSymbol(toRaster(ink('4', { size: 80 })[0].strokes), batch, PIXELS_PER_SYMBOL);

    expect(batch.subarray(0, PIXELS_PER_SYMBOL).every((value) => value === -1)).toBe(true);
    expect(batch.subarray(2 * PIXELS_PER_SYMBOL).every((value) => value === -1)).toBe(true);
    const slot = batch.subarray(PIXELS_PER_SYMBOL, 2 * PIXELS_PER_SYMBOL);
    expect(Math.min(...slot)).toBe(0);
    expect(Math.max(...slot)).toBe(1);
  });

  it('clears whatever was in its slot before', () => {
    const reused = new Float32Array(PIXELS_PER_SYMBOL);
    rasterizeSymbol(toRaster(ink('8', { size: 80, wobble: 0 })[0].strokes), reused);
    rasterizeSymbol(toRaster(ink('1', { size: 80, wobble: 0 })[0].strokes), reused);
    expect(maxDifference(reused, rasterize(ink('1', { size: 80, wobble: 0 })[0].strokes))).toBe(0);
  });
});
