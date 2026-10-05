import { describe, expect, it } from 'vitest';
import { EquationTracker, evaluatePage, isReadable, readEquation } from '../../src/app/equations';
import { layoutPage, segmentLine, type Line } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import { after, ink, inkColumn, strokesOf, type InkSymbol } from '../fixtures/ink';

/** A model output that is `confidence` sure of `symbol`. */
function sure(symbol: string, confidence = 0.99): Float32Array {
  const rest = (1 - confidence) / (MODEL_SYMBOLS.length - 1);
  return Float32Array.from(MODEL_SYMBOLS, (s) =>
    s === (symbol as ModelSymbol) ? confidence : rest,
  );
}

/**
 * What the model takes each character for, where it has no class of its own: it knows no
 * letters, and reads a handwritten y most often as a 9.
 */
type Reads = Readonly<Record<string, string>>;
const MODEL_READS: Reads = { y: '9' };

/** A cache as if the model had read every symbol of `written` correctly. */
function cacheFor(
  line: Line,
  written: readonly InkSymbol[],
  confidence = 0.99,
  reads: Reads = MODEL_READS,
) {
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    const char = written[i].char;
    if (symbol.kind === 'shape') cache.set(symbol.key, sure(reads[char] ?? char, confidence));
  });
  return cache;
}

function read(text: string, confidence?: number, reads?: Reads) {
  const written = ink(text, { size: 80 });
  const line = segmentLine(strokesOf(written));
  expect(line.symbols).toHaveLength(written.length);
  return readEquation({ id: 1, version: 1, line }, cacheFor(line, written, confidence, reads));
}

describe('reading an equation', () => {
  it('reads the symbols left to right into an expression', () => {
    expect(read('18+4×3=').expression).toBe('18+4×3=');
  });

  it('evaluates an expression that ends with "="', () => {
    expect(read('18+4×3=').evaluation).toMatchObject({ status: 'ok', value: 30, text: '30' });
  });

  it('includes decimal points found by geometry', () => {
    const equation = read('7.5÷2=');
    expect(equation.expression).toBe('7.5÷2=');
    expect(equation.evaluation).toMatchObject({ status: 'ok', value: 3.75 });
  });

  it('does not evaluate until the "=" is written', () => {
    const equation = read('18+4×3');
    expect(equation.expression).toBe('18+4×3');
    expect(equation.evaluation).toBeNull();
  });

  it('reports Undefined for division by zero', () => {
    expect(read('5÷0=').evaluation).toMatchObject({ status: 'undefined', text: 'Undefined' });
  });

  it('reports malformed input as an error, with the offending symbol', () => {
    expect(read('3++2=').evaluation).toMatchObject({
      status: 'error',
      error: { code: 'unexpected-operator', position: 2 },
    });
  });

  it('reports a lone "=" as an error rather than throwing', () => {
    expect(read('=').evaluation).toMatchObject({ status: 'error', error: { code: 'empty' } });
  });

  it('gives one reading per symbol', () => {
    const equation = read('12+3=');
    expect(equation.readings).toHaveLength(5);
    expect(equation.readings.map((reading) => reading.symbol)).toEqual(['1', '2', '+', '3', '=']);
  });

  it('is only as confident as its least certain symbol', () => {
    const written = ink('12+3=', { size: 80 });
    const line = segmentLine(strokesOf(written));
    const cache = cacheFor(line, written);
    cache.set(line.symbols[1].key, sure('2', 0.55));

    const equation = readEquation({ id: 1, version: 1, line }, cache);
    expect(equation.confidence).toBeCloseTo(0.55, 1);
    expect(equation.readings[0].confidence).toBeGreaterThan(0.9);
  });

  it('knows whether a line can be read from the cache alone', () => {
    const written = ink('1.5+2=', { size: 80 });
    const line = segmentLine(strokesOf(written));
    const cache = cacheFor(line, written);
    expect(isReadable(line, cache)).toBe(true); // the dot needs no model output

    cache.delete(line.symbols[0].key);
    expect(isReadable(line, cache)).toBe(false);
  });
});

