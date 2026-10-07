import { describe, expect, it } from 'vitest';
import {
  focusOn,
  graphFrame,
  niceTicks,
  plot,
  X_RANGE,
  yWindow,
  type KeyPoint,
} from '../../src/ui/plot';

/** The values a curve takes across the default window, as `plot` samples it. */
const valuesOf = (f: (x: number) => number): number[] =>
  Array.from({ length: 401 }, (_, i) => f(-10 + i / 20));

describe('niceTicks', () => {
  it('marks the square window every 5', () => {
    expect(niceTicks(-10, 10)).toEqual([-10, -5, 0, 5, 10]);
  });

  it('steps by 1, 2 or 5 times a power of ten, inside the range', () => {
    expect(niceTicks(38, 62)).toEqual([40, 45, 50, 55, 60]);
    expect(niceTicks(-1056, 1056)).toEqual([-1000, -500, 0, 500, 1000]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('writes decimals without binary noise', () => {
    for (const tick of niceTicks(0.1, 0.7)) expect(String(tick).length).toBeLessThan(6);
  });

  it('copes with an empty range', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe('the y window', () => {
  it('stays square when most of the curve is inside it', () => {
    expect(yWindow(valuesOf((x) => 0.5 * x + 1))).toEqual(X_RANGE);
    expect(yWindow(valuesOf((x) => 1 / x))).toEqual(X_RANGE);
    expect(yWindow([])).toEqual(X_RANGE);
  });

  it('fits a curve that would fall outside it', () => {
    const window = yWindow(valuesOf((x) => x + 50));
    expect(window.min).toBeGreaterThan(30);
    expect(window.max).toBeLessThan(70);
    expect(window.min).toBeLessThan(41);
    expect(window.max).toBeGreaterThan(59);
  });

  it('fits a cubic to most of its height', () => {
    const window = yWindow(valuesOf((x) => x * x * x));
    expect(window.max).toBeGreaterThan(800);
    expect(window.max).toBeLessThan(1100);
    expect(window.min).toBeCloseTo(-window.max);
  });

  it('leaves out a few far-off values rather than flatten the rest', () => {
    const values = [...Array.from({ length: 400 }, (_, i) => 100 + i / 40), 1e6, 1e6, 1e6];
    expect(yWindow(values).max).toBeLessThan(120);
  });

  it('takes in zero when the curve comes near it', () => {
    expect(yWindow(valuesOf((x) => x * x)).min).toBeLessThanOrEqual(0);
    expect(yWindow(valuesOf((x) => x * x + 12)).min).toBe(0);
  });

  it('gives a flat curve room around its value', () => {
    const window = yWindow(valuesOf(() => 50));
    expect(window.min).toBeLessThan(50);
    expect(window.max).toBeGreaterThan(50);
  });
});

describe('plot', () => {
  it('draws a line as one run across the window', () => {
    const { runs, x, y } = plot((x) => 2 * x + 1);
    expect(x).toEqual(X_RANGE);
    expect(y).toEqual(X_RANGE);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(401);
    expect(runs[0][0]).toEqual({ x: -10, y: -19 });
    expect(runs[0].at(-1)).toEqual({ x: 10, y: 21 });
  });

  it('breaks where the curve has no value', () => {
    const { runs } = plot((x) => (x === 0 ? null : 1 / x));
    expect(runs).toHaveLength(2);
    expect(runs[0].every((p) => p.x < 0)).toBe(true);
    expect(runs[1].every((p) => p.x > 0)).toBe(true);
  });

  it('breaks at an asymptote it steps over, from one side of the window to the other', () => {
    // 400 samples miss x = 0, so 1 ÷ x leaps from far below to far above.
    expect(plot((x) => 1 / x, X_RANGE, 400).runs).toHaveLength(2);
  });

  it('draws nothing for a curve that has no value anywhere', () => {
    const { runs, y } = plot(() => null);
    expect(runs).toEqual([]);
    expect(y).toEqual(X_RANGE);
  });

  it('brings far-off points in to a few window heights', () => {
    const { runs } = plot((x) => (x === 10 ? 1e300 : x));
    const ys = runs.flat().map((p) => p.y);
    expect(Math.max(...ys)).toBeLessThan(1000);
  });

  it('marks both axes', () => {
    const { xTicks, yTicks } = plot((x) => x + 50);
    expect(xTicks).toEqual([-10, -5, 0, 5, 10]);
    expect(yTicks).toContain(50);
  });
});

describe('graphFrame', () => {
  const line = { minX: 100, minY: 130, maxX: 400, maxY: 200 };

  it('goes under its line, from where the line starts', () => {
    const frame = graphFrame(line, 60, 1000);
    expect(frame.left).toBe(100);
    expect(frame.top).toBeGreaterThan(200);
    expect(frame.width).toBe(300);
    expect(frame.height).toBeLessThan(frame.width);
  });

  it('grows with the writing, up to a point', () => {
    expect(graphFrame(line, 20, 1000).width).toBe(300);
    expect(graphFrame(line, 200, 1000).width).toBe(420);
  });

  it('stays on a narrow page', () => {
    const frame = graphFrame({ ...line, minX: 200 }, 60, 320);
    expect(frame.left).toBeGreaterThanOrEqual(12);
    expect(frame.left + frame.width).toBeLessThanOrEqual(320 - 12);
  });

  it('goes beside its line when there is writing underneath', () => {
    const underneath = { minX: 120, minY: 300, maxX: 380, maxY: 360 };
    const frame = graphFrame(line, 60, 1200, [underneath]);
    expect(frame.left).toBeGreaterThan(line.maxX);
    expect(frame.top).toBe(line.minY);
  });

  it('stays under its line when there is no room beside it either', () => {
    const underneath = { minX: 120, minY: 300, maxX: 380, maxY: 360 };
    expect(graphFrame(line, 60, 700, [underneath]).left).toBe(100);
    const beside = { minX: 700, minY: 120, maxX: 900, maxY: 200 };
    expect(graphFrame(line, 60, 1200, [underneath, beside]).left).toBe(100);
  });

  it('moves on past writing beside its line', () => {
    const underneath = { minX: 120, minY: 300, maxX: 380, maxY: 360 };
    const answer = { minX: 150, minY: 250, maxX: 560, maxY: 330 };
    const frame = graphFrame(line, 60, 1200, [underneath, answer]);
    expect(frame.left).toBeGreaterThan(560);
    expect(frame.top).toBe(line.minY);
  });

  it('ignores writing that is nowhere near', () => {
    const far = { minX: 100, minY: 900, maxX: 400, maxY: 960 };
    expect(graphFrame(line, 60, 1200, [far]).left).toBe(100);
  });
});

describe('the key points of a curve', () => {
  /** Each key point as "(x, y) kinds", in order along the curve. */
  const keys = (f: (x: number) => number | null): string[] =>
    plot(f)
      .keyPoints.slice()
      .sort((a, b) => a.x - b.x)
      .map((p: KeyPoint) => `(${p.x}, ${p.y}) ${[...p.kinds].sort().join('+')}`);

  it('marks where a line crosses both axes', () => {
    expect(keys((x) => 2 * x + 1)).toEqual(['(-0.5, 0) root', '(0, 1) y-intercept']);
  });

  it('marks the roots and the vertex of a parabola', () => {
    expect(keys((x) => x * x - 4)).toEqual([
      '(-2, 0) root',
      '(0, -4) turning+y-intercept',
      '(2, 0) root',
    ]);
  });

  it('finds roots and a vertex between the samples', () => {
    // 2x² + 3x − 1: roots (−3 ± √17) ÷ 4, vertex at x = −0.75.
    const points = plot((x) => 2 * x * x + 3 * x - 1).keyPoints;
    const roots = points.filter((p) => p.kinds.includes('root')).map((p) => p.x);
    expect(roots.sort((a, b) => a - b)).toEqual([
      expect.closeTo((-3 - Math.sqrt(17)) / 4, 6),
      expect.closeTo((-3 + Math.sqrt(17)) / 4, 6),
    ]);
    const vertex = points.find((p) => p.kinds.includes('turning'))!;
    expect(vertex.x).toBeCloseTo(-0.75, 6);
    expect(vertex.y).toBeCloseTo(-2.125, 6);
    expect(vertex.bend).toBe(1);
  });

  it('makes one point of a root, crossing and vertex in the same place', () => {
    expect(keys((x) => x * x)).toEqual(['(0, 0) root+turning+y-intercept']);
  });

  it('tells a highest point from a lowest', () => {
    const [top] = plot((x) => 9 - x * x).keyPoints.filter((p) => p.kinds.includes('turning'));
    expect(top.bend).toBe(-1);
  });

  it('marks both turns of a cubic', () => {
    const turns = plot((x) => x * x * x - 3 * x)
      .keyPoints.filter((p) => p.kinds.includes('turning'))
      .sort((a, b) => a.x - b.x);
    expect(turns.map((p) => [p.x, p.y])).toEqual([
      [-1, 2],
      [1, -2],
    ]);
  });

  it('takes no asymptote for a root, and no gap for a crossing', () => {
    expect(keys((x) => (x === 0 ? null : 1 / x))).toEqual([]);
  });

  it('marks only what is inside the window', () => {
    // The root at −50 is off to the left; the crossing at 50 is in the fitted window.
    expect(keys((x) => x + 50)).toEqual(['(0, 50) y-intercept']);
  });

  it('marks roots that fall exactly on samples, however many there are', () => {
    // −1, 0 and 1 are all sample points of the window: three exact zeros, not a flat stretch.
    expect(keys((x) => x * x * x - x).filter((key) => key.includes('root'))).toEqual([
      '(-1, 0) root',
      '(0, 0) root+y-intercept',
      '(1, 0) root',
    ]);
    const roots = plot((x) => x ** 4 - 5 * x * x + 4).keyPoints.filter((p) =>
      p.kinds.includes('root'),
    );
    expect(roots.map((p) => p.x).sort((a, b) => a - b)).toEqual([-2, -1, 1, 2]);
  });

  it('marks no roots on a curve that is zero all along', () => {
    expect(keys((x) => x - x)).toEqual(['(0, 0) y-intercept']);
  });
});

describe('closing in on a curve', () => {
  it('closes in on the roots and vertex of a parabola that climbs out of the square', () => {
    const { x, y } = plot((x) => x * x - 4);
    expect(x).toEqual({ min: -5, max: 5 });
    expect(y).toEqual({ min: -5, max: 5 });
  });

  it('stretches the window to show a vertex on its edge, with room around it', () => {
    // Roots −1 and 3 put the window at −4 to 6, and the vertex (1, −4) on its lower edge.
    const { y, keyPoints } = plot((x) => x * x - 2 * x - 3);
    expect(y.min).toBeLessThan(-4.5);
    expect(keyPoints.some((p) => p.x === 1 && p.y === -4)).toBe(true);
  });

  it('stretches it to show a vertex just past it, without closing in', () => {
    const { x, y, keyPoints } = plot((x) => 0.1 * x * x - 11);
    expect(x).toEqual(X_RANGE);
    expect(y.min).toBeLessThan(-11);
    expect(keyPoints.some((p) => p.x === 0 && p.y === -11)).toBe(true);
  });

  it('keeps room either side of the key points', () => {
    // Roots −1 and 3, vertex at 1: three either side.
    expect(plot((x) => x * x - 2 * x - 3).x).toEqual({ min: -4, max: 6 });
  });

  it('keeps less room around a curve that turns twice, so its turns are not flattened', () => {
    // x³ − x: roots −1, 0, 1 and turns at ±0.58, about 0.38 off the axis. With three either
    // side its tails reach ±60 and the turns would sit on a flat line.
    const cubic = plot((x) => x * x * x - x);
    expect(cubic.x).toEqual({ min: -2, max: 2 });
    expect(cubic.y).toEqual({ min: -2, max: 2 });
    expect(cubic.keyPoints.filter((p) => p.kinds.includes('turning'))).toHaveLength(2);
    // x⁴ − 5x² + 4, a W: roots ±1 and ±2, turns at (±1.58, −2.25) and (0, 4).
    const quartic = plot((x) => x ** 4 - 5 * x * x + 4);
    expect(quartic.x).toEqual({ min: -3, max: 3 });
    expect(quartic.y.max - quartic.y.min).toBeLessThan(10);
    expect(quartic.keyPoints).toHaveLength(7);
  });

  it('keeps the whole window for a line, and for a curve that never turns', () => {
    expect(plot((x) => 2 * x + 1).x).toEqual(X_RANGE);
    expect(plot((x) => x + 50).x).toEqual(X_RANGE);
    expect(plot((x) => x * x * x).x).toEqual(X_RANGE);
  });

  it('does not close in when the key points are spread across the window', () => {
    const spread = [-8, 0, 8].map((x) => ({
      x,
      y: 0,
      kinds: ['root' as const],
      slope: 1,
      bend: 0,
    }));
    expect(focusOn(spread, X_RANGE)).toBeNull();
  });
});
