import { describe, expect, it } from 'vitest';
import { readEquation, type Equation } from '../../src/app/equations';
import { estimateTilt, layoutPage, levelStroke, segmentLine } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import { equationAt, labelFor, symbolAt, toLineFrame } from '../../src/ui/readings';
import { ink, strokesOf, turned } from '../fixtures/ink';

/** A sum read as if every symbol had been recognised for what it is. */
function read(text: string, x = 40, y = 100, id = 1): Equation {
  const written = ink(text, { size: 80, x, y });
  const line = segmentLine(strokesOf(written));
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    if (symbol.kind !== 'shape') return;
    const char = written[i].char as ModelSymbol;
    cache.set(
      symbol.key,
      Float32Array.from(MODEL_SYMBOLS, (s) => (s === char ? 1 : 0)),
    );
  });
  return readEquation({ id, version: 1, line }, cache);
}

/** A point on the ink of a symbol: the middle sample of its first stroke. */
function onInk(equation: Equation, index: number) {
  const points = equation.line.symbols[index].strokes[0].points;
  return points[Math.floor(points.length / 2)];
}

describe('which symbol a tap is on', () => {
  const sum = read('7+5=');

  it('finds the symbol whose ink is under the tap', () => {
    expect(symbolAt(sum, onInk(sum, 0))).toBe(0);
    expect(symbolAt(sum, onInk(sum, 2))).toBe(2);
  });

  it('counts a tap just beside a line of ink as on it', () => {
    const p = onInk(sum, 0);
    expect(symbolAt(sum, { x: p.x + 5, y: p.y })).toBe(0);
  });

  it('does not count the empty corner of a symbol, where a decimal point would go', () => {
    // Bottom right of the 7's box: no ink there, only the room a "7." would use.
    const box = sum.line.symbols[0].bounds;
    expect(symbolAt(sum, { x: box.maxX - 2, y: box.maxY - 2 })).toBe(-1);
  });

  it('finds nothing on empty paper', () => {
    expect(symbolAt(sum, { x: 2000, y: 2000 })).toBe(-1);
  });
});

describe('which sum a tap is on', () => {
  const first = read('7+5=', 40, 100, 1);
  const second = read('9-4=', 40, 400, 2);
  const answers = new Map([[2, { minX: 600, minY: 380, maxX: 660, maxY: 460 }]]);

  it('is the sum whose ink is tapped', () => {
    expect(equationAt([first, second], answers, onInk(second, 0))?.id).toBe(2);
    expect(equationAt([first, second], answers, onInk(first, 1))?.id).toBe(1);
  });

  it('is the sum whose answer is tapped', () => {
    expect(equationAt([first, second], answers, { x: 630, y: 420 })?.id).toBe(2);
  });

  it('is none for a tap on empty paper', () => {
    expect(equationAt([first, second], answers, { x: 900, y: 50 })).toBeNull();
  });
});

describe('a line written at an angle', () => {
  it('turns a tap on the page into the level frame the line was read in', () => {
    const written = ink('18+4×3=', { size: 80, x: 100, y: 400 });
    const strokes = turned(written, 25);
    const tilt = estimateTilt(strokes)!;
    const original = strokes[0].points[3];
    const levelled = levelStroke(strokes[0], tilt).points[3];
    const mapped = toLineFrame(original, tilt);
    expect(mapped.x).toBeCloseTo(levelled.x, 6);
    expect(mapped.y).toBeCloseTo(levelled.y, 6);
  });

  it('finds the tapped symbol on a turned line', () => {
    const written = ink('18+4×3=', { size: 80, x: 100, y: 400 });
    const strokes = turned(written, 25);
    const [line] = layoutPage(strokes);
    const equation = readEquation({ id: 1, version: 1, line }, new Map());
    // A point on the page, on the ink of the first symbol as it was really written.
    const first = line.symbols[0].strokes[0];
    const page = strokes.find((s) => s.id === first.id)!.points[2];
    expect(symbolAt(equation, page)).toBe(0);
  });
});

describe('labels', () => {
  it('writes a minus as a minus sign, and everything else as read', () => {
    expect(labelFor('-')).toBe('−');
    expect(labelFor('×')).toBe('×');
    expect(labelFor('7')).toBe('7');
    expect(labelFor('.')).toBe('.');
  });
});
