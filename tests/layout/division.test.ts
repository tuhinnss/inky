import { describe, expect, it } from 'vitest';
import { createStroke, type Stroke } from '../../src/ink';
import { segmentLine } from '../../src/layout';

/** A stroke through the given points, densely sampled. */
function stroke(...corners: Array<[number, number]>): Stroke {
  const points = [];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      points.push({
        x: x0 + ((x1 - x0) * k) / steps,
        y: y0 + ((y1 - y0) * k) / steps,
        pressure: 0.5,
      });
    }
  }
  return createStroke(points, 4, '#000');
}

const dot = (x: number, y: number): Stroke => createStroke([{ x, y, pressure: 0.5 }], 4, '#000');

/** Digits either side, 80 tall from y = 100, so the line has the height of handwriting. */
const frame = (): Stroke[] => [stroke([20, 100], [20, 180]), stroke([400, 100], [400, 180])];

/** The strokes of the symbol `bar` ends up in. */
function symbolOf(bar: Stroke, ...marks: Stroke[]): Stroke[] {
  const line = segmentLine([...frame(), bar, ...marks]);
  return line.symbols.find((s) => s.strokes.includes(bar))!.strokes;
}

describe('the dots of a division sign', () => {
  // A bar 30 wide in the middle of the line.
  const bar = (): Stroke => stroke([100, 140], [130, 140]);

  it('are attached when close to the bar', () => {
    expect(symbolOf(bar(), dot(115, 125), dot(115, 155))).toHaveLength(3);
  });

  it('are attached a little more than a bar width away, as some people write them', () => {
    expect(symbolOf(bar(), dot(115, 106), dot(115, 174))).toHaveLength(3);
  });

  it('are left alone two bar widths away', () => {
    expect(symbolOf(bar(), dot(115, 80), dot(115, 200))).toHaveLength(1);
  });

  it('are not attached to a sloping stroke, which is no bar', () => {
    expect(symbolOf(stroke([100, 155], [118, 125]), dot(109, 115), dot(109, 165))).toHaveLength(1);
  });

  it('leave a decimal point beside a minus sign alone', () => {
    const minus = bar();
    const line = segmentLine([...frame(), minus, dot(140, 176)]);
    expect(line.symbols.find((s) => s.strokes.includes(minus))!.strokes).toEqual([minus]);
    expect(line.symbols.filter((s) => s.kind === 'dot')).toHaveLength(1);
  });
});
