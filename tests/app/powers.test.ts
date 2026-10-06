import { describe, expect, it } from 'vitest';
import { isRaised, readPowers } from '../../src/app/powers';
import type { Line, SymbolGroup } from '../../src/layout';

/** A symbol with this box, and nothing else to it. */
const at = (minX: number, minY: number, maxX: number, maxY: number): SymbolGroup => ({
  strokes: [],
  bounds: { minX, minY, maxX, maxY },
  kind: 'shape',
  key: `${minX},${minY}`,
});

/** A line of 80 px digits holding these symbols. */
const lineOf = (...symbols: SymbolGroup[]): Line => ({
  symbols,
  bounds: { minX: 0, minY: -20, maxX: 400, maxY: 80 },
  height: 80,
});

const digit = at(0, 0, 44, 80);

describe('a raised digit', () => {
  it('has its foot above the middle of its base', () => {
    expect(isRaised(at(50, -15, 70, 30), digit, lineOf(digit))).toBe(true);
  });

  it('may be written as tall as the digits, if it is raised', () => {
    expect(isRaised(at(50, -50, 90, 40), digit, lineOf(digit))).toBe(true);
  });

  it('is not a digit on the line, or one only a little high', () => {
    expect(isRaised(at(50, 0, 94, 80), digit, lineOf(digit))).toBe(false);
    expect(isRaised(at(50, -20, 90, 60), digit, lineOf(digit))).toBe(false);
  });

  it('stands to the right of its base, and near it', () => {
    expect(isRaised(at(5, -15, 25, 30), digit, lineOf(digit))).toBe(false);
    expect(isRaised(at(300, -15, 320, 30), digit, lineOf(digit))).toBe(false);
  });
});

describe('readPowers', () => {
  it('writes a raised digit as a power, and a run of them as one power', () => {
    const two = at(0, 0, 44, 80);
    const one = at(50, -20, 60, 25);
    const zero = at(64, -20, 80, 25);
    expect(readPowers(['2', '1', '0'], lineOf(two, one, zero)).join('')).toBe('2¹⁰');
  });

  it('raises x, which the model reads as "×"', () => {
    const x = at(0, 30, 40, 80);
    const two = at(46, 5, 62, 40);
    expect(readPowers(['×', '2'], lineOf(x, two)).join('')).toBe('×²');
  });

  it('raises nothing after an operator or at the start of a line', () => {
    const plus = at(0, 20, 40, 60);
    const two = at(46, -10, 62, 20);
    expect(readPowers(['+', '2'], lineOf(plus, two)).join('')).toBe('+2');
    expect(readPowers(['2'], lineOf(two)).join('')).toBe('2');
  });
});
