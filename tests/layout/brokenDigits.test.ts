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

/** A loop, as the top of a 9 or a 0 is written. */
function loop(cx: number, cy: number, rx: number, ry: number): Stroke {
  const corners: Array<[number, number]> = [];
  for (let a = 0; a <= 360; a += 20) {
    corners.push([
      cx + rx * Math.cos((a * Math.PI) / 180),
      cy + ry * Math.sin((a * Math.PI) / 180),
    ]);
  }
  return stroke(...corners);
}

/** A "1": one stroke down, 80 tall, its top at y = 100. */
const one = (x: number): Stroke => stroke([x, 100], [x, 180]);

/** Digits either side, so the line has the height of handwriting. */
const frame = (): Stroke[] => [one(20), one(400)];

const count = (strokes: Stroke[]): number =>
  segmentLine([...frame(), ...strokes]).symbols.length - 2;

describe('digits written in two strokes side by side', () => {
  it('joins a 4 written as an "L" and then a separate stroke down', () => {
    const l = stroke([110, 100], [100, 145], [140, 145]);
    expect(count([l, stroke([143, 100], [143, 180])])).toBe(1);
  });

  it('joins a 9 written as a loop and then a separate stem', () => {
    expect(count([loop(120, 120, 17, 18), stroke([140, 104], [140, 180])])).toBe(1);
  });

  it('joins a 5 whose flag was drawn separately across its top', () => {
    const body = stroke([110, 100], [107, 135], [130, 132], [138, 155], [128, 178], [104, 172]);
    expect(count([body, stroke([111, 101], [150, 99])])).toBe(1);
  });

  it('keeps "11" apart', () => {
    expect(count([one(120), one(145)])).toBe(2);
  });

  it('keeps "01" apart: the 0 is as tall as the 1', () => {
    expect(count([loop(120, 140, 17, 40), stroke([150, 100], [150, 180])])).toBe(2);
  });

  it('keeps "71" apart', () => {
    expect(count([stroke([100, 100], [140, 100], [115, 180]), one(150)])).toBe(2);
  });

  it('keeps "-1" apart', () => {
    expect(count([stroke([100, 140], [135, 140]), one(142)])).toBe(2);
  });

  it('keeps "=1" apart', () => {
    expect(count([stroke([100, 130], [135, 130]), stroke([100, 150], [135, 150]), one(142)])).toBe(
      2,
    );
  });

  it('keeps "+1" apart', () => {
    expect(count([stroke([100, 140], [134, 140]), stroke([117, 123], [117, 157]), one(142)])).toBe(
      2,
    );
  });

  it('keeps "5-" apart when the minus sits in the middle of the line', () => {
    const body = stroke([110, 100], [107, 135], [130, 132], [138, 155], [128, 178], [104, 172]);
    expect(count([body, stroke([142, 140], [177, 140])])).toBe(2);
  });
});

describe('a small mark: point or minus', () => {
  const kindOf = (mark: Stroke): string => {
    const line = segmentLine([...frame(), mark]);
    return line.symbols.find((s) => s.strokes.includes(mark))!.kind;
  };

  it('is a decimal point when it is a dot low on the line', () => {
    expect(kindOf(stroke([200, 176], [201, 177]))).toBe('dot');
  });

  it('is a decimal point when it is a short tick low on the line', () => {
    expect(kindOf(stroke([200, 176], [214, 177]))).toBe('dot');
  });

  it('is a minus sign when it is a short dash in the middle of the line', () => {
    expect(kindOf(stroke([200, 140], [214, 141]))).toBe('shape');
  });

  it('is a dot when it is a tiny tick, even high up, as a dot of ÷ may be', () => {
    expect(kindOf(stroke([200, 120], [206, 121]))).toBe('dot');
  });
});
