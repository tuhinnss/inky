import { describe, expect, it } from 'vitest';
import { definitionOf, readVariables } from '../../src/app/variables';

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
