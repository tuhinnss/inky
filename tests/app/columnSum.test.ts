import { describe, expect, it } from 'vitest';
import { assembleColumn } from '../../src/app/columnSum';
import { evaluate } from '../../src/math';

/** Rows as they are read: one string per row, one character per symbol. */
const column = (...rows: string[]) => assembleColumn(rows.map((row) => [...row]));
const written = (...rows: string[]) => column(...rows).expression;
const answer = (...rows: string[]) => {
  const result = evaluate(written(...rows));
  return result.status === 'ok' ? result.value : result.status;
};

describe('writing a column sum out on one line', () => {
  it('joins the rows with the operator on the last row', () => {
    expect(written('8', '7', '+3')).toBe('8+7+3=');
  });

  it('adds up, as the example on the page does', () => {
    expect(answer('8', '7', '+3')).toBe(18);
  });

  it('uses the operator a row carries', () => {
    expect(written('125', '+48')).toBe('125+48=');
    expect(written('90', '-27')).toBe('90-27=');
    expect(written('12', '×3')).toBe('12×3=');
    expect(written('84', '÷4')).toBe('84÷4=');
  });

  it('lets one operator on the last row apply all the way up', () => {
    expect(written('20', '5', '4', '-3')).toBe('20-5-4-3=');
    expect(answer('20', '5', '4', '-3')).toBe(8);
  });

  it('takes each row’s own operator when every row has one', () => {
    expect(written('12', '+5', '-3')).toBe('12+5-3=');
    expect(answer('12', '+5', '-3')).toBe(14);
  });

  it('gives a row with no operator the next one written below it', () => {
    expect(written('9', '4', '-2', '1', '+6')).toBe('9-4-2+1+6=');
  });

  it('adds up a column that has no operator at all', () => {
    expect(written('15', '20', '7')).toBe('15+20+7=');
    expect(answer('15', '20', '7')).toBe(42);
  });

  it('keeps decimals', () => {
    expect(written('7.5', '+2.25')).toBe('7.5+2.25=');
    expect(answer('7.5', '+2.25')).toBe(9.75);
  });

  it('reads a sign on the first row as part of the number', () => {
    expect(written('-5', '+8')).toBe('-5+8=');
    expect(answer('-5', '+8')).toBe(3);
  });

  it('ignores a plus on the first row', () => {
    expect(written('+5', '+8')).toBe('5+8=');
  });

  it('keeps a row that is itself a calculation together', () => {
    expect(written('2+3', '×4')).toBe('(2+3)×4=');
    expect(answer('2+3', '×4')).toBe(20);
    expect(answer('10', '-2×3')).toBe(4);
  });

  it('applies ordinary precedence between rows', () => {
    // 2 + 3 × 4, written as three rows.
    expect(answer('2', '+3', '×4')).toBe(14);
  });

  it('reports division by zero', () => {
    expect(answer('9', '÷0')).toBe('undefined');
  });

  it('leaves a malformed column for the math engine to refuse', () => {
    expect(answer('8', '+')).toBe('error'); // an operator with nothing after it
    expect(answer('×5', '+3')).toBe('error'); // nothing for the first row to multiply
    expect(answer('5+3=', '+2')).toBe('error'); // an "=" in the middle
  });
});

describe('tracing a column expression back to the page', () => {
  it('maps every character to the symbol it came from, the rule last', () => {
    // Symbols in page order: 8 | 7 | + 3 | rule  →  indices 0 | 1 | 2 3 | 4
    expect(column('8', '7', '+3')).toEqual({
      expression: '8+7+3=',
      sources: [0, 2, 1, 2, 3, 4],
    });
  });

  it('points an operator that was supplied at the number it was put before', () => {
    expect(column('15', '20').sources).toEqual([0, 1, 2, 2, 3, 4]);
  });

  it('points brackets at the ends of the row they enclose', () => {
    const { expression, sources } = column('2+3', '×4');
    expect(expression).toBe('(2+3)×4=');
    expect(sources).toEqual([0, 0, 1, 2, 2, 3, 4, 5]);
  });

  it('has exactly one source per character', () => {
    for (const rows of [
      ['8', '7', '+3'],
      ['-5', '+8'],
      ['2+3', '×4'],
      ['9', '4', '-2', '1'],
    ]) {
      const { expression, sources } = column(...rows);
      expect(sources).toHaveLength(expression.length);
      const symbols = rows.join('').length + 1;
      for (const source of sources) expect(source).toBeLessThan(symbols);
    }
  });
});
