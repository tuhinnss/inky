import { describe, expect, it } from 'vitest';
import { createStroke, type Stroke } from '../../src/ink';
import { layoutPage, type Line } from '../../src/layout';
import { after, ink, inkColumn, shuffled, strokesOf } from '../fixtures/ink';

const columnsOf = (lines: readonly Line[]) => lines.filter((line) => line.column);
const symbolsPerRow = (line: Line) => line.column?.rows.map((row) => row.symbols.length);

/** A straight horizontal stroke. */
function bar(fromX: number, toX: number, y: number): Stroke {
  return createStroke(
    Array.from({ length: 11 }, (_, i) => ({
      x: fromX + ((toX - fromX) * i) / 10,
      y,
      pressure: 0.5,
    })),
    4,
    '#000',
  );
}

describe('finding a column sum', () => {
  it('reads numbers stacked over a rule as one sum', () => {
    const { strokes } = inkColumn(['8', '7', '+3']);
    const lines = layoutPage(strokes);

    expect(lines).toHaveLength(1);
    expect(symbolsPerRow(lines[0])).toEqual([1, 1, 2]);
  });

  it('lists the symbols row by row and the rule last', () => {
    const { strokes, rule } = inkColumn(['12', '+34']);
    const [line] = layoutPage(strokes);

    expect(line.symbols).toHaveLength(6);
    expect(line.symbols.slice(0, 5).every((symbol) => symbol.kind === 'shape')).toBe(true);
    expect(line.symbols[5].kind).toBe('rule');
    expect(line.symbols[5].strokes).toEqual([rule]);
    expect(line.column?.rule).toBe(line.symbols[5]);
  });

  it('keeps the rows in order from the top', () => {
    const { strokes, rows } = inkColumn(['125', '48', '+6']);
    const [line] = layoutPage(strokes);
    const firstStrokeOfRow = line.column?.rows.map((row) => row.symbols[0].strokes[0]);
    expect(firstStrokeOfRow).toEqual(rows.map((row) => row[0].strokes[0]));
  });

  it('covers the rows and the rule with its bounds', () => {
    const { strokes, rule } = inkColumn(['8', '7', '+3']);
    const [line] = layoutPage(strokes);
    const ruleY = rule!.points[0].y;
    expect(line.bounds.minY).toBeLessThan(80);
    expect(line.bounds.maxY).toBeGreaterThanOrEqual(ruleY - 4);
    expect(line.height).toBeCloseTo(80, -1);
  });

  it('is not a sum until the rule is drawn', () => {
    const { strokes } = inkColumn(['8', '7', '+3'], { rule: false });
    const lines = layoutPage(strokes);
    expect(columnsOf(lines)).toEqual([]);
    expect(lines).toHaveLength(3);
  });

  it('does not depend on the order the strokes were written in', () => {
    const { strokes } = inkColumn(['125', '48', '+6']);
    for (const seed of [3, 7, 11]) {
      const [line] = layoutPage(shuffled(strokes, seed));
      expect(symbolsPerRow(line)).toEqual([3, 2, 2]);
    }
  });

  it('accepts multi-digit rows, decimals and other operators', () => {
    expect(symbolsPerRow(layoutPage(inkColumn(['7.5', '+2.25']).strokes)[0])).toEqual([3, 5]);
    expect(symbolsPerRow(layoutPage(inkColumn(['90', '-27']).strokes)[0])).toEqual([2, 3]);
    expect(symbolsPerRow(layoutPage(inkColumn(['12', '×3']).strokes)[0])).toEqual([2, 2]);
  });

  it('works at small and large handwriting', () => {
    for (const size of [36, 60, 140]) {
      const [line] = layoutPage(inkColumn(['8', '7', '+3'], { size, y: 40 }).strokes);
      expect(symbolsPerRow(line)).toEqual([1, 1, 2]);
    }
  });

  it('accepts a rule that starts after the operator, as people draw it', () => {
    const { rows } = inkColumn(['8', '7', '+3'], { rule: false, right: 400 });
    // Under the digits only, running on past them to the right.
    const short = bar(340, 460, 60 + 3 * 80 * 1.4 - 32 + 16);
    const [line] = layoutPage([...rows.flatMap(strokesOf), short]);
    expect(symbolsPerRow(line)).toEqual([1, 1, 2]);
  });

  it('accepts a rule drawn in two pieces', () => {
    const { rows, rule } = inkColumn(['125', '+48']);
    const y = rule!.points[0].y;
    const pieces = [bar(230, 330, y), bar(326, 420, y + 2)];
    const lines = layoutPage([...rows.flatMap(strokesOf), ...pieces]);
    expect(lines).toHaveLength(1);
    expect(lines[0].column?.rule.strokes).toHaveLength(2);
  });
});

