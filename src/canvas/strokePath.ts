import { getStroke } from 'perfect-freehand';
import type { Point, Stroke } from '../ink';

/**
 * Turns the sampled centreline of a stroke into the outline of the ink.
 *
 * perfect-freehand smooths the samples and varies the width along the stroke, from real
 * pen pressure when there is any and from drawing speed when there is not. The result is
 * a closed polygon, which is filled rather than stroked. That is what makes the line look
 * like ink from a nib instead of a constant-width pipe.
 */
function outline(
  points: readonly Point[],
  width: number,
  simulatePressure: boolean,
  complete: boolean,
): number[][] {
  return getStroke(points as Point[], {
    size: width,
    thinning: 0.45,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure,
    // While the pen is still down the tail is provisional and must not be capped.
    last: complete,
  });
}

/**
 * Builds a smooth closed path through the outline: each polygon vertex becomes the
 * control point of a quadratic curve that ends halfway to the next vertex. The polygon's
 * corners are thereby rounded off, with no visible facets at any zoom.
 */
function toPath(vertices: number[][]): Path2D {
  const path = new Path2D();
  const count = vertices.length;
  if (count < 3) return path;

  const first = vertices[0];
  const second = vertices[1];
  path.moveTo((first[0] + second[0]) / 2, (first[1] + second[1]) / 2);
  for (let i = 1; i <= count; i++) {
    const current = vertices[i % count];
    const next = vertices[(i + 1) % count];
    path.quadraticCurveTo(
      current[0],
      current[1],
      (current[0] + next[0]) / 2,
      (current[1] + next[1]) / 2,
    );
  }
  path.closePath();
  return path;
}

/** Path for a stroke that is still being drawn. Recomputed every frame. */
export function livePath(
  points: readonly Point[],
  width: number,
  simulatePressure: boolean,
): Path2D {
  return toPath(outline(points, width, simulatePressure, false));
}

/**
 * Paths of finished strokes. Strokes are immutable, so a path never goes stale, and the
 * WeakMap lets it be collected together with its stroke once that is erased and has
 * left the undo history. A full redraw is then just one `fill` per stroke.
 */
const cache = new WeakMap<Stroke, Path2D>();

export function strokePath(stroke: Stroke): Path2D {
  let path = cache.get(stroke);
  if (!path) {
    path = toPath(outline(stroke.points, stroke.width, stroke.simulatePressure, true));
    cache.set(stroke, path);
  }
  return path;
}
