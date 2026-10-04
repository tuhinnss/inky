import { describe, expect, it } from 'vitest';
import { crossingPoint, pathLength } from '../../src/ink';

describe('crossingPoint', () => {
  it('finds where two segments cross', () => {
    const at = crossingPoint({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(at!.x).toBeCloseTo(5);
    expect(at!.y).toBeCloseTo(5);
  });

  it('finds a crossing away from the middle', () => {
    const at = crossingPoint({ x: 0, y: 2 }, { x: 10, y: 2 }, { x: 8, y: 0 }, { x: 8, y: 10 });
    expect(at!.x).toBeCloseTo(8);
    expect(at!.y).toBeCloseTo(2);
  });

  it('is null for segments that do not reach each other', () => {
    expect(
      crossingPoint({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }),
    ).toBeNull();
  });

  it('is null for parallel segments', () => {
    expect(
      crossingPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
    ).toBeNull();
  });
});

describe('pathLength', () => {
  it('adds up the pieces of the path', () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
  });

  it('is zero for a single point', () => {
    expect(pathLength([{ x: 1, y: 1 }])).toBe(0);
  });
});
