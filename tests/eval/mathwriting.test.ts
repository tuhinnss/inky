import { describe, expect, it } from 'vitest';
import { parseRecords, toStrokes, type MathWritingInk } from '../../scripts/eval/mathwriting';

const ink = (kind: MathWritingInk['kind'], strokes: number[][]): MathWritingInk => ({
  id: 'x',
  split: kind === 'symbol' ? 'symbols' : 'test',
  kind,
  label: kind === 'symbol' ? '-' : '1-1',
  strokes,
});

describe('MathWriting inks on a CalcInk page', () => {
  it('brings an expression to the height of handwriting on the page', () => {
    const strokes = toStrokes(
      ink('expression', [
        [1000, 2000, 1000, 2400],
        [1200, 2200, 1500, 2200],
      ]),
      80,
      4,
    );
    const ys = strokes.flatMap((s) => s.points.map((p) => p.y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(80, 6);
    expect(Math.min(...strokes.flatMap((s) => s.points.map((p) => p.x)))).toBe(40);
  });

  it('sizes a lone symbol by its longer side, so a minus sign does not balloon', () => {
    const [minus] = toStrokes(ink('symbol', [[500, 300, 800, 306]]), 80, 4);
    const xs = minus.points.map((p) => p.x);
    const ys = minus.points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.6, 6);
  });

  it('keeps the shape: the same scale both ways', () => {
    const [stroke] = toStrokes(ink('expression', [[0, 0, 30, 40]]), 80, 4);
    const [a, b] = stroke.points;
    expect((b.x - a.x) / (b.y - a.y)).toBeCloseTo(30 / 40, 6);
    expect(stroke.width).toBe(4);
  });

  it('reads one ink per line, skipping blank lines', () => {
    const text = `${JSON.stringify(ink('symbol', [[0, 0]]))}\n\n${JSON.stringify(ink('expression', [[0, 0]]))}\n`;
    expect(parseRecords(text).map((r) => r.kind)).toEqual(['symbol', 'expression']);
  });
});
