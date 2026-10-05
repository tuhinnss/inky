/**
 * Graphs: a line written `y = 2x + 1`, with no "=" at the end, is drawn as a graph.
 *
 * The model has no letters, and it reads a handwritten y as almost anything. On the real
 * y's of the MathWriting data set it read 9 most often, then 1, 4, 8 and 0, and "×" only
 * one time in twenty. So y is known by where it stands rather than by its shape: it is
 * the first symbol of a line whose second is "=", which goes on to use x and does not end
 * in "=". Nothing else written that way means anything to the notebook: `4 = 2x + 1` is
 * an equation to solve, which it does not do.
 *
 * A y read as "×" makes the line look like `x = 2x + 1`, a definition of x. Where x has
 * no value above that line, it cannot be one, and `evaluatePage` takes it for the graph
 * it must be.
 */

import { EQUALS, VARIABLE } from '../math';

/** The letter on the left of a graph's "=". */
export const GRAPH_VARIABLE = 'y';

/** What a graph's line says to draw. */
export interface Graph {
  /** The expression in x after `y=`, such as "2x+1". */
  body: string;
}

/**
 * Whether a line has the shape of a graph's, before x and y are read in it: one symbol,
 * "=", at least one more, and no other "=".
 */
export function hasGraphForm(symbols: readonly string[]): boolean {
  return symbols.length >= 3 && symbols[1] === EQUALS && !symbols.slice(2).includes(EQUALS);
}

/**
 * The symbols of a line, with x already read in them (variables.ts), and the first read
 * as y if the line is a graph's: it has the shape of one and uses x. A first symbol read
 * as x is left alone, since `x = …` gives x a value, and so is a dot.
 */
export function readGraph(symbols: readonly string[]): string[] {
  const [first] = symbols;
  if (!hasGraphForm(symbols) || first === VARIABLE || first === '.') return [...symbols];
  if (!symbols.slice(2).includes(VARIABLE)) return [...symbols];
  return [GRAPH_VARIABLE, ...symbols.slice(1)];
}

/** The graph a line asks for: `y=` and an expression after it, or null. */
export function graphOf(expression: string): Graph | null {
  const prefix = GRAPH_VARIABLE + EQUALS;
  if (!expression.startsWith(prefix)) return null;
  const body = expression.slice(prefix.length);
  if (body === '' || body.includes(EQUALS)) return null;
  return { body };
}
