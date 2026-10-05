import { describe, expect, it } from 'vitest';
import { graphOf, hasGraphForm, readGraph } from '../../src/app/graphs';

const form = (text: string): boolean => hasGraphForm([...text]);
const read = (text: string): string => readGraph([...text]).join('');

describe("the shape of a graph's line", () => {
  it('is a symbol, "=", and more, with no other "="', () => {
    expect(form('9=2x+1')).toBe(true);
    expect(form('9=x')).toBe(true);
  });

  it('is not a sum, a line that ends in "=", or one too short to say anything', () => {
    expect(form('18+4=')).toBe(false);
    expect(form('9=2x+1=')).toBe(false);
    expect(form('9=')).toBe(false);
    expect(form('=2x')).toBe(false);
    expect(form('12=x')).toBe(false);
  });
});

describe('reading y', () => {
  it('reads the first symbol as y, whatever the model took it for', () => {
    expect(read('9=2x+1')).toBe('y=2x+1');
    expect(read('4=x')).toBe('y=x');
    expect(read('1=3-x÷2')).toBe('y=3-x÷2');
  });

  it('needs x after the "=": without it there is nothing to draw', () => {
    expect(read('9=21')).toBe('9=21');
  });

  it('leaves x = … alone, which gives x a value, and a dot', () => {
    expect(read('x=2x')).toBe('x=2x');
    expect(read('.=x')).toBe('.=x');
  });
});

describe('graphOf', () => {
  it('is the expression after "y="', () => {
    expect(graphOf('y=2x+1')).toEqual({ body: '2x+1' });
  });

  it('is nothing for other lines', () => {
    expect(graphOf('y=')).toBeNull();
    expect(graphOf('y=x=')).toBeNull();
    expect(graphOf('x=2')).toBeNull();
    expect(graphOf('18+4=')).toBeNull();
  });
});
