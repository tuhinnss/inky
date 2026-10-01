import { describe, expect, it } from 'vitest';
import { createStroke, eraseFromStroke, strokeIsHit, type Stroke } from '../../src/ink';
import { dot, line, points } from './fixtures';

const at = (x: number, y: number) => ({ x, y });

function xRange(stroke: Stroke): [number, number] {
  const xs = stroke.points.map((point) => point.x);
  return [Math.min(...xs), Math.max(...xs)];
}

describe('stroke eraser', () => {
  const horizontal = line([0, 50], [100, 50], { width: 2 });

  it('hits a stroke the eraser crosses', () => {
    expect(strokeIsHit(horizontal, at(50, 0), at(50, 100), 4)).toBe(true);
  });

  it('hits a stroke the eraser merely rests on', () => {
    expect(strokeIsHit(horizontal, at(50, 50), at(50, 50), 4)).toBe(true);
  });

  it('misses a stroke that is far away', () => {
    expect(strokeIsHit(horizontal, at(50, 200), at(60, 200), 4)).toBe(false);
  });

  it('counts the pen width: touching the ink edge is a hit', () => {
    const thick = line([0, 50], [100, 50], { width: 20 });
    // Eraser centre is 13 px from the centreline: outside its radius of 4, but the ink
    // itself extends 10 px, so the two overlap by 1 px.
    expect(strokeIsHit(thick, at(50, 63), at(50, 63), 4)).toBe(true);
    expect(strokeIsHit(thick, at(50, 65), at(50, 65), 4)).toBe(false);
  });

  it('hits a stroke whose samples are far apart when it passes between them', () => {
    const sparse = createStroke(points([0, 0], [100, 0]), 2, '#000');
    expect(strokeIsHit(sparse, at(50, -1), at(50, 1), 2)).toBe(true);
  });

  it('hits a fast eraser move that jumps clean across the stroke', () => {
    expect(strokeIsHit(horizontal, at(50, -300), at(50, 300), 1)).toBe(true);
  });

  it('hits and misses a single-point stroke', () => {
    expect(strokeIsHit(dot(10, 10), at(12, 10), at(12, 10), 4)).toBe(true);
    expect(strokeIsHit(dot(10, 10), at(40, 10), at(40, 10), 4)).toBe(false);
  });
});

describe('pixel eraser', () => {
  // Width 2 and eraser radius 5: ink is removed within 6 px of the eraser centre.
  const horizontal = line([0, 50], [100, 50], { width: 2 });

  it('leaves an untouched stroke alone', () => {
    expect(eraseFromStroke(horizontal, at(50, 200), at(50, 200), 5)).toBeNull();
  });

  it('splits a stroke in two when erasing its middle', () => {
    const fragments = eraseFromStroke(horizontal, at(50, 50), at(50, 50), 5)!;
    expect(fragments).toHaveLength(2);

    const [left, right] = fragments.map(xRange);
    expect(left[0]).toBe(0);
    expect(left[1]).toBeCloseTo(44, 1);
    expect(right[0]).toBeCloseTo(56, 1);
    expect(right[1]).toBe(100);
  });

  it('trims the end when erasing an end', () => {
    const fragments = eraseFromStroke(horizontal, at(100, 50), at(100, 50), 5)!;
    expect(fragments).toHaveLength(1);
    expect(xRange(fragments[0])[0]).toBe(0);
    expect(xRange(fragments[0])[1]).toBeCloseTo(94, 1);
  });

  it('removes the whole stroke when it is entirely covered', () => {
    const short = line([48, 50], [52, 50]);
    expect(eraseFromStroke(short, at(50, 50), at(50, 50), 10)).toEqual([]);
  });

  it('cuts a stroke that has only two distant samples', () => {
    const sparse = createStroke(points([0, 50], [100, 50]), 2, '#000');
    const fragments = eraseFromStroke(sparse, at(50, 50), at(50, 50), 5)!;
    expect(fragments).toHaveLength(2);
    expect(xRange(fragments[0])[1]).toBeCloseTo(44, 1);
    expect(xRange(fragments[1])[0]).toBeCloseTo(56, 1);
  });

  it('erases along the whole sweep, not just at its ends', () => {
    const fragments = eraseFromStroke(horizontal, at(30, 50), at(70, 50), 5)!;
    expect(fragments).toHaveLength(2);
    expect(xRange(fragments[0])[1]).toBeCloseTo(24, 1);
    expect(xRange(fragments[1])[0]).toBeCloseTo(76, 1);
  });

  it('cuts where the eraser crosses, leaving the rest', () => {
    const fragments = eraseFromStroke(horizontal, at(20, 0), at(20, 100), 5)!;
    expect(fragments).toHaveLength(2);
    expect(xRange(fragments[0])).toEqual([0, expect.closeTo(14, 1)]);
    expect(xRange(fragments[1])).toEqual([expect.closeTo(26, 1), 100]);
  });

  it('gives fragments the pen settings of the original and fresh ids', () => {
    const original = createStroke(points([0, 0], [100, 0]), 7, '#123456');
    const fragments = eraseFromStroke(original, at(50, 0), at(50, 0), 5)!;
    for (const fragment of fragments) {
      expect(fragment.width).toBe(7);
      expect(fragment.color).toBe('#123456');
      expect(fragment.id).toBeGreaterThan(original.id);
    }
    expect(new Set(fragments.map((fragment) => fragment.id)).size).toBe(fragments.length);
  });

  it('interpolates pressure at the cut', () => {
    const ramp = createStroke(
      [
        { x: 0, y: 0, pressure: 0 },
        { x: 100, y: 0, pressure: 1 },
      ],
      2,
      '#000',
    );
    const [left] = eraseFromStroke(ramp, at(50, 0), at(50, 0), 5)!;
    const cut = left.points[left.points.length - 1];
    expect(cut.x).toBeCloseTo(44, 1);
    expect(cut.pressure).toBeCloseTo(0.44, 2);
  });

  it('drops leftover specks shorter than the pen is wide', () => {
    // 7 px of ink survive at the left end, less than the 8 px pen width.
    const stub = line([0, 50], [40, 50], { width: 8 });
    const fragments = eraseFromStroke(stub, at(40, 50), at(16, 50), 5)!;
    expect(fragments).toEqual([]);
  });

  it('erases a single-point stroke only when it is under the eraser', () => {
    expect(eraseFromStroke(dot(10, 10), at(11, 10), at(11, 10), 5)).toEqual([]);
    expect(eraseFromStroke(dot(10, 10), at(60, 10), at(60, 10), 5)).toBeNull();
  });

  it('never mutates the original stroke', () => {
    const before = JSON.stringify(horizontal);
    eraseFromStroke(horizontal, at(50, 50), at(50, 50), 5);
    expect(JSON.stringify(horizontal)).toBe(before);
  });
});
