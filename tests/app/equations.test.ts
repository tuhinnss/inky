import { describe, expect, it } from 'vitest';
import { EquationTracker, isReadable, readEquation } from '../../src/app/equations';
import { layoutPage, segmentLine, type Line } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import { after, ink, strokesOf, type InkSymbol } from '../fixtures/ink';

/** A model output that is `confidence` sure of `symbol`. */
function sure(symbol: string, confidence = 0.99): Float32Array {
  const rest = (1 - confidence) / (MODEL_SYMBOLS.length - 1);
  return Float32Array.from(MODEL_SYMBOLS, (s) =>
    s === (symbol as ModelSymbol) ? confidence : rest,
  );
}

/** A cache as if the model had read every symbol of `written` correctly. */
function cacheFor(line: Line, written: readonly InkSymbol[], confidence = 0.99) {
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    if (symbol.kind === 'shape') cache.set(symbol.key, sure(written[i].char, confidence));
  });
  return cache;
}

function read(text: string, confidence?: number) {
  const written = ink(text, { size: 80 });
  const line = segmentLine(strokesOf(written));
  return readEquation({ id: 1, version: 1, line }, cacheFor(line, written, confidence));
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

describe('EquationTracker', () => {
  const page = (...lines: InkSymbol[][]) => layoutPage(lines.flatMap(strokesOf));

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
