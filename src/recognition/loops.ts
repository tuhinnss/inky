/**
 * Whether a symbol has a closed loop in its top half, as the head of a "9" does.
 *
 * Many people write a 9 with a long tail that curls back to the left, and the model
 * then reads it as a 3: the tail looks like the lower bowl of one. What a 3 does not have
 * is a closed loop at the top. Neither do 2, 5, 6 or 7, so finding one counts strongly
 * against those (see interpret.ts).
 */

import { distance, type Stroke } from '../ink';

interface Vec {
  x: number;
  y: number;
}

/** A loop's path is at least this long, as a fraction of the symbol's size... */
const LOOP_LENGTH = 0.6;
/** ...comes back to within this distance of where it started... */
const CLOSING_GAP = 0.08;
/** ...and is at least this wide and this tall: a stroke retracing itself is no loop. */
const LOOP_SIDE = 0.2;
/** Points are spaced this far apart along the stroke, as a fraction of the symbol's size. */
const STEP = 1 / 50;

/** Points every `step` along the path, so that distances along it can be counted in points. */
export function resample(points: readonly Vec[], step: number): Vec[] {
  if (points.length === 0 || step <= 0) return [];
  const out: Vec[] = [{ x: points[0].x, y: points[0].y }];
  let along = step; // distance into the current segment of the next point to place
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = distance(a, b);
    while (along <= length) {
      const t = along / length;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      along += step;
    }
    along -= length;
  }
  return out;
}

/**
 * Finds the largest closed loop in the strokes and reports whether its centre is in the
 * top half of the symbol. A loop is a stretch of one stroke that comes back to where it
 * began, whether it crosses itself or only touches.
 */
export function hasLoopAtTop(strokes: readonly Stroke[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const size = Math.max(maxX - minX, maxY - minY);
  if (!(size > 0)) return false;

  const step = size * STEP;
  const shortest = Math.ceil(LOOP_LENGTH / STEP);
  let best = 0;
  let bestCentreY = 0;
  for (const stroke of strokes) {
    const p = resample(stroke.points, step);
    for (let i = 0; i < p.length; i++) {
      let x0 = p[i].x;
      let x1 = p[i].x;
      let y0 = p[i].y;
      let y1 = p[i].y;
      for (let j = i + 1; j < p.length; j++) {
        x0 = Math.min(x0, p[j].x);
        x1 = Math.max(x1, p[j].x);
        y0 = Math.min(y0, p[j].y);
        y1 = Math.max(y1, p[j].y);
        if (j - i < shortest || distance(p[i], p[j]) > CLOSING_GAP * size) continue;
        if (x1 - x0 < LOOP_SIDE * size || y1 - y0 < LOOP_SIDE * size) continue;
        if (x1 - x0 + (y1 - y0) > best) {
          best = x1 - x0 + (y1 - y0);
          bestCentreY = (y0 + y1) / 2;
        }
      }
    }
  }
  return best > 0 && bestCentreY < (minY + maxY) / 2;
}
