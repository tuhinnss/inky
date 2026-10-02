import { describe, expect, it } from 'vitest';
import {
  digitMass,
  mayBeDigit,
  softmax,
  voteOnDigits,
  type DigitOpinion,
} from '../../src/recognition/ensemble';
import { MODEL, MODEL_SYMBOLS } from '../../src/recognition/model';

/** Main-model output from a `{ symbol: probability }` table; the rest is zero. */
function output(table: Partial<Record<string, number>>): Float32Array {
  return Float32Array.from(MODEL_SYMBOLS, (symbol) => table[symbol] ?? 0);
}

/** A helper that is `confidence` sure of `digit` and spreads the rest evenly. */
function opinion(digit: number, confidence: number, weight = 0.5): DigitOpinion {
  const digits = Array.from({ length: 10 }, (_, d) =>
    d === digit ? confidence : (1 - confidence) / 9,
  );
  return { digits, weight };
}

const reading = (probabilities: ArrayLike<number>): string => {
  let best = 0;
  for (let c = 1; c < MODEL.classes; c++) if (probabilities[c] > probabilities[best]) best = c;
  return MODEL_SYMBOLS[best];
};
const sum = (values: ArrayLike<number>, from = 0, to = values.length): number => {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i];
  return total;
};

describe('letting the digit helpers vote', () => {
  it('overturns a reading the helpers agree is wrong', () => {
    // The case this exists for: the main model takes a one-stroke 4 for a 9.
    const p = output({ '9': 0.55, '4': 0.4, '7': 0.05 });
    voteOnDigits(p, 0, [opinion(4, 0.9), opinion(4, 0.8, 0.25)]);
    expect(reading(p)).toBe('4');
  });

  it('keeps a reading the helpers agree with, and is surer of it', () => {
    const p = output({ '3': 0.7, '8': 0.3 });
    voteOnDigits(p, 0, [opinion(3, 0.9), opinion(3, 0.9, 0.25)]);
    expect(reading(p)).toBe('3');
    expect(p[3]).toBeGreaterThan(0.7);
  });

  it('does not let a helper overrule a main model that is sure', () => {
    const p = output({ '7': 0.98, '1': 0.02 });
    voteOnDigits(p, 0, [opinion(1, 0.6)]);
    expect(reading(p)).toBe('7');
  });

  it('gives a heavier helper more say', () => {
    const light = output({ '9': 0.6, '4': 0.4 });
    const heavy = output({ '9': 0.6, '4': 0.4 });
    voteOnDigits(light, 0, [opinion(4, 0.7, 0.1)]);
    voteOnDigits(heavy, 0, [opinion(4, 0.7, 1)]);
    expect(heavy[4]).toBeGreaterThan(light[4]);
  });

  it('leaves the operators exactly as the main model had them', () => {
    const p = output({ '+': 0.3, '×': 0.1, '=': 0.05, '4': 0.3, '9': 0.25 });
    const before = Array.from(p);
    voteOnDigits(p, 0, [opinion(4, 0.95), opinion(4, 0.95, 0.25)]);
    for (const symbol of ['+', '÷', '=', '×', '-']) {
      const c = MODEL_SYMBOLS.indexOf(symbol as (typeof MODEL_SYMBOLS)[number]);
      expect(p[c]).toBe(before[c]);
    }
  });

  it('moves probability among the digits without changing how much they have in all', () => {
    const p = output({ '+': 0.4, '4': 0.3, '9': 0.3 });
    voteOnDigits(p, 0, [opinion(4, 0.9)]);
    expect(digitMass(p)).toBeCloseTo(0.6, 5);
    expect(sum(p)).toBeCloseTo(1, 5);
  });

  it('cannot turn an operator into a digit', () => {
    const p = output({ '+': 0.9, '4': 0.1 });
    voteOnDigits(p, 0, [opinion(4, 1), opinion(4, 1, 0.25)]);
    expect(reading(p)).toBe('+');
  });

  it('is not vetoed by a helper that gives a digit exactly zero', () => {
    const p = output({ '5': 0.9, '6': 0.1 });
    const never5: DigitOpinion = { digits: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0], weight: 0.25 };
    voteOnDigits(p, 0, [never5]);
    expect(p[5]).toBeGreaterThan(0);
    expect(Number.isFinite(p[5])).toBe(true);
  });

  it('accepts helper scores in any positive scale', () => {
    const a = output({ '2': 0.5, '3': 0.5 });
    const b = output({ '2': 0.5, '3': 0.5 });
    voteOnDigits(a, 0, [{ digits: [0, 0, 0.8, 0.2, 0, 0, 0, 0, 0, 0], weight: 0.5 }]);
    voteOnDigits(b, 0, [{ digits: [0, 0, 80, 20, 0, 0, 0, 0, 0, 0], weight: 0.5 }]);
    for (let c = 0; c < MODEL.classes; c++) expect(b[c]).toBeCloseTo(a[c], 5);
  });

  it('does nothing to a symbol the main model gave no digit probability', () => {
    const p = output({ '=': 1 });
    voteOnDigits(p, 0, [opinion(4, 1)]);
    expect(Array.from(p)).toEqual(Array.from(output({ '=': 1 })));
  });

  it('with no opinions, leaves the main model as it was', () => {
    const p = output({ '9': 0.55, '4': 0.4, '+': 0.05 });
    voteOnDigits(p, 0, []);
    expect(p[9]).toBeCloseTo(0.55, 4);
    expect(p[4]).toBeCloseTo(0.4, 4);
  });

  it('works on one symbol of a batch and leaves its neighbours alone', () => {
    const batch = new Float32Array(MODEL.classes * 3);
    batch.set(output({ '1': 1 }), 0);
    batch.set(output({ '9': 0.55, '4': 0.45 }), MODEL.classes);
    batch.set(output({ '7': 1 }), MODEL.classes * 2);
    voteOnDigits(batch, MODEL.classes, [opinion(4, 0.9)]);

    expect(reading(batch.subarray(MODEL.classes, MODEL.classes * 2))).toBe('4');
    expect(batch[1]).toBe(1);
    expect(batch[MODEL.classes * 2 + 7]).toBe(1);
  });
});

