import { strokeBounds, type Bounds, type Stroke } from '../ink';

/** The measurements of a stroke that layout decisions are made from. */
export interface StrokeMetrics extends Bounds {
  stroke: Stroke;
  width: number;
  height: number;
  centreX: number;
  centreY: number;
}

/**
 * Strokes are immutable, so their measurements are computed once. The WeakMap drops an
 * entry when its stroke is garbage-collected, so this never needs clearing.
 */
const cache = new WeakMap<Stroke, StrokeMetrics>();

export function measure(stroke: Stroke): StrokeMetrics {
  let metrics = cache.get(stroke);
  if (!metrics) {
    const bounds = strokeBounds(stroke);
    metrics = {
      ...bounds,
      stroke,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      centreX: (bounds.minX + bounds.maxX) / 2,
      centreY: (bounds.minY + bounds.maxY) / 2,
    };
    cache.set(stroke, metrics);
  }
  return metrics;
}

/** A stroke that is much wider than tall: a minus sign, or one bar of "=" or "÷". */
export function isFlat(metrics: StrokeMetrics): boolean {
  return metrics.width > 0 && metrics.height <= 0.3 * metrics.width;
}

/**
 * The height of a typical digit among these strokes: the median height of the taller
 * ones. Operators and dots are short, so the lower half is ignored rather than averaged
 * in. This is the yardstick every other layout distance is measured against.
 */
export function lineHeight(metrics: readonly StrokeMetrics[]): number {
  const tallest = Math.max(...metrics.map((m) => m.height));
  const tall = metrics.filter((m) => m.height >= 0.5 * tallest).map((m) => m.height);
  const height = median(tall);
  // A group of only flat strokes ("- =") has no height to speak of; use its widths.
  return height > 0 ? height : Math.max(...metrics.map((m) => m.width), 1);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
