/**
 * Turns a string of recognised symbols into tokens.
 *
 * Every handwritten symbol is exactly one character here, so a token's `position` is
 * also the index of the symbol on the canvas. Errors carry that position so the UI can
 * point at the stroke that caused them.
 */

export type BinaryOperator = '+' | '-' | '×' | '÷';

export type Token =
  | { kind: 'number'; value: number; text: string; position: number }
  | { kind: 'operator'; operator: BinaryOperator; position: number }
  | { kind: 'paren'; paren: '(' | ')'; position: number };

export type SyntaxErrorCode =
  | 'empty'
  | 'unexpected-character'
  | 'malformed-number'
  | 'unexpected-operator'
  | 'unexpected-end'
  | 'unexpected-equals'
  | 'unbalanced-paren'
  | 'unexpected-token';

export interface ExpressionError {
  code: SyntaxErrorCode;
  /** Index of the offending symbol, or the input length when the input ended too early. */
  position: number;
  message: string;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: ExpressionError };

/** Keyboard and Unicode look-alikes are folded onto the four canonical operators. */
const OPERATOR_ALIASES: Readonly<Record<string, BinaryOperator>> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '×': '×',
  '*': '×',
  '÷': '÷',
  '/': '÷',
};

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

export function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === ' ') {
      index++;
      continue;
    }

    if (isDigit(char) || char === '.') {
      const start = index;
      let dots = 0;
      let digits = 0;
      while (index < input.length && (isDigit(input[index]) || input[index] === '.')) {
        if (input[index] === '.') dots++;
        else digits++;
        index++;
      }
      const text = input.slice(start, index);
      if (dots > 1 || digits === 0) {
        return {
          ok: false,
          error: {
            code: 'malformed-number',
            position: start,
            message:
              digits === 0
                ? 'A decimal point needs a digit next to it'
                : `"${text}" has more than one decimal point`,
          },
        };
      }
      tokens.push({ kind: 'number', value: Number(text), text, position: start });
      continue;
    }

    const operator = OPERATOR_ALIASES[char];
    if (operator !== undefined) {
      tokens.push({ kind: 'operator', operator, position: index });
      index++;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', paren: char, position: index });
      index++;
      continue;
    }

    return {
      ok: false,
      error: {
        code: char === '=' ? 'unexpected-equals' : 'unexpected-character',
        position: index,
        message:
          char === '=' ? 'Only one "=" is allowed, at the end' : `Unexpected character "${char}"`,
      },
    };
  }

  return { ok: true, tokens };
}
