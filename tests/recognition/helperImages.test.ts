import { describe, expect, it } from 'vitest';
import {
  CANVAS,
  drawCanvas,
  HELPER_PIXELS,
  HELPER_SIZE,
  mathexImage,
  mnistImage,
} from '../../src/recognition/helperImages';
import type { RasterStroke } from '../../src/recognition/rasterize';
import { ink } from '../fixtures/ink';
import { toRaster } from './helpers';

const stroke = (coords: number[], width = 4): RasterStroke => ({ coords, width });
const digit = (char: string, size = 80, x = 0, y = 0): RasterStroke[] =>
  toRaster(ink(char, { size, x, y, wobble: 0 })[0].strokes);

function canvasOf(strokes: readonly RasterStroke[], pen: number): Float32Array {
  const canvas = new Float32Array(CANVAS * CANVAS);
  drawCanvas(strokes, pen, canvas);
  return canvas;
}

/** Bounding box and centre of mass of the ink in a square image. */
function measure(image: ArrayLike<number>, size: number, threshold: number) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = image[y * size + x];
      total += value;
      sumX += x * value;
      sumY += y * value;
      if (value <= threshold) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centreX: sumX / total,
    centreY: sumY / total,
    total,
  };
}

/** The middle of the canvas, counted in pixel indices: between pixels 139 and 140. */
const MIDDLE = (CANVAS - 1) / 2;

describe('drawing a symbol as a canvas app would save it', () => {
  it('centres the symbol and makes its longer side 200 px', () => {
    const box = measure(canvasOf(digit('7'), 6), CANVAS, 0.5);
    expect(box.height).toBeGreaterThanOrEqual(200);
    expect(box.height).toBeLessThanOrEqual(208); // 200 plus the pen
    expect((box.minY + box.maxY) / 2).toBeCloseTo(MIDDLE, 0);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(MIDDLE, 0);
  });

  it('draws the same picture however large or wherever the symbol was written', () => {
    const small = canvasOf(digit('5', 30, 10, 10), 6);
    const large = canvasOf(digit('5', 240, 900, 400), 6);
    let different = 0;
    for (let i = 0; i < small.length; i++) if (Math.abs(small[i] - large[i]) > 0.5) different++;
    expect(different / small.length).toBeLessThan(0.005);
  });

  it('draws a thicker line with a wider pen', () => {
    const thin = measure(canvasOf(digit('1'), 6), CANVAS, 0.5).total;
    const thick = measure(canvasOf(digit('1'), 16), CANVAS, 0.5).total;
    expect(thick).toBeGreaterThan(thin * 2);
  });

  it('draws a single point as a dot in the middle', () => {
    const box = measure(canvasOf([stroke([50, 50])], 16), CANVAS, 0.5);
    expect(box.width).toBeCloseTo(16, -1);
    expect(box.centreX).toBeCloseTo(MIDDLE, 0);
    expect(box.centreY).toBeCloseTo(MIDDLE, 0);
  });

  it('clears what was in the buffer before', () => {
    const canvas = new Float32Array(CANVAS * CANVAS).fill(1);
    drawCanvas(digit('1'), 6, canvas);
    expect(measure(canvas, CANVAS, 0.5).width).toBeLessThan(60);
  });

  it('leaves the canvas blank for a symbol with no points', () => {
    expect(canvasOf([], 6).every((value) => value === 0)).toBe(true);
    expect(canvasOf([stroke([])], 6).every((value) => value === 0)).toBe(true);
  });
});

describe('the image for the mathex model', () => {
  const image = (strokes: readonly RasterStroke[]): Float32Array => {
    const out = new Float32Array(HELPER_PIXELS);
    mathexImage(canvasOf(strokes, 6), out);
    return out;
  };

  it('is 28 by 28 with values from 0 to 255', () => {
    const out = image(digit('8'));
    expect(out).toHaveLength(HELPER_PIXELS);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
  });

  it('stretches the symbol to fill the frame, as upstream does, ignoring its proportions', () => {
    // A "1" is a thin upright stroke. Squeezed to fill the frame, it becomes wide.
    const box = measure(image(digit('1')), HELPER_SIZE, 64);
    expect(box.width).toBeGreaterThan(HELPER_SIZE * 0.6);
    expect(box.height).toBeGreaterThan(HELPER_SIZE * 0.8);
  });

  it('starts the symbol at the top-left corner, with upstream’s margin right and below', () => {
    const box = measure(image(digit('7')), HELPER_SIZE, 64);
    expect(box.minX).toBeLessThanOrEqual(1);
    expect(box.minY).toBeLessThanOrEqual(1);
    expect(box.maxX).toBeLessThan(HELPER_SIZE - 1);
  });

  it('writes at the offset it is given and nowhere else', () => {
    const out = new Float32Array(HELPER_PIXELS * 3).fill(7);
    mathexImage(canvasOf(digit('3'), 6), out, HELPER_PIXELS);
    expect(out[0]).toBe(7);
    expect(out[HELPER_PIXELS * 2]).toBe(7);
    expect(Array.from(out.subarray(HELPER_PIXELS, HELPER_PIXELS * 2))).toEqual(
      Array.from(image(digit('3'))),
    );
  });

  it('is blank for a blank canvas', () => {
    const out = new Float32Array(HELPER_PIXELS).fill(9);
    mathexImage(new Float32Array(CANVAS * CANVAS), out);
    expect(out.every((value) => value === 0)).toBe(true);
  });
});

describe('the image for the MNIST model', () => {
  const image = (strokes: readonly RasterStroke[]): Float32Array => {
    const out = new Float32Array(HELPER_PIXELS);
    mnistImage(canvasOf(strokes, 16), out);
    return out;
  };

  it('is 28 by 28 with values from 0 to 1', () => {
    const out = image(digit('8'));
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBeGreaterThan(0.9);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  it.each(['0', '1', '4', '7', '8'])('fits "%s" inside a 20 by 20 box', (char) => {
    const box = measure(image(digit(char)), HELPER_SIZE, 0.02);
    expect(box.width).toBeLessThanOrEqual(20);
    expect(box.height).toBeLessThanOrEqual(20);
    expect(Math.max(box.width, box.height)).toBeGreaterThanOrEqual(19);
  });

  it('keeps the proportions of the symbol', () => {
    const box = measure(image(digit('1')), HELPER_SIZE, 0.02);
    expect(box.height).toBeGreaterThan(box.width * 2);
  });

  it.each(['2', '4', '6', '7', '9'])('puts the centre of mass of "%s" at the centre', (char) => {
    const box = measure(image(digit(char)), HELPER_SIZE, 0.02);
    // Placement is in whole pixels, so the centre can be off by up to half a pixel.
    expect(Math.abs(box.centreX - 13.5)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(box.centreY - 13.5)).toBeLessThanOrEqual(0.6);
  });

  it('is the same for small and large handwriting', () => {
    const small = image(digit('3', 30));
    const large = image(digit('3', 300, 500, 500));
    for (let i = 0; i < HELPER_PIXELS; i++) expect(Math.abs(small[i] - large[i])).toBeLessThan(0.2);
  });

  it('is blank for a blank canvas', () => {
    const out = new Float32Array(HELPER_PIXELS).fill(9);
    mnistImage(new Float32Array(CANVAS * CANVAS), out);
    expect(out.every((value) => value === 0)).toBe(true);
  });
});