describe('what is not a column sum', () => {
  it('a rule under a single row', () => {
    const { strokes } = inkColumn(['125']);
    expect(columnsOf(layoutPage(strokes))).toEqual([]);
  });

  it('a short dash under a column', () => {
    const { rows } = inkColumn(['8', '7', '+3'], { rule: false });
    const dash = bar(370, 400, 60 + 3 * 80 * 1.4 - 32 + 16); // 30 px under 80 px digits
    expect(columnsOf(layoutPage([...rows.flatMap(strokesOf), dash]))).toEqual([]);
  });

  it('equations written one under another', () => {
    const page = ['5+3=', '9-2=', '8-1=', '6-4='].flatMap((text, i) =>
      strokesOf(ink(text, { x: 60, y: 60 + i * 110, size: 80, seed: i + 1 })),
    );
    const lines = layoutPage(page);
    expect(columnsOf(lines)).toEqual([]);
    expect(lines.map((line) => line.symbols.length)).toEqual([4, 4, 4, 4]);
  });

  it('a minus sign, however long, between two numbers', () => {
    const above = ['12', '34'].flatMap((text, i) =>
      strokesOf(ink(text, { x: 160, y: 40 + i * 110, size: 80, seed: i + 1 })),
    );
    const nine = strokesOf(ink('9', { x: 60, y: 260, size: 80 }));
    const two = strokesOf(ink('2', { x: 290, y: 260, size: 80 }));
    const longMinus = bar(130, 270, 300);
    const lines = layoutPage([...above, ...nine, longMinus, ...two]);
    expect(columnsOf(lines)).toEqual([]);
    expect(lines[lines.length - 1].symbols).toHaveLength(3);
  });

  it('a rule far below the numbers', () => {
    const { rows } = inkColumn(['8', '7', '+3'], { rule: false });
    const far = bar(300, 420, 60 + 3 * 80 * 1.4 - 32 + 160); // two digit heights down
    expect(columnsOf(layoutPage([...rows.flatMap(strokesOf), far]))).toEqual([]);
  });

  it('a rule off to the side of the numbers', () => {
    const { rows, rule } = inkColumn(['8', '7', '+3'], { rule: false, right: 300 });
    void rule;
    const aside = bar(520, 640, 60 + 3 * 80 * 1.4 - 32 + 16);
    expect(columnsOf(layoutPage([...rows.flatMap(strokesOf), aside]))).toEqual([]);
  });
});

