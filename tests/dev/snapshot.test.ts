import { describe, expect, it } from 'vitest';
import { readEquation } from '../../src/app/equations';
import { parseSnapshot, restoreStrokes, takeSnapshot } from '../../src/dev/snapshot';
import { createStroke, type Stroke } from '../../src/ink';
import { layoutPage, segmentLine } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import { ink, strokesOf } from '../fixtures/ink';

const details = {
  note: '18+4×3=',
  capturedAt: '2026-10-03T00:00:00.000Z',
  device: { userAgent: 'test', width: 1200, height: 800, pixelRatio: 2 },
};

/** A written sum, read as if the model had got every symbol right. */
function written(text: string) {
  const symbols = ink(text, { size: 80, x: 40, y: 100 });
  const strokes = strokesOf(symbols);
  const line = segmentLine(strokes);
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    const char = symbols[i].char as ModelSymbol;
    cache.set(
      symbol.key,
      Float32Array.from(MODEL_SYMBOLS, (s) => (s === char ? 1 : 0)),
    );
  });
  return { strokes, equation: readEquation({ id: 1, version: 1, line }, cache) };
}

/** Same strokes, point for point, to within the hundredth of a pixel a snapshot keeps. */
function expectSameInk(actual: readonly Stroke[], expected: readonly Stroke[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((stroke, i) => {
    expect(stroke.width).toBe(expected[i].width);
    expect(stroke.simulatePressure).toBe(expected[i].simulatePressure);
    expect(stroke.points).toHaveLength(expected[i].points.length);
    stroke.points.forEach((point, j) => {
      expect(Math.abs(point.x - expected[i].points[j].x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(point.y - expected[i].points[j].y)).toBeLessThanOrEqual(0.005);
    });
  });
}

describe('saving a page of handwriting', () => {
  it('records every stroke and what was read from it', () => {
    const { strokes, equation } = written('18+4×3=');
    const snapshot = takeSnapshot(strokes, [equation], details);

    expect(snapshot.strokes).toHaveLength(strokes.length);
    expect(snapshot.note).toBe('18+4×3=');
    expect(snapshot.equations).toHaveLength(1);
    expect(snapshot.equations[0]).toMatchObject({ expression: '18+4×3=', answer: '30' });
    expect(snapshot.equations[0].symbols.map((symbol) => symbol.read).join('')).toBe('18+4×3=');
  });

  it('says which strokes make up each symbol', () => {
    const { strokes, equation } = written('4+1=');
    const snapshot = takeSnapshot(strokes, [equation], details);
    const perSymbol = snapshot.equations[0].symbols.map((symbol) => symbol.strokes.length);
    expect(perSymbol).toEqual([2, 2, 1, 2]); // "4" and "+" and "=" are two strokes each
    const all = snapshot.equations[0].symbols.flatMap((symbol) => symbol.strokes);
    expect(new Set(all)).toEqual(new Set(strokes.map((stroke) => stroke.id)));
  });

  it('records an error by its code and an unfinished line as no answer', () => {
    const bad = written('3++2=');
    expect(takeSnapshot(bad.strokes, [bad.equation], details).equations[0].answer).toBe(
      'error: unexpected-operator',
    );
    const open = written('3+2');
    expect(takeSnapshot(open.strokes, [open.equation], details).equations[0].answer).toBeNull();
  });

  it('survives being written to a file and read back', () => {
    const { strokes, equation } = written('7.5÷2-60=');
    const snapshot = takeSnapshot(strokes, [equation], details);
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });
});

describe('replaying a saved page', () => {
  it('gives back the same ink', () => {
    const { strokes, equation } = written('96-27=');
    const snapshot = takeSnapshot(strokes, [equation], details);
    expectSameInk(restoreStrokes(snapshot), strokes);
  });

  it('keeps real pen pressure and the pen width', () => {
    const pen = createStroke(
      [
        { x: 1, y: 2, pressure: 0.137 },
        { x: 30, y: 40, pressure: 0.912 },
      ],
      6.5,
      '#000',
      false,
    );
    const [restored] = restoreStrokes(takeSnapshot([pen], [], details));
    expect(restored.simulatePressure).toBe(false);
    expect(restored.width).toBe(6.5);
    expect(restored.points.map((p) => p.pressure)).toEqual([0.137, 0.912]);
  });

  it('lays out into the same symbols as the original page', () => {
    const { strokes, equation } = written('18+4×3=');
    const restored = restoreStrokes(takeSnapshot(strokes, [equation], details));
    const [before] = layoutPage(strokes);
    const [after] = layoutPage(restored);
    expect(after.symbols.map((symbol) => symbol.strokes.length)).toEqual(
      before.symbols.map((symbol) => symbol.strokes.length),
    );
    expect(after.bounds.minX).toBeCloseTo(before.bounds.minX, 1);
  });

  it('gives the strokes new ids, in the order they were written', () => {
    const { strokes, equation } = written('12×12=');
    const snapshot = takeSnapshot(strokes, [equation], details);
    snapshot.strokes.reverse(); // a file need not list them in order
    const restored = restoreStrokes(snapshot);
    const ids = restored.map((stroke) => stroke.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(Math.min(...ids)).toBeGreaterThan(Math.max(...strokes.map((stroke) => stroke.id)));
    expectSameInk(restored, strokes);
  });
});

describe('reading a snapshot file', () => {
  const valid = () => {
    const { strokes, equation } = written('5×7=');
    return JSON.parse(JSON.stringify(takeSnapshot(strokes, [equation], details))) as Record<
      string,
      unknown
    >;
  };

  it.each([null, 42, 'text', [], {}, { format: 'something-else' }])(
    'rejects %j, which is not a snapshot',
    (value) => {
      expect(() => parseSnapshot(value)).toThrow('Not a CalcInk page snapshot');
    },
  );

  it('rejects a version it does not know', () => {
    expect(() => parseSnapshot({ ...valid(), version: 2 })).toThrow('Unsupported snapshot version');
  });

  it('rejects a file without strokes', () => {
    expect(() => parseSnapshot({ ...valid(), strokes: undefined })).toThrow('no strokes');
  });

  it.each([
    ['points that are not numbers', { points: [1, 'two', 3] }],
    ['an incomplete point', { points: [1, 2, 0.5, 4] }],
    ['no points', { points: [] }],
    ['a coordinate that is not finite', { points: [1, null, 0.5] }],
    ['no pen width', { width: 0 }],
  ])('rejects a stroke with %s', (_name, damage) => {
    const file = valid();
    const strokes = file.strokes as Array<Record<string, unknown>>;
    strokes[1] = { ...strokes[1], ...damage };
    expect(() => parseSnapshot(file)).toThrow('Stroke 1 of the snapshot is malformed');
  });

  it('accepts a file with no note and no readings', () => {
    const file = valid();
    delete file.note;
    delete file.equations;
    const snapshot = parseSnapshot(file);
    expect(snapshot.note).toBe('');
    expect(snapshot.equations).toEqual([]);
    expect(restoreStrokes(snapshot).length).toBeGreaterThan(0);
  });
});
