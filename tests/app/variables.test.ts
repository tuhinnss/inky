import { describe, expect, it } from 'vitest';
import { definitionOf, readVariables } from '../../src/app/variables';
import { evaluate } from '../../src/math';

const read = (text: string): string => readVariables([...text]).join('');

describe('reading x from a "×"', () => {
  it('reads a "×" at the start of a line as x', () => {
    expect(read('×=10')).toBe('x=10');
  });

  it('reads a "×" between two numbers as times', () => {
    expect(read('3×4=')).toBe('3×4=');
  });

  it('tells the two apart on one line', () => {
    expect(read('××3=')).toBe('x×3=');
    expect(read('2××+1=')).toBe('2×x+1=');
    expect(read('×××=')).toBe('x×x=');
  });

  it('reads a "×" after "=" or "-" as x', () => {
    expect(read('×=×+1')).toBe('x=x+1');
    expect(read('5-×=')).toBe('5-x=');
    expect(read('-×=')).toBe('-x=');
  });

  it('leaves every other symbol alone', () => {
    expect(read('18+4÷2-0.5=')).toBe('18+4÷2-0.5=');
  });

  it('reads a "×" with nothing after it to multiply as the x of 2x', () => {
    expect(read('2×+1=')).toBe('2x+1=');
    expect(read('2×=')).toBe('2x=');
    expect(read('2×')).toBe('2x');
    expect(read('3×÷2=')).toBe('3x÷2=');
    expect(read('××')).toBe('xx');
  });

  it('keeps a "×" before "−" a times sign, except in a graph', () => {
    expect(read('3×-2=')).toBe('3×-2=');
    expect(readVariables([...'9=3×-2'], { graph: true }).join('')).toBe('9=3x-2');
  });

  it('changes the meaning of no sum that worked before', () => {
    // The rule before 2x: a "×" is x only where a number is expected.
    const before = (text: string): string => {
      let out = '';
      for (const char of text) {
        const previous = out[out.length - 1];
        const expected = previous === undefined || '+-×÷=('.includes(previous);
        out += char === '×' && expected ? 'x' : char;
      }
      return out;
    };
    const alphabet = ['1', '2', '+', '-', '×', '÷', '.'];
    let seed = 7;
    const next = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 5000; n++) {
      const length = 1 + Math.floor(next() * 8);
      const text = Array.from(
        { length },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join('');
      const old = evaluate(before(text), new Map([['x', 3]]));
      if (old.status !== 'ok') continue;
      expect(evaluate(read(text), new Map([['x', 3]])), text).toEqual(old);
    }
  });
});

describe('a line that gives x a value', () => {
  it('is "x=" followed by what x is', () => {
    expect(definitionOf('x=10')).toEqual({ name: 'x', body: '10' });
    expect(definitionOf('x=3×4')).toEqual({ name: 'x', body: '3×4' });
  });

  it('is not a line that asks for an answer', () => {
    expect(definitionOf('x=10=')).toBeNull();
    expect(definitionOf('x=')).toBeNull();
    expect(definitionOf('x×3=')).toBeNull();
    expect(definitionOf('2=x')).toBeNull();
  });
});
