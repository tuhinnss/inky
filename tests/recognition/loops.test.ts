import { describe, expect, it } from 'vitest';
import { createStroke, type Stroke } from '../../src/ink';
import { hasLoopAtTop, resample } from '../../src/recognition/loops';
import { ink, strokesOf } from '../fixtures/ink';
import { REAL_DIGITS } from '../fixtures/realDigits';

function stroke(points: Array<[number, number]>): Stroke {
  return createStroke(
    points.map(([x, y]) => ({ x, y, pressure: 0.5 })),
    4,
    '#000',
  );
}

/** Points round an ellipse, starting and ending at the right-hand side. */
function ellipse(cx: number, cy: number, rx: number, ry: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let a = 0; a <= 360; a += 10) {
    points.push([cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180)]);
  }
  return points;
}

const real = (index: number): Stroke[] =>
  REAL_DIGITS.find((d) => d.index === index)!.strokes.map((flat) => {
    const points: Array<[number, number]> = [];
    for (let i = 0; i < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
    return stroke(points);
  });

describe('resample', () => {
  it('spaces points evenly along the path', () => {
    const points = resample(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
      2.5,
    );
    expect(points).toHaveLength(7);
    expect(points[4]).toEqual({ x: 10, y: 0 });
    expect(points[6]).toEqual({ x: 10, y: 5 });
  });

  it('returns nothing for no points', () => {
    expect(resample([], 1)).toEqual([]);
  });
});

describe('a closed loop at the top', () => {
  it('is found in a 9 whose tail curls back like the bottom of a 3', () => {
    expect(
      hasLoopAtTop([
        stroke([...ellipse(30, 16, 16, 14), [48, 30], [50, 50], [44, 68], [28, 78], [6, 80]]),
      ]),
    ).toBe(true);
  });

  it('is found in a 9 written as a loop and then a separate stem', () => {
    expect(
      hasLoopAtTop([
        stroke(ellipse(30, 20, 18, 16)),
        stroke([
          [48, 20],
          [46, 80],
        ]),
      ]),
    ).toBe(true);
  });

  it('is found when the loop only touches where it began', () => {
    const head = ellipse(30, 20, 18, 16).slice(0, -1); // stops just short of closing
    expect(hasLoopAtTop([stroke([...head, [48, 22], [46, 80]])])).toBe(true);
  });

  it('is not found in real 2s', () => {
    expect(hasLoopAtTop(real(228))).toBe(false);
    expect(hasLoopAtTop(real(REAL_DIGITS.filter((d) => d.digit === '2')[1].index))).toBe(false);
  });

  it('is not found in a 3 or a 7', () => {
    expect(hasLoopAtTop(strokesOf(ink('3', { size: 80, wobble: 0 })))).toBe(false);
    expect(hasLoopAtTop(strokesOf(ink('7', { size: 80, wobble: 0 })))).toBe(false);
  });

  it('is not found in a 6, whose loop is at the bottom', () => {
    expect(hasLoopAtTop([stroke([[45, 0], [20, 30], ...ellipse(30, 62, 16, 18)])])).toBe(false);
  });

  it('is not found in a stroke that goes down and back up the same way', () => {
    expect(
      hasLoopAtTop([
        stroke([
          [20, 0],
          [24, 80],
          [21, 2],
        ]),
      ]),
    ).toBe(false);
  });

  it('is not found in nothing, or a single point', () => {
    expect(hasLoopAtTop([])).toBe(false);
    expect(hasLoopAtTop([stroke([[5, 5]])])).toBe(false);
  });
});
