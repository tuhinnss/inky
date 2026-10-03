/**
 * The images the two digit-helper models expect.
 *
 * Each helper is a published model with its own published way of preparing an image.
 * Both start from a picture of the symbol as a drawing app would save it, and then crop
 * and shrink it to 28×28 in their own manner. A model reads only what looks like its
 * training data, so those steps are reproduced here as upstream wrote them, quirks
 * included, rather than replaced with something tidier.
 *
 * Pure and synchronous, like the main rasteriser, so it runs in the worker and is tested
 * without a browser.
 */

import { drawSegment, type RasterStroke } from './rasterize';

/** Side of the intermediate drawing, and how much of it the symbol's longer side spans. */
export const CANVAS = 280;
const EXTENT = 200;
/** Side of the image both helpers take. */
export const HELPER_SIZE = 28;
export const HELPER_PIXELS = HELPER_SIZE * HELPER_SIZE;

/** Ink coverage above this counts as ink when finding a symbol's bounding box. */
const INK = 64 / 255;

/**
 * Draws a symbol into `out` ({@link CANVAS}² floats, ink 1 on 0): centred, its longer
 * side spanning {@link EXTENT} pixels, with a pen `pen` pixels wide.
 */
export function drawCanvas(strokes: readonly RasterStroke[], pen: number, out: Float32Array): void {
  out.fill(0, 0, CANVAS * CANVAS);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { coords } of strokes) {
    for (let i = 0; i + 1 < coords.length; i += 2) {
      if (coords[i] < minX) minX = coords[i];
      if (coords[i] > maxX) maxX = coords[i];
      if (coords[i + 1] < minY) minY = coords[i + 1];
      if (coords[i + 1] > maxY) maxY = coords[i + 1];
    }
  }
  if (minX === Infinity) return;

  const scale = EXTENT / Math.max(maxX - minX, maxY - minY, 1e-6);
  const offsetX = (CANVAS - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (CANVAS - (maxY - minY) * scale) / 2 - minY * scale;

  for (const { coords } of strokes) {
    const points = coords.length >> 1;
    let px = coords[0] * scale + offsetX;
    let py = coords[1] * scale + offsetY;
    if (points === 1) drawSegment(out, 0, CANVAS, px, py, px, py, pen / 2);
    for (let i = 1; i < points; i++) {
      const x = coords[2 * i] * scale + offsetX;
      const y = coords[2 * i + 1] * scale + offsetY;
      drawSegment(out, 0, CANVAS, px, py, x, y, pen / 2);
      px = x;
      py = y;
    }
  }
}

interface Box {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** The smallest box around the pixels above `threshold`, or null if there are none. */
function inkBox(canvas: Float32Array, threshold: number): Box | null {
  let x0 = CANVAS;
  let y0 = CANVAS;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < CANVAS; y++) {
    const row = y * CANVAS;
    for (let x = 0; x < CANVAS; x++) {
      if (canvas[row + x] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The image for the mathex model, as its `segmentation.py` makes one: black-or-white
 * ink, cropped to the symbol plus ten pixels on the right and below, then squeezed to
 * 28×28 by plain bilinear sampling, ignoring the symbol's proportions. Values 0 to 255.
 *
 * @param canvas a drawing from {@link drawCanvas} with a 6 px pen.
 */
export function mathexImage(canvas: Float32Array, out: Float32Array, offset = 0): void {
  out.fill(0, offset, offset + HELPER_PIXELS);
  const half = 127 / 255;
  const box = inkBox(canvas, half);
  if (!box) return;

  const x1 = Math.min(box.x1 + 10, CANVAS);
  const y1 = Math.min(box.y1 + 10, CANVAS);
  const width = x1 - box.x0;
  const height = y1 - box.y0;
  const ink = (x: number, y: number): number =>
    canvas[(box.y0 + y) * CANVAS + box.x0 + x] > half ? 255 : 0;

  for (let row = 0; row < HELPER_SIZE; row++) {
    // Where this output pixel's centre falls in the crop: the sampling OpenCV's resize does.
    let fy = ((row + 0.5) * height) / HELPER_SIZE - 0.5;
    let ya = Math.floor(fy);
    fy -= ya;
    if (ya < 0) [ya, fy] = [0, 0];
    if (ya >= height - 1) [ya, fy] = [height - 1, 0];
    const yb = Math.min(ya + 1, height - 1);

    for (let col = 0; col < HELPER_SIZE; col++) {
      let fx = ((col + 0.5) * width) / HELPER_SIZE - 0.5;
      let xa = Math.floor(fx);
      fx -= xa;
      if (xa < 0) [xa, fx] = [0, 0];
      if (xa >= width - 1) [xa, fx] = [width - 1, 0];
      const xb = Math.min(xa + 1, width - 1);

      const upper = ink(xa, ya) * (1 - fx) + ink(xb, ya) * fx;
      const lower = ink(xa, yb) * (1 - fx) + ink(xb, yb) * fx;
      out[offset + row * HELPER_SIZE + col] = Math.round(upper * (1 - fy) + lower * fy);
    }
  }
}

/**
 * The image for the MNIST model, framed as the MNIST digits themselves were: the ink
 * scaled to fit a 20×20 box, keeping its proportions, and placed in the 28×28 frame so
 * that its centre of mass is at the centre. Values 0 to 1.
 *
 * @param canvas a drawing from {@link drawCanvas} with a 16 px pen.
 */
export function mnistImage(canvas: Float32Array, out: Float32Array, offset = 0): void {
  out.fill(0, offset, offset + HELPER_PIXELS);
  const box = inkBox(canvas, INK);
  if (!box) return;

  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const factor = 20 / Math.max(width, height);
  const smallW = Math.max(1, Math.round(width * factor));
  const smallH = Math.max(1, Math.round(height * factor));

  // Shrink by area: each small pixel is the average of the patch of the crop it covers,
  // edge pixels of the patch counted by the fraction of them that lies inside.
  const small = new Float32Array(smallW * smallH);
  const stepX = width / smallW;
  const stepY = height / smallH;
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (let sy = 0; sy < smallH; sy++) {
    const top = sy * stepY;
    const bottom = top + stepY;
    for (let sx = 0; sx < smallW; sx++) {
      const left = sx * stepX;
      const right = left + stepX;
      let sum = 0;
      for (let y = Math.floor(top); y < Math.min(Math.ceil(bottom), height); y++) {
        const coverY = Math.min(y + 1, bottom) - Math.max(y, top);
        const row = (box.y0 + y) * CANVAS + box.x0;
        for (let x = Math.floor(left); x < Math.min(Math.ceil(right), width); x++) {
          sum += canvas[row + x] * coverY * (Math.min(x + 1, right) - Math.max(x, left));
        }
      }
      const value = sum / (stepX * stepY);
      small[sy * smallW + sx] = value;
      total += value;
      sumX += sx * value;
      sumY += sy * value;
    }
  }

  const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));
  const placeX = clamp(Math.round(13.5 - sumX / (total || 1)), HELPER_SIZE - smallW);
  const placeY = clamp(Math.round(13.5 - sumY / (total || 1)), HELPER_SIZE - smallH);
  for (let sy = 0; sy < smallH; sy++) {
    for (let sx = 0; sx < smallW; sx++) {
      out[offset + (placeY + sy) * HELPER_SIZE + placeX + sx] = small[sy * smallW + sx];
    }
  }
}
