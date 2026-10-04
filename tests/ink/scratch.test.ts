import { describe, expect, it } from 'vitest';
import { createStroke, isScribble, scratchedOut, type Stroke } from '../../src/ink';
import { ink, strokesOf } from '../fixtures/ink';
import { REAL_DIGITS } from '../fixtures/realDigits';

type P = { x: number; y: number };

/** Densely sampled points through the corners, as a pen would report them. */
function path(...corners: Array<[number, number]>): P[] {
  const points: P[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      points.push({ x: x0 + ((x1 - x0) * k) / steps, y: y0 + ((y1 - y0) * k) / steps });
    }
  }
  return points;
}

/** Back and forth across x0..x1, `passes` times, drifting down from y. */
function zigzag(x0: number, x1: number, y: number, passes: number, drift = 6): P[] {
  const corners: Array<[number, number]> = [];
  for (let i = 0; i <= passes; i++) corners.push([i % 2 === 0 ? x0 : x1, y + i * drift]);
  return path(...corners);
}

const stroke = (points: P[]): Stroke =>
  createStroke(
    points.map((p) => ({ ...p, pressure: 0.5 })),
    4,
    '#000',
  );

describe('a scribble', () => {
  it('goes back and forth five times or more', () => {
    expect(isScribble(zigzag(0, 60, 0, 5))).toBe(true);
    expect(isScribble(zigzag(0, 60, 0, 9))).toBe(true);
  });

  it('can go up and down as well as side to side', () => {
    expect(isScribble(zigzag(0, 60, 0, 7).map(({ x, y }) => ({ x: y, y: x })))).toBe(true);
  });

  it('is not a zigzag of four passes', () => {
    expect(isScribble(zigzag(0, 60, 0, 4))).toBe(false);
  });

  it('is not a line drawn with a shaky hand', () => {
    const shaky = path([0, 0], [80, 0]).map((p, i) => ({ x: p.x, y: p.y + (i % 2 ? 2 : -2) }));
    expect(isScribble(shaky)).toBe(false);
  });

  it('is not any digit or sign', () => {
    for (const symbol of ink('0123456789+-×÷=', { size: 80 })) {
      for (const s of symbol.strokes) expect(isScribble(s.points), symbol.char).toBe(false);
    }
  });

  it('is not any of the real handwritten digits', () => {
    for (const digit of REAL_DIGITS) {
      for (const flat of digit.strokes) {
        const points: P[] = [];
        for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
        expect(isScribble(points), `${digit.digit} #${digit.index}`).toBe(false);
      }
    }
  });
});

describe('what a scribble rubs out', () => {
  const written = ink('123', { x: 0, y: 0, size: 80, wobble: 0 });
  const [one, two, three] = written;
  const xs = (symbol: (typeof written)[number]) =>
    symbol.strokes.flatMap((s) => s.points.map((p) => p.x));

  it('takes the symbol it is drawn over', () => {
    const over = zigzag(Math.min(...xs(two)) - 4, Math.max(...xs(two)) + 4, 10, 8, 8);
    expect(scratchedOut(over, 4, strokesOf(written))).toEqual(two.strokes);
  });

  it('takes a whole number when drawn over all of it', () => {
    const over = zigzag(Math.min(...xs(one)) - 4, Math.max(...xs(three)) + 4, 10, 8, 8);
    expect(scratchedOut(over, 4, strokesOf(written))).toHaveLength(strokesOf(written).length);
  });

  it('leaves writing it only grazes', () => {
    // Across the bottom few pixels of the 2 only.
    const graze = zigzag(Math.min(...xs(two)), Math.max(...xs(two)), 74, 8, 0.5);
    expect(scratchedOut(graze, 4, two.strokes)).toEqual([]);
  });

  it('takes nothing on empty paper', () => {
    expect(scratchedOut(zigzag(400, 460, 0, 8), 4, strokesOf(written))).toEqual([]);
  });

  it('leaves a mark inside its box that it never touches', () => {
    const dot = stroke(path([30, 30], [31, 31]));
    const around = path([0, 0], [60, 0], [60, 10], [0, 10], [0, 50], [60, 50], [60, 60], [0, 60]);
    expect(scratchedOut(around, 4, [dot])).toEqual([]);
  });
});
