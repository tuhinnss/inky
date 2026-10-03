/**
 * Selecting strokes with a lasso, and moving them. Pure functions on vectors, like the
 * erasers.
 */

import { createStroke, inkBounds, unionBounds, type Bounds, type Stroke } from './types';

interface XY {
  x: number;
  y: number;
}

/** A loop shorter than this many samples is a tap, not a lasso. */
const MIN_LOOP_POINTS = 3;

/**
 * Whether a point is inside a closed polygon, by counting how often a ray from it crosses
 * the edges: an odd number means inside. The polygon closes itself from its last point
 * back to its first, the way a lasso is understood to close however near its end comes
 * to its start.
 */
export function pointInPolygon(point: XY, polygon: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y) {
      const crossX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (point.x < crossX) inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a lasso takes a stroke: when more than half of the stroke lies inside it. A
 * loop drawn a little carelessly still takes a symbol whose tail pokes out, and leaves
 * a neighbour it only clips.
 */
export function lassoTakes(stroke: Stroke, loop: readonly XY[]): boolean {
  let inside = 0;
  for (const point of stroke.points) if (pointInPolygon(point, loop)) inside++;
  return inside * 2 > stroke.points.length;
}

/** The strokes a lasso takes, in drawing order. */
export function selectWithLasso(strokes: readonly Stroke[], loop: readonly XY[]): Stroke[] {
  if (loop.length < MIN_LOOP_POINTS) return [];
  return strokes.filter((stroke) => lassoTakes(stroke, loop));
}

/** The box around the ink of all the strokes, or null for none. */
export function selectionBounds(strokes: readonly Stroke[]): Bounds | null {
  if (strokes.length === 0) return null;
  return strokes.map(inkBounds).reduce(unionBounds);
}

/**
 * Copies of the strokes, moved. Strokes never change, so a move is a replacement: these
 * go into the page as the originals leave it, in one undoable edit.
 */
export function moveStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((stroke) =>
    createStroke(
      stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy, pressure: p.pressure })),
      stroke.width,
      stroke.color,
      stroke.simulatePressure,
    ),
  );
}

/** Whether a point is in a box grown by `padding` on every side. */
export function inBox(point: XY, box: Bounds, padding = 0): boolean {
  return (
    point.x >= box.minX - padding &&
    point.x <= box.maxX + padding &&
    point.y >= box.minY - padding &&
    point.y <= box.maxY + padding
  );
}
