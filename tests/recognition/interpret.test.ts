import { describe, expect, it } from 'vitest';
import { createStroke, type Stroke } from '../../src/ink';
import { segmentLine } from '../../src/layout';
import { fuse, interpret, readDot, shapeOf } from '../../src/recognition/interpret';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import { ink, strokesOf } from '../fixtures/ink';

/** A probability vector with the given mass on named symbols and the rest spread evenly. */
function probabilities(mass: Partial<Record<ModelSymbol, number>>): Float32Array {
  const named = Object.values(mass).reduce((sum, p) => sum + p, 0);
  const rest = (1 - named) / (MODEL_SYMBOLS.length - Object.keys(mass).length);
  return Float32Array.from(MODEL_SYMBOLS, (symbol) => mass[symbol] ?? rest);
}

function shapeIn(text: string, index: number) {
  const line = segmentLine(strokesOf(ink(text, { size: 80, wobble: 0 })));
  return { line, symbol: line.symbols[index] };
}

describe('recognising stroke arrangements', () => {
  it.each([
    ['2-3', 'bar'],
    ['2=3', 'stacked-bars'],
    ['2÷3', 'bar-with-dots'],
    ['2+3', 'cross'],
    ['2×3', 'other'],
    ['283', 'other'],
    ['213', 'other'],
  ] as const)('classifies the middle symbol of "%s" as %s', (text, shape) => {
    const { line, symbol } = shapeIn(text, 1);
    expect(shapeOf(symbol, line)).toBe(shape);
  });
});

/** A straight stroke through the given points, densely sampled. */
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

describe('a cross', () => {
  /** The shape of two strokes standing in a line of 80 px digits. */
  const shapeOfPair = (a: Stroke, b: Stroke) => {
    const line = segmentLine([stroke([20, 100], [20, 180]), a, b, stroke([400, 100], [400, 180])]);
    const symbol = line.symbols.find((s) => s.strokes.includes(a))!;
    expect(symbol.strokes).toContain(b);
    return shapeOf(symbol, line);
  };

  it('is a tall "+" with a short bar, as handwriting often has', () => {
    expect(shapeOfPair(stroke([120, 100], [121, 170]), stroke([106, 135], [134, 134]))).toBe(
      'cross',
    );
  });

  it('is a "+" whose bar is drawn first and a little slanted', () => {
    expect(shapeOfPair(stroke([100, 142], [140, 132]), stroke([118, 112], [121, 162]))).toBe(
      'cross',
    );
  });

  it('is not a "1" with a bar across its foot', () => {
    expect(shapeOfPair(stroke([120, 100], [120, 180]), stroke([105, 178], [135, 178]))).toBe(
      'other',
    );
  });

  it('is not a "7" with a bar across, whose other stroke bends', () => {
    expect(
      shapeOfPair(stroke([100, 100], [140, 100], [118, 180]), stroke([112, 140], [138, 140])),
    ).toBe('other');
  });

  it('is not a "4" written as an "L" and a stem', () => {
    expect(
      shapeOfPair(stroke([110, 100], [100, 150], [145, 150]), stroke([135, 110], [135, 180])),
    ).toBe('other');
  });

  it('is not a bar that passes over the top of a stroke without crossing it', () => {
    expect(shapeOfPair(stroke([120, 110], [120, 175]), stroke([104, 104], [136, 104]))).toBe(
      'other',
    );
  });
});

