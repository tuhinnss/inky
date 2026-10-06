import { describe, expect, it } from 'vitest';
import { compile, evaluate, tokenize, type Evaluation } from '../../src/math';

function value(input: string): number {
  const result = evaluate(input);
  if (result.status !== 'ok') throw new Error(`"${input}" gave ${JSON.stringify(result)}`);
  return result.value;
}

function text(input: string): string {
  const result = evaluate(input);
  if (result.status !== 'ok') throw new Error(`"${input}" gave ${JSON.stringify(result)}`);
  return result.text;
}

function errorCode(input: string): string {
  const result = evaluate(input);
  if (result.status !== 'error') throw new Error(`"${input}" gave ${JSON.stringify(result)}`);
  return result.error.code;
}

describe('operator precedence (BODMAS)', () => {
  it('evaluates the example from the problem statement', () => {
    expect(value('18+4×3=')).toBe(30);
  });

  it.each([
    ['2+3×4', 14],
    ['2×3+4', 10],
    ['20-12÷4', 17],
    ['12÷4-20', -17],
    ['2+3×4-6÷2', 11],
    ['1+2×3+4×5+6', 33],
    ['100÷10×2', 20],
    ['2×3÷4', 1.5],
  ])('%s = %s', (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  it('gives multiplication and division the same precedence, left to right', () => {
    expect(value('8÷4×2')).toBe(4); // (8÷4)×2, not 8÷(4×2) = 1
    expect(value('8×4÷2')).toBe(16);
  });

  it('gives addition and subtraction the same precedence, left to right', () => {
    expect(value('10-4+3')).toBe(9); // (10-4)+3, not 10-(4+3) = 3
  });
});

describe('associativity of chained operations', () => {
  it('subtracts left to right', () => {
    expect(value('8-3-2')).toBe(3); // right-associative would give 7
    expect(value('100-10-20-30')).toBe(40);
  });

  it('divides left to right', () => {
    expect(value('64÷4÷2')).toBe(8); // right-associative would give 32
    expect(value('1000÷10÷10÷10')).toBe(1);
  });

  it('handles long chains', () => {
    expect(value('1+2+3+4+5+6+7+8+9+10')).toBe(55);
    expect(value('2×2×2×2×2×2×2×2×2×2')).toBe(1024);
  });
});

describe('numbers', () => {
  it('reads a single digit', () => {
    expect(value('7')).toBe(7);
  });

  it('reads multi-digit integers', () => {
    expect(value('1234567890')).toBe(1234567890);
    expect(value('123+456')).toBe(579);
  });

  it('keeps leading zeros decimal, never octal', () => {
    expect(value('007')).toBe(7);
    expect(value('010+010')).toBe(20);
  });

  it('reads decimals', () => {
    expect(value('3.14')).toBe(3.14);
    expect(value('0.5+0.25')).toBe(0.75);
    expect(value('12.5×4')).toBe(50);
  });

  it('accepts a decimal point with no leading or trailing digit', () => {
    expect(value('.5')).toBe(0.5);
    expect(value('5.')).toBe(5);
    expect(value('.5+.5')).toBe(1);
  });
});

describe('negative numbers and unary minus', () => {
  it('negates a leading number', () => {
    expect(value('-5')).toBe(-5);
    expect(value('-5+3')).toBe(-2);
    expect(value('-2.5×2')).toBe(-5);
  });

  it('negates after a binary operator', () => {
    expect(value('3+-2')).toBe(1);
    expect(value('3--2')).toBe(5);
    expect(value('3×-2')).toBe(-6);
    expect(value('6÷-2')).toBe(-3);
  });

  it('binds unary minus tighter than multiplication', () => {
    expect(value('-2×3')).toBe(-6);
    expect(value('-2×-3')).toBe(6);
    expect(value('2+-3×4')).toBe(-10);
  });

  it('stacks repeated minus signs', () => {
    expect(value('--5')).toBe(5);
    expect(value('---5')).toBe(-5);
    expect(value('4---1')).toBe(3);
  });

  it('produces negative results from subtraction', () => {
    expect(value('3-10')).toBe(-7);
  });
});

describe('parentheses', () => {
  it('override precedence', () => {
    expect(value('(2+3)×4')).toBe(20);
    expect(value('2×(3+4)')).toBe(14);
    expect(value('(8-3)-(2-1)')).toBe(4);
  });

  it('nest', () => {
    expect(value('((2+3)×(4-1))÷3')).toBe(5);
    expect(value('-(2+3)')).toBe(-5);
  });

  it('report an unclosed or unopened bracket', () => {
    expect(errorCode('(2+3')).toBe('unbalanced-paren');
    expect(errorCode('2+3)')).toBe('unbalanced-paren');
  });

  it('report brackets with nothing to evaluate inside', () => {
    expect(errorCode('()')).toBe('unexpected-token');
    expect(errorCode('(2+)')).toBe('unexpected-token');
  });
});

describe('division by zero', () => {
  it('reports Undefined instead of Infinity', () => {
    const result = evaluate('5÷0=');
    expect(result.status).toBe('undefined');
    expect(result).toMatchObject({ text: 'Undefined' });
  });

  it('reports Undefined for 0 ÷ 0 instead of NaN', () => {
    expect(evaluate('0÷0').status).toBe('undefined');
  });

  it('detects a zero divisor that is itself computed', () => {
    expect(evaluate('5÷(3-3)').status).toBe('undefined');
    expect(evaluate('1÷0.0').status).toBe('undefined');
    expect(evaluate('1÷-0').status).toBe('undefined');
  });

  it('stays Undefined when the division is buried in a larger expression', () => {
    expect(evaluate('1+2×3÷0-4').status).toBe('undefined');
    expect(evaluate('1÷0×0').status).toBe('undefined'); // Infinity × 0 would be NaN
    expect(evaluate('1÷0-1÷0').status).toBe('undefined'); // Infinity - Infinity would be NaN
  });

  it('points at the division sign responsible', () => {
    expect(evaluate('12+5÷0')).toMatchObject({ status: 'undefined', position: 4 });
  });

  it('allows zero as a dividend', () => {
    expect(value('0÷5')).toBe(0);
  });
});

describe('malformed input', () => {
  it.each([
    ['', 'empty'],
    ['=', 'empty'],
    ['   ', 'empty'],
    ['.', 'malformed-number'],
    ['.=', 'malformed-number'],
    ['1.2.3', 'malformed-number'],
    ['1..2', 'malformed-number'],
    ['3++', 'unexpected-operator'],
    ['3++2', 'unexpected-operator'],
    ['3+', 'unexpected-end'],
    ['3×', 'unexpected-end'],
    ['3-', 'unexpected-end'],
    ['-', 'unexpected-end'],
    ['+3', 'unexpected-operator'],
    ['×3', 'unexpected-operator'],
    ['÷', 'unexpected-operator'],
    ['3×÷2', 'unexpected-operator'],
    ['3÷×2', 'unexpected-operator'],
    ['3=4', 'unexpected-equals'],
    ['==', 'unexpected-equals'],
    ['3+4==', 'unexpected-equals'],
    ['2(3)', 'unexpected-token'],
    ['3a', 'unexpected-character'],
    ['3 4', 'unexpected-token'],
  ])('"%s" is a clean %s error', (input, code) => {
    expect(errorCode(input)).toBe(code);
  });

  it('never throws, whatever the input', () => {
    const alphabet = '0123456789.+-×÷=() xa';
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;

    for (let run = 0; run < 2000; run++) {
      const length = Math.floor(random() * 12);
      let input = '';
      for (let i = 0; i < length; i++) input += alphabet[Math.floor(random() * alphabet.length)];

      let result: Evaluation | undefined;
      expect(() => (result = evaluate(input))).not.toThrow();
      expect(['ok', 'undefined', 'overflow', 'error']).toContain(result?.status);
      if (result?.status === 'ok') expect(Number.isFinite(result.value)).toBe(true);
    }
  });

  it('survives pathologically deep nesting', () => {
    expect(evaluate('-'.repeat(100_000) + '1').status).toBe('error');
    expect(evaluate('('.repeat(100_000)).status).toBe('error');
  });

  it('survives very long flat expressions', () => {
    const terms = 20_000;
    expect(value(Array(terms).fill('1').join('+'))).toBe(terms);
  });

  it('says which operator is missing its number', () => {
    expect(evaluate('18+4×=')).toMatchObject({
      status: 'error',
      error: { code: 'unexpected-end', message: '"×" needs a number after it' },
    });
    expect(evaluate('5-=')).toMatchObject({ error: { message: '"−" needs a number after it' } });
    expect(evaluate('3++2')).toMatchObject({ error: { message: '"+" needs a number before it' } });
  });

  it('reports where the problem is', () => {
    expect(evaluate('12+×3')).toMatchObject({ status: 'error', error: { position: 3 } });
    expect(evaluate('12+')).toMatchObject({ status: 'error', error: { position: 3 } });
    expect(evaluate('1.2.3+4')).toMatchObject({ status: 'error', error: { position: 0 } });
  });
});

describe('the trailing equals sign', () => {
  it('is optional', () => {
    expect(value('2+2')).toBe(4);
    expect(value('2+2=')).toBe(4);
  });

  it('tolerates trailing spaces', () => {
    expect(value('2+2= ')).toBe(4);
  });
});

describe('operator aliases', () => {
  it('accepts keyboard and Unicode look-alikes', () => {
    expect(value('6*7')).toBe(42);
    expect(value('84/2')).toBe(42);
    expect(value('50−8')).toBe(42); // U+2212 minus sign
  });
});

describe('overflow', () => {
  it('reports results that do not fit in a double', () => {
    const huge = '9'.repeat(200);
    expect(evaluate(`${huge}×${huge}`).status).toBe('overflow');
  });

  it('reports a single literal that is already too large', () => {
    expect(evaluate('9'.repeat(400)).status).toBe('overflow');
  });
});

describe('result text', () => {
  it('formats the evaluated value', () => {
    expect(text('0.1+0.2')).toBe('0.3');
    expect(text('3-10')).toBe('−7');
    expect(text('10÷4')).toBe('2.5');
  });
});

describe('the variable x', () => {
  const x = (value: number) => new Map([['x', value]]);

  it('is read as a token of its own', () => {
    const result = tokenize('2×x');
    expect(result.ok && result.tokens[2]).toEqual({ kind: 'variable', name: 'x', position: 2 });
  });

  it('takes the value it is given', () => {
    expect(evaluate('x×3=', x(10))).toMatchObject({ status: 'ok', value: 30 });
    expect(evaluate('2×x+1', x(10))).toMatchObject({ status: 'ok', value: 21 });
    expect(evaluate('-x', x(4))).toMatchObject({ status: 'ok', value: -4 });
    expect(evaluate('x=', x(2.5))).toMatchObject({ status: 'ok', text: '2.5' });
  });

  it('is an error, pointing at the x, when it has no value', () => {
    expect(evaluate('2×x+1=')).toMatchObject({
      status: 'error',
      error: { code: 'unknown-variable', position: 2 },
    });
  });

  it('is multiplied by a number written against it, as in 2x', () => {
    expect(evaluate('2x+1', x(10))).toMatchObject({ status: 'ok', value: 21 });
    expect(evaluate('0.5x', x(10))).toMatchObject({ status: 'ok', value: 5 });
    expect(evaluate('-3x', x(2))).toMatchObject({ status: 'ok', value: -6 });
    expect(evaluate('xx', x(3))).toMatchObject({ status: 'ok', value: 9 });
    expect(evaluate('2xx-1', x(3))).toMatchObject({ status: 'ok', value: 17 });
  });

  it('binds 2x tighter than a times or division sign, as on paper', () => {
    expect(evaluate('12÷2x', x(3))).toMatchObject({ status: 'ok', value: 2 });
    expect(evaluate('3×2x', x(5))).toMatchObject({ status: 'ok', value: 30 });
  });

  it('still needs an operator between two numbers, and after an x', () => {
    expect(errorCode('2 3')).toBe('unexpected-token');
    expect(errorCode('x2')).toBe('unexpected-token');
  });

  it('points at the x of 2x when x has no value', () => {
    expect(evaluate('2x=')).toMatchObject({
      status: 'error',
      error: { code: 'unknown-variable', position: 1 },
    });
  });
});

describe('compile', () => {
  it('works an expression in x out at any x', () => {
    const compiled = compile('2x+1');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.at(0)).toBe(1);
    expect(compiled.at(3)).toBe(7);
    expect(compiled.at(-0.5)).toBe(0);
  });

  it('has no value where it divides by zero or overflows', () => {
    const reciprocal = compile('1÷x');
    expect(reciprocal.ok && reciprocal.at(0)).toBeNull();
    expect(reciprocal.ok && reciprocal.at(4)).toBe(0.25);
    const huge = compile('x×x×x×x×x×x×x×x×x×x');
    expect(huge.ok && huge.at(1e40)).toBeNull();
  });

  it('reports a malformed expression once, up front', () => {
    expect(compile('2x+')).toMatchObject({ ok: false, error: { code: 'unexpected-end' } });
    expect(compile('')).toMatchObject({ ok: false, error: { code: 'empty' } });
  });

  it('gives the same values as evaluate', () => {
    const compiled = compile('3-x×2÷4');
    for (const value of [-7, -1, 0, 0.3, 12]) {
      const expected = evaluate('3-x×2÷4', new Map([['x', value]]));
      expect(compiled.ok && compiled.at(value)).toBe(
        expected.status === 'ok' ? expected.value : null,
      );
    }
  });
});

describe('powers', () => {
  const x = (value: number) => new Map([['x', value]]);

  it('are read from raised digits, as one token', () => {
    const result = tokenize('2¹⁰');
    expect(result.ok && result.tokens).toEqual([
      { kind: 'number', value: 2, text: '2', position: 0 },
      { kind: 'exponent', value: 10, position: 1 },
    ]);
  });

  it('raise a number or x to the power written', () => {
    expect(value('3²+4²')).toBe(25);
    expect(value('2¹⁰')).toBe(1024);
    expect(value('5⁰')).toBe(1);
    expect(evaluate('x²', x(3))).toMatchObject({ status: 'ok', value: 9 });
  });

  it('bind tighter than anything else, as in algebra', () => {
    expect(evaluate('2x²', x(3))).toMatchObject({ status: 'ok', value: 18 });
    expect(evaluate('-x²', x(3))).toMatchObject({ status: 'ok', value: -9 });
    expect(evaluate('x²-4x+3', x(1))).toMatchObject({ status: 'ok', value: 0 });
    expect(value('2×3²')).toBe(18);
    expect(value('(1+2)²')).toBe(9);
  });

  it('need something to raise', () => {
    expect(errorCode('²')).toBe('unexpected-token');
    expect(errorCode('2+²')).toBe('unexpected-token');
  });

  it('overflow like any other result too large', () => {
    expect(evaluate('9⁹⁹⁹').status).toBe('overflow');
  });

  it('are worked out at any x in a graph', () => {
    const parabola = compile('x²-4');
    expect(parabola.ok && parabola.at(3)).toBe(5);
  });
});
