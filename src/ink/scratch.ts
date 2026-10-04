/**
 * Scratch-to-erase: scribbling over writing with the pen rubs it out, as on paper,
 * without picking up the eraser.
 *
 * A scribble is told from writing by how often it turns back on itself: at least four
 * times, each time after sweeping half its size, so five passes. Real writing does not
 * do that: none of 17,000 strokes of real handwritten digits and sums does, the loopiest
 * "8" included. And a scribble only erases what it covers; a zigzag drawn on empty paper
 * is kept as ink.
 */

import { strokeIsHit } from './eraser';
import { strokeBounds, type Stroke } from './types';

interface Vec {
  x: number;
  y: number;
}

/** A scribble turns back at least this many times along one direction... */
const MIN_TURNS = 4;
/**
 * ...each time after travelling at least this fraction of its size, the larger of its
 * width and height. Measured against the larger, the wobble of a shaky line, however
 * thin the line, is not a turn.
 */
const TURN_TRAVEL = 0.5;
/** A stroke is scratched out when at least this fraction of its points lie under the scribble. */
const COVERED = 0.5;

/** How many times the path turns back along one axis, each turn after a sweep of `travel`. */
function turnsAlong(points: readonly Vec[], axis: 'x' | 'y', travel: number): number {
  let turns = 0;
  let direction = 0; // +1 or -1 once the path has gone far enough one way
  let extreme = points[0][axis]; // the furthest the path has gone in that direction
  for (const p of points) {
    const v = p[axis];
    if (direction === 0) {
      if (Math.abs(v - extreme) >= travel) {
        direction = Math.sign(v - extreme);
        extreme = v;
      }
    } else if ((v - extreme) * direction > 0) {
      extreme = v; // still going the same way
    } else if (Math.abs(v - extreme) >= travel) {
      turns++;
      direction = -direction;
      extreme = v;
    }
  }
  return turns;
}

/** Whether the path is a scribble: back and forth, again and again, in one direction or another. */
export function isScribble(points: readonly Vec[]): boolean {
  if (points.length < 2 * (MIN_TURNS + 1)) return false;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(size > 0)) return false;
  const travel = TURN_TRAVEL * size;
  return Math.max(turnsAlong(points, 'x', travel), turnsAlong(points, 'y', travel)) >= MIN_TURNS;
}

/**
 * The strokes a scribble rubs out: those it touches that lie mostly under it, within the
 * box it covers. Writing it only grazes stays.
 *
 * @param width the scribble's pen width, so that it reaches as far as its ink does.
 */
export function scratchedOut(
  scribble: readonly Vec[],
  width: number,
  strokes: readonly Stroke[],
): Stroke[] {
  if (scribble.length === 0) return [];
  const pad = width / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of scribble) {
    minX = Math.min(minX, p.x - pad);
    minY = Math.min(minY, p.y - pad);
    maxX = Math.max(maxX, p.x + pad);
    maxY = Math.max(maxY, p.y + pad);
  }
  const inside = (p: Vec): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

  return strokes.filter((stroke) => {
    const bounds = strokeBounds(stroke);
    if (bounds.maxX < minX || bounds.minX > maxX || bounds.maxY < minY || bounds.minY > maxY) {
      return false;
    }
    const covered = stroke.points.filter(inside).length;
    if (covered < COVERED * stroke.points.length) return false;
    for (let i = 1; i < scribble.length; i++) {
      if (strokeIsHit(stroke, scribble[i - 1], scribble[i], pad)) return true;
    }
    return scribble.length === 1 && strokeIsHit(stroke, scribble[0], scribble[0], pad);
  });
}
