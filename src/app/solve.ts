/**
 * Equations in x, solved: a line such as `x² − 5x + 6 = 0` or `2x + 3 = 7`, with x on
 * either side of a single "=", is answered with the values of x that make it true.
 *
 * Such a line is told from the others by its "=": it is neither at the end, which asks for
 * a sum's answer, nor second, after the y of a graph or the x of a definition, which those
 * lines start with. So `x² = 9` is solved, and `x = 9` still gives x a value.
 *
 * Equations of the second degree or less are solved exactly, not searched for. The left side
 * minus the right is worked out at x = −1, 0 and 1, which fixes the a, b and c of
 * ax² + bx + c; that it really is that polynomial is checked at four more values of x. Then
 * the quadratic formula gives its roots, or a line's one root, with no rounding but the
 * machine's. Anything else, x³ = 8 or 1 ÷ x = 2, is beyond what is solved.
 */

import { compile, EQUALS, formatNumber, VARIABLE, type ExpressionError } from '../math';

export type Solution =
  /** One or two values of x, in increasing order. */
  | { kind: 'roots'; values: number[] }
  /** No real x makes it true: x² = −1, or x + 1 = x. */
  | { kind: 'none' }
  /** Every x makes it true: x + x = 2x. */
  | { kind: 'every' }
  /** Of a degree above two, or not a polynomial at all: x³ = 8, 1 ÷ x = 2. */
  | { kind: 'beyond' };

/** The two sides of an equation to solve, or null if the line is not one. */
export function equationIn(expression: string): { left: string; right: string } | null {
  const at = expression.indexOf(EQUALS);
  if (at < 1 || at === expression.length - 1 || at !== expression.lastIndexOf(EQUALS)) {
    return null;
  }
  // "y=…" is a graph's line and "x=…" a definition: a symbol, then "=".
  if (at === 1) return null;
  if (!expression.includes(VARIABLE)) return null;
  return { left: expression.slice(0, at), right: expression.slice(at + 1) };
}

/** Values of x at which the fitted polynomial is checked against the equation itself. */
const CHECKS = [2, -3, 0.5, 7];
/** How near the check must come, relative to the size of the values. */
const TOLERANCE = 1e-9;

/**
 * Solves `left = right` for x.
 *
 * @returns the solution, or what is wrong with one side, at its place in the whole line.
 */
export function solve(
  left: string,
  right: string,
): { ok: true; solution: Solution } | { ok: false; error: ExpressionError } {
  const l = compile(left);
  if (!l.ok) return { ok: false, error: l.error };
  const r = compile(right);
  if (!r.ok) {
    return { ok: false, error: { ...r.error, position: r.error.position + left.length + 1 } };
  }
  const f = (x: number): number | null => {
    const a = l.at(x);
    const b = r.at(x);
    return a === null || b === null ? null : a - b;
  };
  const c = f(0);
  const plus = f(1);
  const minus = f(-1);
  if (c === null || plus === null || minus === null) return beyond();
  const a = (plus + minus) / 2 - c;
  const b = (plus - minus) / 2;
  for (const x of CHECKS) {
    const value = f(x);
    const fitted = a * x * x + b * x + c;
    if (value === null || Math.abs(value - fitted) > TOLERANCE * (1 + Math.abs(value))) {
      return beyond();
    }
  }
  return { ok: true, solution: rootsOf(a, b, c) };
}

const beyond = (): { ok: true; solution: Solution } => ({ ok: true, solution: { kind: 'beyond' } });

/** The real roots of ax² + bx + c. */
export function rootsOf(a: number, b: number, c: number): Solution {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  const tiny = (value: number): boolean => Math.abs(value) <= 1e-12 * scale;
  if (scale === 0) return { kind: 'every' };
  if (tiny(a)) {
    if (tiny(b)) return tiny(c) ? { kind: 'every' } : { kind: 'none' };
    return { kind: 'roots', values: [tidy(-c / b)] };
  }
  const discriminant = b * b - 4 * a * c;
  if (Math.abs(discriminant) <= 1e-12 * (b * b + Math.abs(4 * a * c))) {
    return { kind: 'roots', values: [tidy(-b / (2 * a))] };
  }
  if (discriminant < 0) return { kind: 'none' };
  // The formula as written loses digits when b is large and the roots far apart; working
  // out the larger root first and the other from their product does not.
  const q = -(b + Math.sign(b || 1) * Math.sqrt(discriminant)) / 2;
  const roots = [q / a, c / q].map(tidy).sort((m, n) => m - n);
  return { kind: 'roots', values: roots };
}

/** A root without the last bits of noise: 2.9999999999999996 is 3. */
function tidy(value: number): number {
  const rounded = Number(value.toPrecision(12));
  return rounded === 0 ? 0 : rounded;
}

/** What is pencilled in after an equation: "x = 2 or 3", "no real x". */
export function solutionText(solution: Solution): string {
  switch (solution.kind) {
    case 'roots':
      return `x = ${solution.values.map((v) => formatNumber(Number(v.toPrecision(6)))).join(' or ')}`;
    case 'none':
      return 'no real x';
    case 'every':
      return 'every x';
    case 'beyond':
      return 'solved up to x² only';
  }
}
