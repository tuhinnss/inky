/**
 * Recursive-descent parser for arithmetic.
 *
 *   expression := term   (('+' | '-') term)*
 *   term       := unary  (('×' | '÷') unary)*
 *   unary      := '-' unary | primary
 *   primary    := NUMBER | VARIABLE | '(' expression ')'
 *
 * One function per grammar rule. Precedence falls out of the nesting: `term` binds
 * tighter than `expression` because `expression` calls `term`, never the reverse.
 * Both loops consume left to right, which is what makes `8 - 3 - 2` equal 3, not 7.
 *
 * Nothing here throws. Malformed input comes back as a value the caller can render.
 */

import type { BinaryOperator, ExpressionError, Token } from './tokenizer';

export type Node =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string; position: number }
  | { type: 'negate'; operand: Node; position: number }
  | { type: 'binary'; operator: BinaryOperator; left: Node; right: Node; position: number };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: ExpressionError };

/**
 * Deeply nested input such as a long run of minus signs would otherwise recurse until
 * the engine's stack overflows, which is an exception we promised never to throw.
 */
const MAX_DEPTH = 200;

/** Internal signal used to unwind the descent; it never leaves `parse`. */
class ParseFailure extends Error {
  constructor(readonly error: ExpressionError) {
    super(error.message);
  }
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly endPosition: number,
  ) {}

  parse(): Node {
    if (this.tokens.length === 0) {
      this.fail('empty', this.endPosition, 'Nothing to calculate yet');
    }
    const ast = this.expression();
    const trailing = this.peek();
    if (trailing) {
      if (trailing.kind === 'paren' && trailing.paren === ')') {
        this.fail('unbalanced-paren', trailing.position, 'This ")" has no matching "("');
      }
      this.fail('unexpected-token', trailing.position, 'Expected an operator here');
    }
    return ast;
  }

  private expression(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'operator' || (token.operator !== '+' && token.operator !== '-')) break;
      this.index++;
      const right = this.term();
      left = { type: 'binary', operator: token.operator, left, right, position: token.position };
    }
    return left;
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'operator' || (token.operator !== '×' && token.operator !== '÷')) break;
      this.index++;
      const right = this.unary();
      left = { type: 'binary', operator: token.operator, left, right, position: token.position };
    }
    return left;
  }

  private unary(): Node {
    const token = this.peek();
    if (token?.kind === 'operator' && token.operator === '-') {
      this.index++;
      this.enter(token.position);
      const operand = this.unary();
      this.depth--;
      return { type: 'negate', operand, position: token.position };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();

    if (!token) {
      const previous = this.tokens[this.index - 1];
      this.fail(
        'unexpected-end',
        this.endPosition,
        previous?.kind === 'operator'
          ? `"${previous.operator === '-' ? '−' : previous.operator}" needs a number after it`
          : 'A number is missing here',
      );
    }

    if (token.kind === 'number') {
      this.index++;
      return { type: 'number', value: token.value };
    }

    if (token.kind === 'variable') {
      this.index++;
      return { type: 'variable', name: token.name, position: token.position };
    }

    if (token.kind === 'paren' && token.paren === '(') {
      this.index++;
      this.enter(token.position);
      const inner = this.expression();
      this.depth--;
      const closing = this.peek();
      if (closing?.kind !== 'paren' || closing.paren !== ')') {
        this.fail('unbalanced-paren', token.position, 'This "(" is never closed');
      }
      this.index++;
      return inner;
    }

    if (token.kind === 'operator') {
      this.fail(
        'unexpected-operator',
        token.position,
        `"${token.operator}" needs a number before it`,
      );
    }

    // A ")" where a number should be: "()", "(2+)" or a stray ")3".
    this.fail('unexpected-token', token.position, 'Expected a number here');
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private enter(position: number): void {
    if (++this.depth > MAX_DEPTH) {
      this.fail('unexpected-token', position, 'The expression is nested too deeply');
    }
  }

  private fail(code: ExpressionError['code'], position: number, message: string): never {
    throw new ParseFailure({ code, position, message });
  }
}

/**
 * @param endPosition position reported when the input stops too early, normally the
 *   length of the source string.
 */
export function parse(tokens: readonly Token[], endPosition: number): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokens, endPosition).parse() };
  } catch (failure) {
    if (failure instanceof ParseFailure) return { ok: false, error: failure.error };
    throw failure;
  }
}
