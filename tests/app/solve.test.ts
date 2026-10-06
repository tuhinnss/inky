import { describe, expect, it } from 'vitest';
import { equationIn, rootsOf, solutionText, solve } from '../../src/app/solve';

const solved = (left: string, right: string) => {
  const result = solve(left, right);
  if (!result.ok) throw new Error(`${left}=${right} gave ${JSON.stringify(result.error)}`);
  return result.solution;
};

describe('an equation to solve', () => {
  it('has x and one "=" between its two sides', () => {
    expect(equationIn('x²-5x+6=0')).toEqual({ left: 'x²-5x+6', right: '0' });
    expect(equationIn('2x+3=7')).toEqual({ left: '2x+3', right: '7' });
    expect(equationIn('10=5x')).toEqual({ left: '10', right: '5x' });
  });

  it('is not a definition, a graph, a sum or a line without x', () => {
    expect(equationIn('x=10')).toBeNull();
    expect(equationIn('y=2x')).toBeNull();
    expect(equationIn('18+4x=')).toBeNull();
    expect(equationIn('2x=3=4')).toBeNull();
    expect(equationIn('12=34')).toBeNull();
  });
});

describe('solve', () => {
  it('finds both roots of a quadratic, in order', () => {
    expect(solved('x²-5x+6', '0')).toEqual({ kind: 'roots', values: [2, 3] });
    expect(solved('x²', '9')).toEqual({ kind: 'roots', values: [-3, 3] });
  });

  it('finds roots that are not whole numbers', () => {
    const solution = solved('2x²+3x-1', '0');
    expect(solution.kind === 'roots' && solution.values).toEqual([
      expect.closeTo((-3 - Math.sqrt(17)) / 4, 10),
      expect.closeTo((-3 + Math.sqrt(17)) / 4, 10),
    ]);
  });

  it('finds the one root of a perfect square, and of a line', () => {
    expect(solved('x²-4x+4', '0')).toEqual({ kind: 'roots', values: [2] });
    expect(solved('2x+3', '7')).toEqual({ kind: 'roots', values: [2] });
    expect(solved('10', '5x')).toEqual({ kind: 'roots', values: [2] });
  });

  it('works with x on both sides', () => {
    expect(solved('x²', '2x+3')).toEqual({ kind: 'roots', values: [-1, 3] });
  });

  it('says when no real x will do, and when every x will', () => {
    expect(solved('x²+1', '0')).toEqual({ kind: 'none' });
    expect(solved('x+1', 'x')).toEqual({ kind: 'none' });
    expect(solved('x+x', '2x')).toEqual({ kind: 'every' });
  });

  it('leaves alone what is not of the second degree or less', () => {
    expect(solved('x²×x', '8')).toEqual({ kind: 'beyond' });
    expect(solved('1÷x', '2')).toEqual({ kind: 'beyond' });
  });

  it('points at a mistake on either side, in the line as written', () => {
    expect(solve('2x+', '7')).toMatchObject({ ok: false, error: { position: 3 } });
    expect(solve('7', '2x+')).toMatchObject({ ok: false, error: { position: 5 } });
  });
});

describe('rootsOf', () => {
  it('keeps its digits when the roots are far apart', () => {
    const solution = rootsOf(1, -1e8, 1);
    expect(solution.kind === 'roots' && solution.values[0]).toBeCloseTo(1e-8, 20);
    expect(solution.kind === 'roots' && solution.values[1]).toBeCloseTo(1e8, 0);
  });
});

describe('solutionText', () => {
  it('writes what x is', () => {
    expect(solutionText({ kind: 'roots', values: [2, 3] })).toBe('x = 2 or 3');
    expect(solutionText({ kind: 'roots', values: [-0.5] })).toBe('x = −0.5');
    expect(solutionText({ kind: 'roots', values: [0.697224362268, 4.30277563773] })).toBe(
      'x = 0.697224 or 4.30278',
    );
    expect(solutionText({ kind: 'none' })).toBe('no real x');
    expect(solutionText({ kind: 'every' })).toBe('every x');
  });
});
