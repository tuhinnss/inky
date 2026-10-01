import { describe, expect, it } from 'vitest';
import { parse, tokenize, type Node, type Token } from '../../src/math';

function tokens(input: string): Token[] {
  const result = tokenize(input);
  if (!result.ok) throw new Error(`"${input}" failed: ${result.error.message}`);
  return result.tokens;
}

function ast(input: string): Node {
  const result = parse(tokens(input), input.length);
  if (!result.ok) throw new Error(`"${input}" failed: ${result.error.message}`);
  return result.ast;
}

describe('tokenize', () => {
  it('groups consecutive digits into one number', () => {
    expect(tokens('18+4')).toEqual([
      { kind: 'number', value: 18, text: '18', position: 0 },
      { kind: 'operator', operator: '+', position: 2 },
      { kind: 'number', value: 4, text: '4', position: 3 },
    ]);
  });

  it('keeps the decimal point inside the number', () => {
    expect(tokens('3.14')).toEqual([{ kind: 'number', value: 3.14, text: '3.14', position: 0 }]);
  });

  it('records the symbol index of every token', () => {
    expect(tokens('12×(3-4)').map((token) => token.position)).toEqual([0, 2, 3, 4, 5, 6, 7]);
  });

  it('skips spaces without shifting positions', () => {
    expect(tokens('1 + 2').map((token) => token.position)).toEqual([0, 2, 4]);
  });

  it('normalises operator aliases', () => {
    expect(
      tokens('*/−').map((token) => (token.kind === 'operator' ? token.operator : null)),
    ).toEqual(['×', '÷', '-']);
  });

  it('rejects a lone decimal point', () => {
    expect(tokenize('2+.')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'malformed-number', position: 2 }) as unknown,
    });
  });

  it('rejects characters outside the vocabulary', () => {
    expect(tokenize('2+a')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unexpected-character', position: 2 }) as unknown,
    });
  });
});

describe('parse', () => {
  it('nests multiplication under addition', () => {
    expect(ast('1+2×3')).toEqual({
      type: 'binary',
      operator: '+',
      position: 1,
      left: { type: 'number', value: 1 },
      right: {
        type: 'binary',
        operator: '×',
        position: 3,
        left: { type: 'number', value: 2 },
        right: { type: 'number', value: 3 },
      },
    });
  });

  it('builds left-leaning trees for chains of one operator', () => {
    expect(ast('8-3-2')).toEqual({
      type: 'binary',
      operator: '-',
      position: 3,
      left: {
        type: 'binary',
        operator: '-',
        position: 1,
        left: { type: 'number', value: 8 },
        right: { type: 'number', value: 3 },
      },
      right: { type: 'number', value: 2 },
    });
  });

  it('wraps a negated operand', () => {
    expect(ast('3×-2')).toEqual({
      type: 'binary',
      operator: '×',
      position: 1,
      left: { type: 'number', value: 3 },
      right: { type: 'negate', position: 2, operand: { type: 'number', value: 2 } },
    });
  });

  it('reports an empty token list', () => {
    expect(parse([], 0)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'empty', position: 0 }) as unknown,
    });
  });
});
