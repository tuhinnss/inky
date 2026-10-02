import { describe, expect, it } from 'vitest';
import { strokeBounds, unionBounds } from '../../src/ink';
import { estimateTilt, layoutPage, levelStroke } from '../../src/layout';
import { climbing, ink, shuffled, strokesOf, turned } from '../fixtures/ink';

const line = (text = '18+4×3=', seed = 1) => ink(text, { x: 100, y: 400, size: 70, seed });

describe('telling whether a line is turned', () => {
  it.each([20, 25, 30, -20, -30])('measures a line turned by %i°', (degrees) => {
    const tilt = estimateTilt(turned(line(), degrees));
    // Rising to the right is a negative angle on a page whose y runs downwards.
    expect(tilt?.degrees).toBeGreaterThanOrEqual(-degrees - 3);
    expect(tilt?.degrees).toBeLessThanOrEqual(-degrees + 3);
  });

  it('gives the angle in radians to match the whole degrees it is rounded to', () => {
    const tilt = estimateTilt(turned(line(), 25))!;
    expect(tilt.angle).toBeCloseTo((tilt.degrees * Math.PI) / 180, 10);
  });

  it('leaves a level line alone', () => {
    expect(estimateTilt(strokesOf(line()))).toBeNull();
  });

  it.each([5, 10, -8])('leaves a line turned by only %i° alone', (degrees) => {
    expect(estimateTilt(turned(line(), degrees))).toBeNull();
  });

  it.each([20, 30, -25])(
    'leaves a line climbing at %i° alone: its symbols are upright already',
    (degrees) => {
      expect(estimateTilt(climbing(line(), degrees))).toBeNull();
    },
  );

  it('waits for the "=": an unfinished line has nothing to tell the two cases apart', () => {
    expect(estimateTilt(turned(line('18+4×3'), 25))).toBeNull();
  });

  it('does not take a single symbol, or two, for a line', () => {
    expect(estimateTilt(turned(line('='), 30))).toBeNull();
    expect(estimateTilt(turned(line('4='), 30))).toBeNull();
  });

  it('gives up beyond the angle at which lines can be told apart at all', () => {
    expect(estimateTilt(turned(line(), 70))).toBeNull();
  });

  it('does not depend on the order the strokes were written in', () => {
    const strokes = turned(line('7.5÷2-60=', 3), 25);
    const expected = estimateTilt(strokes)?.degrees;
    expect(expected).toBeDefined();
    for (const seed of [2, 5, 9])
      expect(estimateTilt(shuffled(strokes, seed))?.degrees).toBe(expected);
  });

  it('is not thrown by decimal points and the dots of a division sign', () => {
    const tilt = estimateTilt(turned(line('7.5÷2-60=', 3), 25));
    expect(tilt?.degrees).toBeGreaterThanOrEqual(-28);
    expect(tilt?.degrees).toBeLessThanOrEqual(-22);
  });
});

describe('turning a line level', () => {
  it('lays the line flat', () => {
    const strokes = turned(line(), 25);
    const tilt = estimateTilt(strokes)!;
    const before = strokes.map((stroke) => strokeBounds(stroke)).reduce(unionBounds);
    const after = strokes
      .map((stroke) => strokeBounds(levelStroke(stroke, tilt)))
      .reduce(unionBounds);

    expect(before.maxY - before.minY).toBeGreaterThan(150); // sloping across the page
    expect(after.maxY - after.minY).toBeLessThan(100); // one line of 70 px digits
  });

  it('keeps each stroke’s id, width and number of points', () => {
    const strokes = turned(line(), 25);
    const tilt = estimateTilt(strokes)!;
    for (const stroke of strokes) {
      const level = levelStroke(stroke, tilt);
      expect(level.id).toBe(stroke.id);
      expect(level.width).toBe(stroke.width);
      expect(level.points).toHaveLength(stroke.points.length);
    }
  });

  it('does not touch the original stroke', () => {
    const [stroke] = turned(line(), 25);
    const before = stroke.points.map((p) => ({ ...p }));
    levelStroke(stroke, { angle: -0.4, degrees: -23, pivotX: 300, pivotY: 300 });
    expect(stroke.points).toEqual(before);
  });

  it('hands back the same copy for the same stroke and the same turn', () => {
    const [stroke] = turned(line(), 25);
    const tilt = { angle: -0.4, degrees: -23, pivotX: 300, pivotY: 300 };
    expect(levelStroke(stroke, tilt)).toBe(levelStroke(stroke, { ...tilt }));
    expect(levelStroke(stroke, { ...tilt, degrees: -24, angle: -0.42 })).not.toBe(
      levelStroke(stroke, tilt),
    );
  });

  it('keeps distances: turning is not stretching', () => {
    const [stroke] = turned(line(), 25);
    const level = levelStroke(stroke, { angle: -0.4, degrees: -23, pivotX: 300, pivotY: 300 });
    const length = (points: readonly { x: number; y: number }[]): number =>
      Math.hypot(
        points[points.length - 1].x - points[0].x,
        points[points.length - 1].y - points[0].y,
      );
    expect(length(level.points)).toBeCloseTo(length(stroke.points), 6);
  });
});

describe('laying out a page with a turned line', () => {
  it('finds the same symbols as in the line written straight', () => {
    const straight = layoutPage(strokesOf(line('7.5÷2-60=', 3)));
    const askew = layoutPage(turned(line('7.5÷2-60=', 3), 25));

    expect(askew).toHaveLength(1);
    expect(askew[0].tilt?.degrees).toBeLessThan(-20);
    expect(askew[0].symbols.map((symbol) => symbol.kind)).toEqual(
      straight[0].symbols.map((symbol) => symbol.kind),
    );
    expect(askew[0].symbols.map((symbol) => symbol.strokes.length)).toEqual(
      straight[0].symbols.map((symbol) => symbol.strokes.length),
    );
  });

  it('describes the line in its own level frame', () => {
    const [askew] = layoutPage(turned(line(), 30));
    expect(askew.bounds.maxY - askew.bounds.minY).toBeLessThan(100);
    expect(askew.height).toBeCloseTo(70, -1);
  });

  it('marks the symbols’ keys with the turn, so a reading is not reused for another angle', () => {
    const [straight] = layoutPage(strokesOf(line()));
    const [askew] = layoutPage(turned(line(), 25));
    expect(straight.symbols.every((symbol) => !symbol.key.includes('@'))).toBe(true);
    expect(askew.symbols.every((symbol) => symbol.key.endsWith(`@${askew.tilt!.degrees}`))).toBe(
      true,
    );
  });

  it('leaves a level line beside it untouched', () => {
    const level = strokesOf(ink('96-27=', { x: 100, y: 60, size: 70, seed: 4 }));
    const lines = layoutPage([
      ...level,
      ...turned(ink('18+4×3=', { x: 100, y: 520, size: 70 }), 25),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.filter((each) => each.tilt)).toHaveLength(1);
    expect(lines.find((each) => !each.tilt)?.symbols).toHaveLength(6);
  });

  it('gives no tilt to a climbing line, which is read as it stands', () => {
    const [line1] = layoutPage(climbing(line(), 25));
    expect(line1.tilt).toBeUndefined();
    expect(line1.symbols).toHaveLength(7);
  });
});