describe('deciding whether to ask the helpers', () => {
  it('asks when the main model allows that the symbol is a digit', () => {
    expect(mayBeDigit(output({ '+': 0.9, '4': 0.1 }), 0)).toBe(true);
    expect(mayBeDigit(output({ '8': 1 }), 0)).toBe(true);
  });

  it('does not ask about a clear operator', () => {
    expect(mayBeDigit(output({ '=': 0.995, '2': 0.005 }), 0)).toBe(false);
  });

  it('looks at the right symbol of a batch', () => {
    const batch = new Float32Array(MODEL.classes * 2);
    batch.set(output({ '=': 1 }), 0);
    batch.set(output({ '3': 1 }), MODEL.classes);
    expect(mayBeDigit(batch, 0)).toBe(false);
    expect(mayBeDigit(batch, 1)).toBe(true);
  });
});

describe('turning raw scores into probabilities', () => {
  it('sums to one and keeps the order', () => {
    const p = softmax([2, 1, 0, -1]);
    expect(sum(p)).toBeCloseTo(1, 6);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
  });

  it('copes with very large scores', () => {
    const p = softmax([1000, 999, 0]);
    expect(Number.isFinite(p[0])).toBe(true);
    expect(sum(p)).toBeCloseTo(1, 6);
  });

  it('reads one row out of a batch of scores', () => {
    const scores = [0, 0, 0, 5, 1, 0];
    expect(Array.from(softmax(scores, 3, 3))).toEqual(Array.from(softmax([5, 1, 0])));
  });
});
