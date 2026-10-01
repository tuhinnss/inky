import { createStroke, type Point, type Stroke } from '../../src/ink';

export function points(...coordinates: Array<[number, number]>): Point[] {
  return coordinates.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

/** A straight stroke sampled every `spacing` pixels. */
export function line(
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  { width = 2, spacing = 5 } = {},
): Stroke {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.round(length / spacing));
  const sampled: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    sampled.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, pressure: 0.5 });
  }
  return createStroke(sampled, width, '#000');
}

export function dot(x: number, y: number, width = 2): Stroke {
  return createStroke(points([x, y]), width, '#000');
}

export function ids(strokes: readonly Stroke[]): number[] {
  return strokes.map((stroke) => stroke.id);
}
