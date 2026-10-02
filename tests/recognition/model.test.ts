/**
 * End-to-end check of the recognition path with the real models: vector strokes are
 * rasterised by our code and classified by the bundled ONNX files, under the same WASM
 * runtime the browser uses and through the same function the worker calls. If the
 * rasteriser drifted away from what a model was trained on, this is where it would show.
 */
import { describe, expect, it } from 'vitest';
import { createStroke, type Stroke } from '../../src/ink';
import { MODEL_SYMBOLS } from '../../src/recognition/model';
import { PEN_SIZE } from '../../src/ui/sizes';
import { ink } from '../fixtures/ink';
import { REAL_DIGITS, type RealDigit } from '../fixtures/realDigits';
import { ascii, classify, classifyAlone, rasterize } from './helpers';

const ALL = MODEL_SYMBOLS.join('');

/** Classifies every model symbol under the given writing conditions; returns the misses. */
async function misses(options: Parameters<typeof ink>[1]): Promise<string[]> {
  const written = ink(ALL, options);
  const predictions = await classify(written.map((symbol) => symbol.strokes));
  return written
    .map((symbol, i) => ({ expected: symbol.char, got: predictions[i].symbol }))
    .filter(({ expected, got }) => expected !== got)
    .map(({ expected, got }) => `${expected}→${got}`);
}

describe('bundled model on our rasteriser', () => {
  it.each([...MODEL_SYMBOLS])('recognises a handwritten "%s"', async (symbol) => {
    const [written] = ink(symbol, { size: 80, wobble: 0 });
    const [prediction] = await classify([written.strokes]);
    expect(prediction.symbol, `\n${ascii(rasterize(written.strokes))}`).toBe(symbol);
    expect(prediction.confidence).toBeGreaterThan(0.5);
  });

  it('reads every symbol of a whole expression', async () => {
    const written = ink('18+4×3=', { size: 80 });
    const predictions = await classify(written.map((symbol) => symbol.strokes));
    expect(predictions.map((prediction) => prediction.symbol).join('')).toBe('18+4×3=');
  });

  it.each([24, 40, 80, 160, 320])('is unaffected by handwriting size (%i px)', async (size) => {
    expect(await misses({ size, wobble: 0 })).toEqual([]);
  });

  // The ends and the middle of the range the size slider offers.
  it.each([PEN_SIZE.min, 2.5, PEN_SIZE.initial, 6, 9, PEN_SIZE.max])(
    'is unaffected by the pen width setting (%s px)',
    async (penWidth) => {
      expect(await misses({ size: 80, wobble: 0, penWidth })).toEqual([]);
    },
  );

  it('gives the same answer wherever on the page the symbol is', async () => {
    const [near] = ink('7', { x: 0, y: 0, size: 80, wobble: 0 });
    const [far] = ink('7', { x: 3000, y: 5000, size: 80, wobble: 0 });
    const [a, b] = await classify([near.strokes, far.strokes]);
    expect(b.symbol).toBe(a.symbol);
    expect(b.confidence).toBeCloseTo(a.confidence, 3);
  });

  it('tolerates unsteady handwriting', async () => {
    // 10 writers × 15 symbols, each with random wobble of 3% of the digit height.
    let wrong: string[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      wrong = wrong.concat(await misses({ size: 80, wobble: 0.03, seed }));
    }
    expect(wrong.length, `misread: ${wrong.join(' ')}`).toBeLessThanOrEqual(7); // ≥ 95%
  });

  it('returns a probability distribution per symbol', async () => {
    const written = ink('3+4', { size: 80 });
    const predictions = await classify(written.map((symbol) => symbol.strokes));
    for (const { probabilities } of predictions) {
      expect(probabilities).toHaveLength(MODEL_SYMBOLS.length);
      expect(probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 4);
    }
  });
});

describe('the digit helpers', () => {
  /** A real digit as strokes, written at the given height. */
  const strokesOf = ({ strokes }: RealDigit, size = 80): Stroke[] =>
    strokes.map((flat) => {
      const points = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        points.push({ x: (flat[i] * size) / 80, y: (flat[i + 1] * size) / 80, pressure: 0.5 });
      }
      return createStroke(points, 4, '#000');
    });

  it.each(REAL_DIGITS.map((real) => [real.digit, real.aloneReads, real] as const))(
    'read a real "%s" that the main model alone takes for "%s"',
    async (digit, aloneReads, real) => {
      const [alone] = await classifyAlone([strokesOf(real)]);
      const [voted] = await classify([strokesOf(real)]);
      expect(alone.symbol).toBe(aloneReads); // the fixture still shows what it is meant to
      expect(voted.symbol).toBe(digit);
    },
  );

  it('read the one-stroke 4 at any handwriting size', async () => {
    const four = REAL_DIGITS.find((real) => real.digit === '4')!;
    const predictions = await classify([24, 40, 80, 160, 320].map((size) => strokesOf(four, size)));
    expect(predictions.map((prediction) => prediction.symbol)).toEqual(['4', '4', '4', '4', '4']);
  });

  it('leave an operator exactly as the main model read it', async () => {
    const written = ink('+÷=×-', { size: 80, wobble: 0 }).map((symbol) => symbol.strokes);
    const alone = await classifyAlone(written);
    const voted = await classify(written);
    voted.forEach((prediction, i) => {
      expect(prediction.symbol).toBe(alone[i].symbol);
      // The operator probabilities are untouched: not one bit of them changes.
      for (let c = 10; c < MODEL_SYMBOLS.length; c++) {
        expect(prediction.probabilities[c]).toBe(alone[i].probabilities[c]);
      }
    });
  });

  it('never change how likely a symbol is to be a digit at all', async () => {
    const written = ink('4+9=', { size: 80, wobble: 0.03, seed: 4 }).map((s) => s.strokes);
    const alone = await classifyAlone(written);
    const voted = await classify(written);
    const digits = (p: Float32Array): number => p.subarray(0, 10).reduce((sum, v) => sum + v, 0);
    voted.forEach((prediction, i) => {
      expect(digits(prediction.probabilities)).toBeCloseTo(digits(alone[i].probabilities), 5);
    });
  });

  it('give the same answers for a batch as for its symbols one at a time', async () => {
    const batch = REAL_DIGITS.slice(0, 4).map((real) => strokesOf(real));
    const together = await classify(batch);
    for (const [i, strokes] of batch.entries()) {
      const [single] = await classify([strokes]);
      expect(single.symbol).toBe(together[i].symbol);
      expect(single.confidence).toBeCloseTo(together[i].confidence, 4);
    }
  });
});
