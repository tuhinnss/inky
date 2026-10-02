/**
 * Turns one symbol's vector strokes into the image the model expects.
 *
 * This is the bridge between the canvas and the network. It deliberately does not read
 * pixels back from the screen: the symbol is redrawn from its stroke coordinates,
 * straight into a 64×64 grid. That makes the model's input independent of the device
 * pixel ratio, of zoom, of ink colour and of whatever else is drawn nearby, and it means
 * a symbol written large and one written small produce the same image.
 *
 * Pure and synchronous, so it runs in the worker and is unit-tested without a browser.
 */

import { MODEL } from './model';

/** One stroke as flat `[x0, y0, x1, y1, …]` page coordinates, plus its pen width. */
export interface RasterStroke {
  coords: ArrayLike<number>;
  width: number;
}

export interface Frame {
  /** Page pixels to model pixels. */
  scale: number;
  /** Added after scaling, to centre the symbol. */
  offsetX: number;
  offsetY: number;
  /** Stroke thickness in model pixels. */
  strokeWidth: number;
}

/**
 * Works out how to place a symbol in the model's frame: centred on its bounding box,
 * scaled uniformly so its longer side spans {@link MODEL.inkExtent}, aspect ratio kept.
 *
 * The stroke is drawn at the user's real pen width, scaled along with the symbol. That
 * reproduces the model's training images, which were drawn with a fixed pen and then
 * shrunk to fit: a small symbol is shrunk less and so comes out with thicker strokes.
 * The width is clamped to the range the model was trained on, so an extreme pen setting
 * cannot push the image outside what it has seen.
 */
export function frameFor(strokes: readonly RasterStroke[]): Frame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let penWidth = 0;
  for (const { coords, width } of strokes) {
    penWidth = Math.max(penWidth, width);
    for (let i = 0; i + 1 < coords.length; i += 2) {
      const x = coords[i];
      const y = coords[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX === Infinity) {
    return { scale: 1, offsetX: 0, offsetY: 0, strokeWidth: MODEL.minStrokeWidth };
  }

  // Longer side of the centreline's box. The ink itself is one pen width larger.
  const extent = Math.max(maxX - minX, maxY - minY);

  let scale = MODEL.inkExtent / (extent + penWidth);
  let strokeWidth = penWidth * scale;
  if (strokeWidth < MODEL.minStrokeWidth || strokeWidth > MODEL.maxStrokeWidth) {
    strokeWidth = Math.min(MODEL.maxStrokeWidth, Math.max(MODEL.minStrokeWidth, strokeWidth));
    // Re-solve the scale so the ink still spans exactly inkExtent at the clamped width.
    scale = extent > 0 ? (MODEL.inkExtent - strokeWidth) / extent : 1;
  }

  return {
    scale,
    strokeWidth,
    offsetX: MODEL.size / 2 - ((minX + maxX) / 2) * scale,
    offsetY: MODEL.size / 2 - ((minY + maxY) / 2) * scale,
  };
}

/**
 * Draws one thick line segment with round ends, by distance.
 *
 * Each pixel near the segment is set to how much of it the stroke covers: 1 well inside,
 * 0 well outside, and a one-pixel ramp across the edge. That ramp is the anti-aliasing.
 * Overlapping segments keep the larger value, so joints and crossings do not get darker
 * than the rest of the line.
 *
 * @param size the image is `size` by `size` pixels, starting at `base` in `out`.
 */
export function drawSegment(
  out: Float32Array,
  base: number,
  size: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): void {
  const reach = radius + 1;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + reach));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + reach));

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5; // sample at the pixel's centre
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5;
      let t = lengthSquared === 0 ? 0 : ((cx - ax) * dx + (cy - ay) * dy) / lengthSquared;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const distance = Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy));

      const coverage = radius + 0.5 - distance;
      if (coverage <= 0) continue;
      const index = base + py * size + px;
      const value = coverage > 1 ? 1 : coverage;
      if (value > out[index]) out[index] = value;
    }
  }
}

/**
 * Renders a symbol into `out` at `offset`, as {@link MODEL.size}² floats: ink 1,
 * background 0. Writing into a caller-supplied buffer lets a whole batch of symbols share
 * one allocation, which then goes to the model as a single tensor.
 */
export function rasterizeSymbol(
  strokes: readonly RasterStroke[],
  out: Float32Array,
  offset = 0,
): void {
  const size = MODEL.size;
  out.fill(0, offset, offset + size * size);

  const { scale, offsetX, offsetY, strokeWidth } = frameFor(strokes);
  const radius = strokeWidth / 2;

  for (const { coords } of strokes) {
    const points = coords.length >> 1;
    let px = coords[0] * scale + offsetX;
    let py = coords[1] * scale + offsetY;
    if (points === 1) drawSegment(out, offset, size, px, py, px, py, radius);
    for (let i = 1; i < points; i++) {
      const x = coords[2 * i] * scale + offsetX;
      const y = coords[2 * i + 1] * scale + offsetY;
      drawSegment(out, offset, size, px, py, x, y, radius);
      px = x;
      py = y;
    }
  }
}
