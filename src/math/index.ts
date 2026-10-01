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
import { tokenize, type ExpressionError } from './tokenizer';

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
 * Evaluates an expression such as `"18+4×3"`.
 *
 * A single trailing `=` is accepted and ignored, since that is how expressions arrive
 * from the canvas. An `=` anywhere else is an error.
 */
export function evaluate(input: string): Evaluation {
  const source = input.trimEnd();
  const expression = source.endsWith(EQUALS) ? source.slice(0, -1) : source;

  const tokenized = tokenize(expression);
  if (!tokenized.ok) return { status: 'error', error: tokenized.error };

  const parsed = parse(tokenized.tokens, expression.length);
  if (!parsed.ok) return { status: 'error', error: parsed.error };

  const result = evaluateNode(parsed.ast);
  switch (result.kind) {
    case 'value':
      return { status: 'ok', value: result.value, text: formatNumber(result.value) };
    case 'undefined':
      return { status: 'undefined', text: 'Undefined', position: result.position };
    case 'overflow':
      return { status: 'overflow', text: 'Too large' };
  }
}

export { formatNumber, MINUS_SIGN } from './format';
export { parse, type Node, type ParseResult } from './parser';
export { evaluateNode, type EvaluationResult } from './evaluator';
export {
  tokenize,
  type BinaryOperator,
  type ExpressionError,
  type SyntaxErrorCode,
  type Token,
  type TokenizeResult,
} from './tokenizer';
