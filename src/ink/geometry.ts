/** Small 2D helpers shared by the erasers and the layout code. All pure. */

export interface Vec {
  x: number;
  y: number;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from point `p` to the segment `a`–`b`. */
export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  // Project p onto the line, then clamp so the foot stays on the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Positive, negative or zero according to which side of the line `a`–`b` point `c` is on. */
function side(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Shortest distance between segments `a`–`b` and `c`–`d`.
 *
 * In 2D two segments either cross (distance 0) or their closest approach involves at
 * least one endpoint, so four point-to-segment checks cover every other case.
 */
export function segmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
