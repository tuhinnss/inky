/**
 * Ink is stored as vectors, never as pixels. Everything downstream (rendering at any
 * device pixel ratio, erasing, grouping into symbols, recognition) reads these points.
 */

/** A sampled pen position in CSS pixels, relative to the top-left of the page. */
export interface Point {
  x: number;
  y: number;
  /** 0 to 1. Devices that do not report pressure give 0.5. */
  pressure: number;
}

export interface Stroke {
  /** Unique and increasing: a later stroke has a larger id and is drawn on top. */
  readonly id: number;
  readonly points: readonly Point[];
  /** Pen width in CSS pixels. */
  readonly width: number;
  readonly color: string;
  /**
   * True when the input device reported no real pressure (mouse, most touchscreens).
   * The renderer then varies the line width with drawing speed instead.
   */
  readonly simulatePressure: boolean;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

let nextStrokeId = 1;

export function createStroke(
  points: readonly Point[],
  width: number,
  color: string,
  simulatePressure = true,
): Stroke {
  return { id: nextStrokeId++, points, width, color, simulatePressure };
}

/** Bounding box of a stroke's centreline, grown by `padding` on every side. */
export function strokeBounds(stroke: Stroke, padding = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/** Bounding box of the ink itself: the centreline plus half the pen width. */
export function inkBounds(stroke: Stroke): Bounds {
  return strokeBounds(stroke, stroke.width / 2);
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