describe('the variable x on a page', () => {
  /** The page's lines, top to bottom, each read as if the model got every symbol right. */
  const page = (...lines: string[]) =>
    evaluatePage(lines.map((text, i) => ({ ...read(text), id: i + 1 })));
  const valueOf = (equation: { evaluation: unknown }) =>
    (equation.evaluation as { value?: number } | null)?.value;

  it('reads a "×" where a number belongs as x', () => {
    const equation = read('×=10');
    expect(equation.expression).toBe('x=10');
    expect(equation.readings[0].symbol).toBe('x');
  });

  it('uses the value given above', () => {
    const [definition, sum] = page('×=10', '××3=');
    expect(definition.definition).toEqual({ name: 'x', value: 10 });
    expect(definition.evaluation).toBeNull();
    expect(sum.expression).toBe('x×3=');
    expect(valueOf(sum)).toBe(30);
  });

  it('works out a value given as a sum', () => {
    const [, sum] = page('×=3×4', '××2=');
    expect(valueOf(sum)).toBe(24);
  });

  it('says so, pointing at the x, when x is used above where it is given', () => {
    const [sum] = page('2××=', '×=10');
    expect(sum.evaluation).toMatchObject({
      status: 'error',
      error: { code: 'unknown-variable', position: 2 },
    });
  });

  it('lets a later definition take over from where it is written', () => {
    const [, first, , second] = page('×=10', '××2=', '×=1', '××2=');
    expect(valueOf(first)).toBe(20);
    expect(valueOf(second)).toBe(2);
  });

  it('builds on the value above in "x = x + 1"', () => {
    const [, , sum] = page('×=10', '×=×+1', '×=');
    expect(valueOf(sum)).toBe(11);
  });

  it('points into the line as written when a definition does not work out', () => {
    const [definition] = page('×=3++2');
    expect(definition.definition).toBeUndefined();
    expect(definition.evaluation).toMatchObject({
      status: 'error',
      error: { code: 'unexpected-operator', position: 4 },
    });
  });

  it('leaves lines without x as they were read', () => {
    const plain = read('18+4×3=');
    expect(evaluatePage([plain])[0]).toBe(plain);
  });
});

describe('graphs on a page', () => {
  const page = (...lines: Array<string | [string, Reads]>) =>
    evaluatePage(
      lines.map((line, i) => {
        const [text, reads] = typeof line === 'string' ? [line, undefined] : line;
        return { ...read(text, undefined, reads), id: i + 1 };
      }),
    );

  it('reads y by its place, whatever the model took it for', () => {
    for (const as of ['9', '4', '1', '8']) {
      const [line] = page(['y=2×+1', { y: as }]);
      expect(line.expression).toBe('y=2x+1');
      expect(line.readings[0]).toEqual({ symbol: 'y', confidence: 1 });
      expect(line.graph).toEqual({ body: '2x+1' });
      expect(line.evaluation).toBeNull();
    }
  });

  it('reads the x of 3x before a minus sign in a graph', () => {
    expect(page('y=3×-2')[0].graph).toEqual({ body: '3x-2' });
  });

  it('draws y = x', () => {
    expect(page('y=×')[0].graph).toEqual({ body: 'x' });
  });

  it('points into the line when the expression does not make sense', () => {
    const [line] = page('y=2×+');
    expect(line.graph).toBeUndefined();
    expect(line.evaluation).toMatchObject({
      status: 'error',
      error: { code: 'unexpected-end', position: 5 },
    });
  });

  it('takes x = 2x + 1 for a graph whose y was read as "×", when x has no value', () => {
    const [line] = page(['y=2×+1', { y: '×' }]);
    expect(line.expression).toBe('y=2x+1');
    expect(line.readings[0].symbol).toBe('y');
    expect(line.graph).toEqual({ body: '2x+1' });
    expect(line.definition).toBeUndefined();
  });

  it('keeps x = x + 1 a definition when x has a value above', () => {
    const [, line] = page('×=10', ['y=×+1', { y: '×' }]);
    expect(line.graph).toBeUndefined();
    expect(line.definition).toEqual({ name: 'x', value: 11 });
  });

  it('draws the graph over every x, whatever value x has above', () => {
    const [, line] = page('×=10', 'y=2×+1');
    expect(line.graph).toEqual({ body: '2x+1' });
  });

  it('leaves a line without x as it was', () => {
    const [line] = page(['y=21', { y: '4' }]);
    expect(line.expression).toBe('4=21');
    expect(line.graph).toBeUndefined();
  });
});

