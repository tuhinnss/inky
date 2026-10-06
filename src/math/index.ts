/**
 * Public entry point of the math engine: recognised symbols in, a displayable outcome out.
 *
 * The engine is a pipeline of three pure stages (tokenize, parse, evaluate). It never
 * calls `eval` or `new Function`, and it never throws on bad input: every failure is an
 * ordinary return value.
 */

import { evaluateNode } from './evaluator';
import { formatNumber } from './format';
import { parse } from './parser';
import { tokenize, VARIABLE, type ExpressionError } from './tokenizer';

export type Evaluation =
  /** A finite answer. `text` is ready to draw. */
  | { status: 'ok'; value: number; text: string }
  /** Division by zero. */
  | { status: 'undefined'; text: 'Undefined'; position: number }
  /** The answer is too large for a double. */
  | { status: 'overflow'; text: 'Too large' }
  /** The symbols do not form a valid expression. */
  | { status: 'error'; error: ExpressionError };

export const EQUALS = '=';

/**
 * Evaluates an expression such as `"18+4×3"`, or `"x×3"` given a value for x.
 *
 * A single trailing `=` is accepted and ignored, since that is how expressions arrive
 * from the canvas. An `=` anywhere else is an error.
 */
export function evaluate(
  input: string,
  variables: ReadonlyMap<string, number> = new Map(),
): Evaluation {
  const source = input.trimEnd();
  const expression = source.endsWith(EQUALS) ? source.slice(0, -1) : source;

  const tokenized = tokenize(expression);
  if (!tokenized.ok) return { status: 'error', error: tokenized.error };

  const parsed = parse(tokenized.tokens, expression.length);
  if (!parsed.ok) return { status: 'error', error: parsed.error };

  const result = evaluateNode(parsed.ast, variables);
  switch (result.kind) {
    case 'value':
      return { status: 'ok', value: result.value, text: formatNumber(result.value) };
    case 'undefined':
      return { status: 'undefined', text: 'Undefined', position: result.position };
    case 'overflow':
      return { status: 'overflow', text: 'Too large' };
    case 'unknown-variable':
      return {
        status: 'error',
        error: {
          code: 'unknown-variable',
          position: result.position,
          message: `Give ${result.name} a value above, as in ${result.name} = 10`,
        },
      };
  }
}

/** An expression in x, read once, ready to be worked out at any x. */
export type Compiled =
  | {
      ok: true;
      /** The value at x, or null where there is none: a division by zero, or overflow. */
      at(x: number): number | null;
    }
  | { ok: false; error: ExpressionError };

/**
 * Prepares an expression such as `"2x+1"` to be worked out for many values of x, as a
 * graph needs: it is read and checked once, then only evaluated at each x.
 */
export function compile(input: string): Compiled {
  const tokenized = tokenize(input);
  if (!tokenized.ok) return { ok: false, error: tokenized.error };
  const parsed = parse(tokenized.tokens, input.length);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { ast } = parsed;
  // One map, refilled for each x: a graph asks for hundreds of values at a time.
  const variables = new Map<string, number>();
  return {
    ok: true,
    at(x) {
      variables.set(VARIABLE, x);
      const result = evaluateNode(ast, variables);
      return result.kind === 'value' ? result.value : null;
    },
  };
}

export { formatNumber, MINUS_SIGN } from './format';
export { parse, type Node, type ParseResult } from './parser';
export { evaluateNode, type EvaluationResult } from './evaluator';
export {
  tokenize,
  SUPERSCRIPTS,
  VARIABLE,
  type BinaryOperator,
  type ExpressionError,
  type SyntaxErrorCode,
  type Token,
  type TokenizeResult,
} from './tokenizer';