describe('a column sum among other writing', () => {
  it('leaves an equation beside it alone', () => {
    const column = inkColumn(['8', '7', '+3'], { right: 260 });
    const beside = strokesOf(ink('18+4×3=', { x: 420, y: 200, size: 80, seed: 5 }));
    const lines = layoutPage([...column.strokes, ...beside]);

    expect(lines).toHaveLength(2);
    expect(columnsOf(lines)).toHaveLength(1);
    expect(lines.find((line) => !line.column)?.symbols).toHaveLength(7);
  });

  it('leaves an equation alone that is level with a row and close enough to join its line', () => {
    const column = inkColumn(['9', '÷0'], { right: 260, y: 60 });
    // Level with the second row, about one and a half digit heights to its right.
    const rowY = 60 + 80 * 1.4;
    const beside = strokesOf(ink('18+4×3=', { x: 380, y: rowY, size: 80, seed: 5 }));
    const lines = layoutPage([...column.strokes, ...beside]);

    expect(lines).toHaveLength(2);
    expect(symbolsPerRow(lines.find((line) => line.column)!)).toEqual([1, 2]);
    expect(lines.find((line) => !line.column)?.symbols).toHaveLength(7);
  });

  it('is not tied into one line by an equation level with two of its rows at once', () => {
    const column = inkColumn(['9', '÷0'], { right: 260, y: 60 });
    // Halfway between the two rows, so that line grouping alone would join all three.
    const beside = strokesOf(ink('18+4×3=', { x: 360, y: 60 + 80 * 0.7, size: 80, seed: 5 }));
    const lines = layoutPage([...column.strokes, ...beside]);

    expect(lines).toHaveLength(2);
    expect(symbolsPerRow(lines.find((line) => line.column)!)).toEqual([1, 2]);
    expect(lines.find((line) => !line.column)?.symbols).toHaveLength(7);
  });

  it('finds two sums standing close together, their rows level', () => {
    const left = inkColumn(['125', '+48'], { right: 240, y: 60 });
    const right = inkColumn(['90', '-27'], { right: 470, y: 60, seed: 5 });
    const lines = layoutPage([...left.strokes, ...right.strokes]);

    expect(lines).toHaveLength(2);
    const leftToRight = [...lines].sort((a, b) => a.bounds.minX - b.bounds.minX);
    expect(leftToRight.map(symbolsPerRow)).toEqual([
      [3, 3],
      [2, 3],
    ]);
    // Every stroke is in exactly one of them.
    const all = lines.flatMap((line) => line.symbols.flatMap((symbol) => symbol.strokes));
    expect(all).toHaveLength(left.strokes.length + right.strokes.length);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the operator written to the left of where the rule begins', () => {
    const { rows } = inkColumn(['8', '7', '+3'], { rule: false, right: 400 });
    const ruleY = 60 + 3 * 80 * 1.4 - 32 + 16;
    const [line] = layoutPage([...rows.flatMap(strokesOf), bar(350, 470, ruleY)]);
    const last = line.column?.rows[2];
    expect(last?.symbols).toHaveLength(2);
    expect(last!.symbols[0].bounds.maxX).toBeLessThan(350); // the "+" is clear of the rule
  });

  it('keeps a smaller row written close above a wider one as a row, not a power', () => {
    // An 8 written smaller than the 17 under it, with little room between them.
    const ending = (text: string, size: number, y: number, seed: number) => {
      const width = after(ink(text, { x: 0, size, seed }), 0);
      return ink(text, { x: 400 - width, y, size, seed });
    };
    const top = ending('8', 64, 60, 1);
    const below = ending('+17', 80, 60 + 64 + 8, 2);
    const [line, ...others] = layoutPage([
      ...strokesOf(top),
      ...strokesOf(below),
      bar(290, 420, 60 + 64 + 8 + 80 + 16),
    ]);
    expect(others).toHaveLength(0);
    expect(symbolsPerRow(line)).toEqual([1, 3]);
  });

  it('does not swallow an equation written above it', () => {
    const above = strokesOf(ink('5+3=', { x: 120, y: 40, size: 80, seed: 9 }));
    const column = inkColumn(['12', '+34'], { y: 160, right: 300 });
    const lines = layoutPage([...above, ...column.strokes]);

    expect(lines).toHaveLength(2);
    expect(lines[0].column).toBeUndefined();
    expect(lines[0].symbols).toHaveLength(4);
    expect(symbolsPerRow(lines[1])).toEqual([2, 3]);
  });

  it('finds two sums side by side', () => {
    const left = inkColumn(['8', '+3'], { right: 200 });
    const right = inkColumn(['12', '×4'], { right: 520, seed: 4 });
    const lines = layoutPage([...left.strokes, ...right.strokes]);
    expect(columnsOf(lines)).toHaveLength(2);
    const leftToRight = [...lines].sort((a, b) => a.bounds.minX - b.bounds.minX);
    expect(leftToRight.map(symbolsPerRow)).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('finds two sums one below the other, each with its own rows', () => {
    const upper = inkColumn(['8', '+3'], { y: 40 });
    // Leave room under the first rule for its answer, as a writer would.
    const lower = inkColumn(['12', '+4'], { y: 40 + 2 * 80 * 1.4 + 150, seed: 6 });
    const lines = layoutPage([...upper.strokes, ...lower.strokes]);
    expect(columnsOf(lines)).toHaveLength(2);
    expect(lines.map(symbolsPerRow)).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('tolerates a digit whose tail reaches down to the rule', () => {
    const { rows, rule } = inkColumn(['8', '7', '+3'], { ruleGap: 0.02 });
    const lines = layoutPage([...rows.flatMap(strokesOf), rule!]);
    expect(symbolsPerRow(lines[0])).toEqual([1, 1, 2]);
  });
});