describe('reading a column sum', () => {
  /** Lays out a column and reads it as if the model had got every symbol right. */
  function readColumn(rows: string[], options: Parameters<typeof inkColumn>[1] = {}) {
    const written = inkColumn(rows, options);
    const [line] = layoutPage(written.strokes);
    const chars = written.rows.flat().map((symbol) => symbol.char);
    const cache = new Map<string, Float32Array>();
    line.symbols.forEach((symbol, i) => {
      if (symbol.kind === 'shape') cache.set(symbol.key, sure(chars[i]));
    });
    return { line, cache, equation: readEquation({ id: 1, version: 1, line }, cache) };
  }

  it('adds up the example: 8, 7 and +3 over a rule', () => {
    const { equation } = readColumn(['8', '7', '+3']);
    expect(equation.expression).toBe('8+7+3=');
    expect(equation.evaluation).toMatchObject({ status: 'ok', value: 18, text: '18' });
  });

  it('subtracts, multiplies and divides', () => {
    expect(readColumn(['90', '-27']).equation.evaluation).toMatchObject({ value: 63 });
    expect(readColumn(['12', '×3']).equation.evaluation).toMatchObject({ value: 36 });
    expect(readColumn(['84', '÷4']).equation.evaluation).toMatchObject({ value: 21 });
  });

  it('reads a decimal point against its own row', () => {
    const { equation } = readColumn(['7.5', '+2.25']);
    expect(equation.expression).toBe('7.5+2.25=');
    expect(equation.evaluation).toMatchObject({ status: 'ok', value: 9.75 });
    // A point sits low on its row. Judged against the whole column, the one in the
    // first row would be near the top and look like a stray mark.
    const points = equation.readings.filter((reading) => reading.symbol === '.');
    expect(points.map((reading) => reading.confidence)).toEqual([0.95, 0.95]);
  });

  it('gives one reading per symbol, the rule standing for "="', () => {
    const { equation, line } = readColumn(['8', '7', '+3']);
    expect(equation.readings).toHaveLength(line.symbols.length);
    expect(equation.readings.map((reading) => reading.symbol)).toEqual(['8', '7', '+', '3', '=']);
  });

  it('says which symbol each character of the expression came from', () => {
    const { equation, line } = readColumn(['8', '7', '+3']);
    expect(equation.sources).toHaveLength(equation.expression.length);
    expect(equation.sources?.[equation.expression.length - 1]).toBe(line.symbols.length - 1);
  });

  it('does not work anything out before the rule is drawn', () => {
    const written = inkColumn(['8', '7', '+3'], { rule: false });
    const lines = layoutPage(written.strokes);
    const cache = new Map<string, Float32Array>();
    const chars = written.rows.flat().map((symbol) => symbol.char);
    lines
      .flatMap((line) => line.symbols)
      .forEach((symbol, i) => cache.set(symbol.key, sure(chars[i])));

    const equations = lines.map((line, i) => readEquation({ id: i, version: 1, line }, cache));
    expect(equations.map((equation) => equation.expression)).toEqual(['8', '7', '+3']);
    expect(equations.every((equation) => equation.evaluation === null)).toBe(true);
  });

  it('reports Undefined for a division by zero', () => {
    expect(readColumn(['9', '÷0']).equation.evaluation).toMatchObject({ status: 'undefined' });
  });

  it('reports a column that makes no sense as an error', () => {
    expect(readColumn(['8', '++3']).equation.evaluation).toMatchObject({ status: 'error' });
  });

  it('needs the model for the digits but not for the rule', () => {
    const { line, cache } = readColumn(['12', '+34']);
    expect(isReadable(line, cache)).toBe(true);
    expect(cache.has(line.symbols[line.symbols.length - 1].key)).toBe(false); // the rule

    cache.delete(line.symbols[0].key);
    expect(isReadable(line, cache)).toBe(false);
  });

  it('is only as confident as its least certain symbol', () => {
    const { line, cache } = readColumn(['8', '7', '+3']);
    cache.set(line.symbols[1].key, sure('7', 0.5));
    const equation = readEquation({ id: 1, version: 1, line }, cache);
    expect(equation.confidence).toBeLessThan(0.6);
  });

  it('is unsettled by nothing in the rule: it is always read as "=" with certainty', () => {
    const { equation } = readColumn(['8', '+3']);
    expect(equation.readings[equation.readings.length - 1]).toEqual({
      symbol: '=',
      confidence: 1,
    });
  });
});