describe('fusing model output with geometry', () => {
  it('leaves a confident, consistent reading alone', () => {
    const reading = fuse(probabilities({ '7': 0.98 }), 'other');
    expect(reading.symbol).toBe('7');
    expect(reading.confidence).toBeGreaterThan(0.97);
  });

  it('agrees with the model when geometry says the same thing', () => {
    const reading = fuse(probabilities({ '-': 0.9 }), 'bar');
    expect(reading.symbol).toBe('-');
    expect(reading.confidence).toBeGreaterThan(0.99); // the two sources reinforce each other
  });

  it('lets geometry settle a close call', () => {
    // The model is torn between "-" and "1" for a single stroke. It is flat: a minus.
    const reading = fuse(probabilities({ '1': 0.5, '-': 0.4 }), 'bar');
    expect(reading.symbol).toBe('-');
  });

  it('reads two stacked bars as "=" even when the model leans elsewhere', () => {
    const reading = fuse(probabilities({ '-': 0.5, '=': 0.4 }), 'stacked-bars');
    expect(reading.symbol).toBe('=');
  });

  it('reads a bar with dots as "÷" rather than "-" or "+"', () => {
    const reading = fuse(probabilities({ '+': 0.45, '÷': 0.4, '-': 0.1 }), 'bar-with-dots');
    expect(reading.symbol).toBe('÷');
  });

  it('does not read a tall shape as a minus sign', () => {
    const reading = fuse(probabilities({ '-': 0.55, '1': 0.4 }), 'other');
    expect(reading.symbol).toBe('1');
  });

  it('still lets an overwhelming model opinion beat a soft prior', () => {
    // Geometry scales the model's view by 20×; a 500× preference survives that.
    const reading = fuse(probabilities({ '7': 0.998, '-': 0.002 }), 'bar');
    expect(reading.symbol).toBe('7');
  });

  it('reads a cross as "+" when the model leans to "1" or "4"', () => {
    expect(fuse(probabilities({ '1': 0.55, '+': 0.44 }), 'cross').symbol).toBe('+');
    expect(fuse(probabilities({ '4': 0.64, '1': 0.13, '+': 0.13 }), 'cross').symbol).toBe('+');
  });

  it('leaves a "×" written askew to the model', () => {
    expect(fuse(probabilities({ '×': 0.44, '7': 0.38, '+': 0.18 }), 'cross').symbol).toBe('×');
  });

  it('leaves a digit the model is sure of alone, even if it looks like a cross', () => {
    expect(fuse(probabilities({ '5': 0.995, '+': 0.001 }), 'cross').symbol).toBe('5');
  });

  it('reads a 9 with a closed loop at the top, which the model takes for a 3', () => {
    expect(fuse(probabilities({ '3': 0.9, '9': 0.1 }), 'other', true).symbol).toBe('9');
    expect(fuse(probabilities({ '3': 0.9, '9': 0.1 }), 'other', false).symbol).toBe('3');
  });

  it('leaves 0 and 8, which have loops at the top too, to the model', () => {
    expect(fuse(probabilities({ '8': 0.6, '9': 0.4 }), 'other', true).symbol).toBe('8');
    expect(fuse(probabilities({ '0': 0.6, '9': 0.4 }), 'other', true).symbol).toBe('0');
  });

  it('does not overturn a 3 the model is all but certain of', () => {
    expect(fuse(probabilities({ '3': 0.9999, '9': 0.00005 }), 'other', true).symbol).toBe('3');
  });

  it('reports low confidence when the evidence is split', () => {
    const reading = fuse(probabilities({ '1': 0.5, '7': 0.45 }), 'other');
    expect(reading.symbol).toBe('1');
    expect(reading.confidence).toBeLessThan(0.6);
  });

  it('returns confidence in [0, 1] and survives an all-zero input', () => {
    expect(fuse(new Float32Array(MODEL_SYMBOLS.length), 'other').confidence).toBe(0);
    const reading = fuse(probabilities({ '3': 0.7 }), 'other');
    expect(reading.confidence).toBeGreaterThan(0);
    expect(reading.confidence).toBeLessThanOrEqual(1);
  });
});

describe('the decimal point', () => {
  it('reads a dot on the baseline as a decimal point, confidently', () => {
    const { line, symbol } = shapeIn('7.5', 1);
    expect(symbol.kind).toBe('dot');
    expect(readDot(symbol, line)).toEqual({ symbol: '.', confidence: 0.95 });
  });

  it('flags a dot floating at the top of the line as doubtful', () => {
    const digits = strokesOf(ink('75', { x: 0, y: 0, size: 80, wobble: 0 }));
    const stray = createStroke([{ x: 40, y: 6, pressure: 0.5 }], 4, '#000');
    const line = segmentLine([...digits, stray]);
    const dot = line.symbols.find((symbol) => symbol.kind === 'dot')!;
    expect(readDot(dot, line).confidence).toBeLessThan(0.5);
  });

  it('decides dots without consulting the model', () => {
    const { line, symbol } = shapeIn('7.5', 1);
    expect(interpret(symbol, line, undefined).symbol).toBe('.');
    // Even a model output claiming otherwise is ignored for a dot.
    expect(interpret(symbol, line, probabilities({ '0': 0.99 })).symbol).toBe('.');
  });

  it('does not divide by zero when the dot is the only thing on the line', () => {
    const lone = createStroke([{ x: 10, y: 10, pressure: 0.5 }], 4, '#000');
    const line = segmentLine([lone]);
    const reading = readDot(line.symbols[0], line);
    expect(reading.symbol).toBe('.');
    expect(Number.isFinite(reading.confidence)).toBe(true);
  });
});

describe('interpret', () => {
  it('uses the shape of the symbol when fusing', () => {
    const { line, symbol } = shapeIn('2-3', 1);
    expect(interpret(symbol, line, probabilities({ '1': 0.5, '-': 0.4 })).symbol).toBe('-');
  });
});
