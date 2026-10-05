import { describe, expect, it } from 'vitest';
import { graphFrame, niceTicks, plot, X_RANGE, yWindow } from '../../src/ui/plot';

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
  it('goes under its line, from where the line starts', () => {
    const frame = graphFrame({ minX: 100, maxY: 200 }, 60, 1000);
    expect(frame.left).toBe(100);
    expect(frame.top).toBeGreaterThan(200);
    expect(frame.width).toBe(300);
    expect(frame.height).toBeLessThan(frame.width);
  });

  it('grows with the writing, up to a point', () => {
    expect(graphFrame({ minX: 0, maxY: 0 }, 20, 1000).width).toBe(260);
    expect(graphFrame({ minX: 0, maxY: 0 }, 200, 1000).width).toBe(420);
  });

  it('stays on a narrow page', () => {
    const frame = graphFrame({ minX: 200, maxY: 0 }, 60, 320);
    expect(frame.left).toBeGreaterThanOrEqual(12);
    expect(frame.left + frame.width).toBeLessThanOrEqual(320 - 12);
  });
});