describe('EquationTracker', () => {
  const page = (...lines: InkSymbol[][]) => layoutPage(lines.flatMap(strokesOf));

  it('keeps one identity for a column as rows and the rule are added', () => {
    const tracker = new EquationTracker();
    const open = inkColumn(['8', '7', '+3'], { rule: false });
    const before = tracker.update(layoutPage(open.strokes));
    expect(before).toHaveLength(3); // three separate lines so far

    const closed = inkColumn(['8', '7', '+3']);
    const rule = closed.rule!;
    const after = tracker.update(layoutPage([...open.strokes, rule]));
    expect(after).toHaveLength(1);
    expect(before.map((line) => line.id)).toContain(after[0].id);
    expect(after[0].version).toBe(2);
  });

  it('numbers new equations and starts them at version 1', () => {
    const tracker = new EquationTracker();
    const tracked = tracker.update(page(ink('1+1=', { y: 0 }), ink('2+2=', { y: 200 })));
    expect(tracked.map(({ id, version }) => [id, version])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('keeps id and version when nothing changed', () => {
    const tracker = new EquationTracker();
    const first = ink('1+1=', { y: 0 });
    tracker.update(page(first));
    expect(tracker.update(page(first))[0]).toMatchObject({ id: 1, version: 1 });
  });

  it('keeps the id and raises the version when ink is added to a line', () => {
    const tracker = new EquationTracker();
    const start = ink('1+1', { y: 0 });
    tracker.update(page(start));

    const equals = ink('=', { x: after(start), y: 0 });
    const [tracked] = tracker.update(page([...start, ...equals]));
    expect(tracked).toMatchObject({ id: 1, version: 2 });
  });

  it('keeps the id and raises the version when ink is erased from a line', () => {
    const tracker = new EquationTracker();
    const written = ink('12+3=', { y: 0 });
    tracker.update(page(written));

    const [tracked] = tracker.update(page(written.filter((symbol) => symbol.char !== '2')));
    expect(tracked).toMatchObject({ id: 1, version: 2 });
  });

  it('leaves other equations untouched when one changes', () => {
    const tracker = new EquationTracker();
    const top = ink('1+1=', { y: 0 });
    const bottom = ink('2+2', { y: 200 });
    tracker.update(page(top, bottom));

    const tracked = tracker.update(
      page(top, [...bottom, ...ink('=', { x: after(bottom), y: 200 })]),
    );
    expect(tracked.map(({ id, version }) => [id, version])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('keeps identities when a new line is written above existing ones', () => {
    const tracker = new EquationTracker();
    const existing = ink('1+1=', { y: 200 });
    tracker.update(page(existing));

    const tracked = tracker.update(page(ink('9-4=', { y: 0 }), existing));
    // Top to bottom: the new line first, with a fresh id; the old one keeps id 1.
    expect(tracked.map(({ id }) => id)).toEqual([2, 1]);
  });

  it('never reuses the id of an erased equation', () => {
    const tracker = new EquationTracker();
    tracker.update(page(ink('1+1=', { y: 0 })));
    tracker.update([]);
    expect(tracker.update(page(ink('2+2=', { y: 0 })))[0].id).toBe(2);
  });

  it('gives the identity to the larger part when a line is split in two', () => {
    const tracker = new EquationTracker();
    const left = ink('12+34', { x: 0, y: 0, size: 60 });
    const bridge = ink('+', { x: after(left, 50), y: 0, size: 60 });
    const right = ink('5', { x: after(bridge, 50), y: 0, size: 60 });

    // Written with a bridge they are one line; erase the bridge and they are two.
    const whole = [...left, ...bridge, ...right];
    expect(tracker.update(page(whole))).toHaveLength(1);

    const tracked = tracker.update(page(left, right));
    expect(tracked).toHaveLength(2);
    expect(tracked[0]).toMatchObject({ id: 1, version: 2 }); // five symbols kept the id
    expect(tracked[1]).toMatchObject({ id: 2, version: 1 });
  });

  it('reports the current version of an equation', () => {
    const tracker = new EquationTracker();
    tracker.update(page(ink('1+1', { y: 0 })));
    expect(tracker.versionOf(1)).toBe(1);
    expect(tracker.versionOf(99)).toBeUndefined();

    tracker.update([]);
    expect(tracker.versionOf(1)).toBeUndefined();
  });
});
