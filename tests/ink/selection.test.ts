import { describe, expect, it } from 'vitest';
import {
  createStroke,
  inBox,
  moveStrokes,
  pointInPolygon,
  selectWithLasso,
  selectionBounds,
} from '../../src/ink';
import { lassoTakes } from '../../src/ink/selection';
import { dot, ids, line, points } from './fixtures';

/** A loop round a rectangle, the way a lasso is drawn: not closed by hand. */
function loopAround(minX: number, minY: number, maxX: number, maxY: number) {
  return points([minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]);
}

describe('a point inside a polygon', () => {
  const square = loopAround(0, 0, 100, 100);

  it('is inside a square, and outside it is not', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: -1 }, square)).toBe(false);
  });

  it('closes the loop from the last point back to the first', () => {
    // Three sides drawn; the fourth, at x = 0, is implied.
    expect(pointInPolygon({ x: 5, y: 50 }, square)).toBe(true);
  });

  it('follows the shape of a loop that bends in', () => {
    // A "U": the notch between its arms is outside.
    const u = points([0, 0], [30, 0], [30, 70], [70, 70], [70, 0], [100, 0], [100, 100], [0, 100]);
    expect(pointInPolygon({ x: 50, y: 30 }, u)).toBe(false);
    expect(pointInPolygon({ x: 15, y: 30 }, u)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 85 }, u)).toBe(true);
  });

  it('finds nothing inside a loop of fewer than three points', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, points([0, 0], [10, 10]))).toBe(false);
  });
});

describe('what a lasso takes', () => {
  const loop = loopAround(0, 0, 100, 100);

  it('takes a stroke that lies wholly inside', () => {
    expect(lassoTakes(line([20, 50], [80, 50]), loop)).toBe(true);
  });

  it('takes a stroke mostly inside, with its tail poking out', () => {
    expect(lassoTakes(line([20, 50], [120, 50]), loop)).toBe(true);
  });

  it('leaves a neighbour that the loop only clips', () => {
    expect(lassoTakes(line([80, 50], [200, 50]), loop)).toBe(false);
  });

  it('takes a dot inside, such as a decimal point', () => {
    expect(lassoTakes(dot(50, 90), loop)).toBe(true);
    expect(lassoTakes(dot(150, 90), loop)).toBe(false);
  });

  it('selects the strokes of one sum out of several, in drawing order', () => {
    const first = [line([10, 10], [10, 60]), line([30, 30], [60, 30])];
    const other = [line([210, 10], [210, 60]), line([230, 30], [260, 30])];
    const all = [first[0], other[0], first[1], other[1]];
    expect(ids(selectWithLasso(all, loopAround(0, 0, 100, 100)))).toEqual(ids(first));
  });

  it('selects nothing for a tap', () => {
    const strokes = [line([10, 10], [10, 60])];
    expect(selectWithLasso(strokes, points([10, 30]))).toEqual([]);
    expect(selectWithLasso(strokes, points([10, 30], [12, 31]))).toEqual([]);
  });
});

describe('moving strokes', () => {
  const original = createStroke(
    [
      { x: 10, y: 20, pressure: 0.3 },
      { x: 15, y: 30, pressure: 0.7 },
    ],
    4,
    '#c2272d',
    false,
  );

  it('moves every point by the same amount', () => {
    const [moved] = moveStrokes([original], 100, -5);
    expect(moved.points.map((p) => [p.x, p.y])).toEqual([
      [110, 15],
      [115, 25],
    ]);
  });

  it('keeps the width, colour and pressure, so the ink looks the same', () => {
    const [moved] = moveStrokes([original], 3, 3);
    expect(moved.width).toBe(4);
    expect(moved.color).toBe('#c2272d');
    expect(moved.simulatePressure).toBe(false);
    expect(moved.points.map((p) => p.pressure)).toEqual([0.3, 0.7]);
  });

  it('makes new strokes, leaving the originals for undo', () => {
    const [moved] = moveStrokes([original], 3, 3);
    expect(moved.id).not.toBe(original.id);
    expect(original.points[0]).toEqual({ x: 10, y: 20, pressure: 0.3 });
  });
});

describe('the box round a selection', () => {
  it('is nothing for no strokes', () => {
    expect(selectionBounds([])).toBeNull();
  });

  it('covers the ink of every stroke, pen width included', () => {
    const box = selectionBounds([line([10, 10], [50, 10], { width: 4 }), dot(30, 80, 6)]);
    expect(box).toEqual({ minX: 8, minY: 8, maxX: 52, maxY: 83 });
  });

  it('holds a point inside it, or near it with padding', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
    expect(inBox({ x: 50, y: 25 }, box)).toBe(true);
    expect(inBox({ x: 108, y: 25 }, box)).toBe(false);
    expect(inBox({ x: 108, y: 25 }, box, 10)).toBe(true);
  });
});
