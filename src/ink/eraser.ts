/**
 * Both erasers, as pure geometry on vector strokes.
 *
 * One pointer move sweeps the round eraser tip from `from` to `to`, covering a capsule
 * (a rectangle with rounded ends). A point of ink is erased when the eraser tip overlaps
 * it, that is when the stroke's centreline comes within `radius + width / 2` of the
 * capsule's axis.
 */

import {
  distance,
  distanceToSegment,
  lerp,
  pathLength,
  segmentDistance,
  type Vec,
} from './geometry';
import { boundsIntersect, createStroke, strokeBounds, type Point, type Stroke } from './types';

function eraserReach(stroke: Stroke, radius: number): number {
  return radius + stroke.width / 2;
}

function nearEraser(stroke: Stroke, from: Vec, to: Vec, reach: number): boolean {
  return boundsIntersect(strokeBounds(stroke), {
    minX: Math.min(from.x, to.x) - reach,
    minY: Math.min(from.y, to.y) - reach,
    maxX: Math.max(from.x, to.x) + reach,
    maxY: Math.max(from.y, to.y) + reach,
  });
}

/** Stroke eraser: does the sweep touch this stroke anywhere? */
export function strokeIsHit(stroke: Stroke, from: Vec, to: Vec, radius: number): boolean {
  const reach = eraserReach(stroke, radius);
  if (!nearEraser(stroke, from, to, reach)) return false;

  const points = stroke.points;
  if (points.length === 1) return distanceToSegment(points[0], from, to) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (segmentDistance(points[i - 1], points[i], from, to) <= reach) return true;
  }
  return false;
}

function interpolate(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), pressure: lerp(a.pressure, b.pressure, t) };
}

/**
 * Finds where the stroke leaves the eraser between an erased sample and a surviving
 * one. Halving the interval ten times pins the edge to 1/1024 of the sample spacing,
 * far below a pixel, without solving the capsule intersection analytically.
 */
function findEdge(erased: Point, kept: Point, from: Vec, to: Vec, reach: number): Point {
  let low = 0; // towards `erased`
  let high = 1; // towards `kept`
  for (let i = 0; i < 10; i++) {
    const middle = (low + high) / 2;
    if (distanceToSegment(interpolate(erased, kept, middle), from, to) < reach) low = middle;
    else high = middle;
  }
  return interpolate(erased, kept, high);
}

/**
 * Pixel eraser: removes only the part of the stroke under the sweep.
 *
 * @returns `null` if the stroke is untouched, otherwise the surviving pieces as new
 *   strokes. An empty array means the whole stroke was erased.
 *
 * The result is still vector ink. That is the point of doing this geometrically rather
 * than clearing pixels: recognition keeps working on exact stroke data after any
 * amount of erasing.
 */
export function eraseFromStroke(
  stroke: Stroke,
  from: Vec,
  to: Vec,
  radius: number,
): Stroke[] | null {
  const reach = eraserReach(stroke, radius);
  if (!nearEraser(stroke, from, to, reach)) return null;

  // 1. Resample. Pointer samples can be far apart on a fast stroke, far enough for a
  //    small eraser to pass between two of them. Segments near the sweep are therefore
  //    subdivided so that no gap is wider than the eraser can slip through.
  const step = Math.max(0.5, reach / 3);
  const samples: Point[] = [];
  const points = stroke.points;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    samples.push(a);
    if (segmentDistance(a, b, from, to) > reach) continue;
    const pieces = Math.ceil(distance(a, b) / step);
    for (let k = 1; k < pieces; k++) samples.push(interpolate(a, b, k / pieces));
  }
  samples.push(points[points.length - 1]);

  // 2. Classify every sample, then cut the run of samples wherever that flips.
  const erased = samples.map((sample) => distanceToSegment(sample, from, to) < reach);
  if (!erased.includes(true)) return null;

  const fragments: Point[][] = [];
  let current: Point[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (erased[i]) {
      if (current.length > 0) {
        current.push(findEdge(samples[i], samples[i - 1], from, to, reach));
        fragments.push(current);
        current = [];
      }
      continue;
    }
    if (i > 0 && erased[i - 1]) current.push(findEdge(samples[i - 1], samples[i], from, to, reach));
    current.push(samples[i]);
  }
  if (current.length > 0) fragments.push(current);

  // 3. Drop crumbs shorter than the pen is wide: they would render as stray specks and,
  //    worse, could later be mistaken for decimal points.
  return fragments
    .filter((fragment) => pathLength(fragment) >= stroke.width)
    .map((fragment) => createStroke(fragment, stroke.width, stroke.color, stroke.simulatePressure));
}
