/**
 * The variable x: written as `x = 10` on one line and used as `x × 3 =` below it.
 *
 * The model has no letters, but a handwritten x and a times sign are the same two
 * crossing strokes, and it reads both as "×". Position tells them apart. Where a number
 * belongs, at the start of a line or after an operator or "=", a "×" cannot be a times
 * sign, so it is x. Between two numbers it multiplies. A line that began with "×" was
 * always an error before, so no sum that worked changes meaning.
 *
 * A definition holds from its line down, the way a page is read; a later one takes
 * over from there. `x = x + 1` uses the x defined above it.
 */

import { EQUALS, VARIABLE } from '../math';

const TIMES = '×';
/** After these, a number is expected rather than an operator. */
const EXPECTS_NUMBER = new Set(['+', '-', TIMES, '÷', EQUALS, '(']);

/** The symbols of a line with each "×" that stands where a number belongs read as x. */
export function readVariables(symbols: readonly string[]): string[] {
  const read: string[] = [];
  for (const symbol of symbols) {
    const previous = read[read.length - 1];
    const expectsNumber = previous === undefined || EXPECTS_NUMBER.has(previous);
    read.push(symbol === TIMES && expectsNumber ? VARIABLE : symbol);
  }
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
