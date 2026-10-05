/**
 * The variable x: written as `x = 10` on one line and used as `x × 3 =` below it.
 *
 * The model has no letters, but a handwritten x and a times sign are the same two
 * crossing strokes, and it reads both as "×". Position tells them apart. Where a number
 * belongs, at the start of a line or after an operator or "=", a "×" cannot be a times
 * sign, so it is x. Between two numbers it multiplies. A line that began with "×" was
 * always an error before, so no sum that worked changes meaning.
 *
 * The same goes for a "×" with nothing after it that it could multiply: at the end of the
 * line, or before "+", "÷" or "=". It is the x of `2x`, multiplied by what comes before
 * it. Before "−" a "×" still multiplies, since `3 × −2` is a sum that works, except in a
 * graph's line (graphs.ts), where `y = 3x − 2` is far more likely than a times sign with
 * nothing to do with x.
 *
 * A definition holds from its line down, the way a page is read; a later one takes
 * over from there. `x = x + 1` uses the x defined above it.
 */

import { EQUALS, VARIABLE } from '../math';

const TIMES = '×';
/** After these, a number is expected rather than an operator. */
const EXPECTS_NUMBER = new Set(['+', '-', TIMES, '÷', EQUALS, '(']);
/** None of these can begin a number, so a "×" just before one has nothing to multiply. */
const CANNOT_BEGIN_NUMBER = new Set(['+', '÷', EQUALS, ')']);

export interface ReadOptions {
  /** The line is a graph's, `y = …`: a "×" before "−" is then x as well. */
  graph?: boolean;
}

/** The symbols of a line with each "×" that cannot be a times sign read as x. */
export function readVariables(symbols: readonly string[], options: ReadOptions = {}): string[] {
  const read: string[] = [];
  symbols.forEach((symbol, i) => {
    if (symbol !== TIMES) {
      read.push(symbol);
      return;
    }
    const previous = read[read.length - 1];
    const next = symbols[i + 1];
    const numberExpected = previous === undefined || EXPECTS_NUMBER.has(previous);
    const nothingToMultiply =
      next === undefined ||
      CANNOT_BEGIN_NUMBER.has(next) ||
      (options.graph === true && next === '-');
    read.push(numberExpected || nothingToMultiply ? VARIABLE : symbol);
  });
  return read;
}

/** The value a line gives x. */
export interface Definition {
  name: string;
  value: number;
}

/** A line of the form `x=…` with no "=" at the end gives x a value: the part after "=". */
export function definitionOf(expression: string): { name: string; body: string } | null {
  const prefix = VARIABLE + EQUALS;
  if (!expression.startsWith(prefix)) return null;
  const body = expression.slice(prefix.length);
  if (body === '' || body.includes(EQUALS)) return null;
  return { name: VARIABLE, body };
}
