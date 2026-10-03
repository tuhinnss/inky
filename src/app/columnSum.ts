/**
 * Turns the rows of a column sum into one expression the math engine can evaluate.
 * Pure logic: characters in, characters out.
 *
 *        8                       12
 *        7       8+7+3=        ×  3      12×3=
 *     +  3                     ‾‾‾‾
 *     ‾‾‾‾‾
 */

const OPERATORS: ReadonlySet<string> = new Set(['+', '-', '×', '÷']);

export interface ColumnExpression {
  /** The sum written out on one line, ending in "=". */
  expression: string;
  /**
   * For each character of `expression`, the index of the symbol it came from, counting
   * the symbols row by row and the rule last. An operator that was not written on its
   * own row points at the one it was taken from.
   */
  sources: number[];
}

/**
 * The convention is the schoolbook one. An operator is written at the left of a row and
 * joins that row to the rows above. It is usually written once, on the last row, and then
 * applies all the way up: a column of four numbers with one "+" is their sum. So a row
 * with no operator of its own takes the next one found below it. A column with no
 * operator at all is added up, which is what a line under a list of numbers means.
 *
 * A row that is itself a small calculation is kept whole with brackets, so that
 * `2+3` over `×4` is 20 and not 14.
 *
 * @param rows the symbols read on each row, top to bottom, one character each.
 */
export function assembleColumn(rows: ReadonlyArray<readonly string[]>): ColumnExpression {
  const expression: string[] = [];
  const sources: number[] = [];
  const push = (char: string, source: number): void => {
    expression.push(char);
    sources.push(source);
  };

  // Where each row's symbols begin in the line's flat list.
  const starts: number[] = [];
  let count = 0;
  for (const row of rows) {
    starts.push(count);
    count += row.length;
  }
  const ownOperator = (index: number): string | null =>
    OPERATORS.has(rows[index][0]) ? rows[index][0] : null;

  rows.forEach((row, index) => {
    const own = ownOperator(index);
    const body = own === null ? row : row.slice(1);
    const bodyStart = starts[index] + (own === null ? 0 : 1);

    if (index === 0) {
      // On the first row a sign belongs to the number. A plus there says nothing.
      if (own !== null && own !== '+') push(own, starts[0]);
    } else if (own !== null) {
      push(own, starts[index]);
    } else {
      let below = index + 1;
      while (below < rows.length && ownOperator(below) === null) below++;
      if (below < rows.length) push(rows[below][0], starts[below]);
      else push('+', bodyStart);
    }

    const calculation = body.some((char) => OPERATORS.has(char));
    if (calculation) push('(', bodyStart);
    body.forEach((char, offset) => push(char, bodyStart + offset));
    if (calculation) push(')', bodyStart + body.length - 1);
  });

  push('=', count); // the rule
  return { expression: expression.join(''), sources };
}
