/**
 * End-to-end check of the recognition path with the real model: vector strokes are
 * rasterised by our code and classified by the bundled ONNX file, under the same WASM
 * runtime the browser uses. If the rasteriser drifted away from what the model was
 * trained on, this is where it would show.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_SYMBOLS } from '../../src/recognition/model';
import { PEN_SIZE } from '../../src/ui/sizes';
import { ink } from '../fixtures/ink';
import { ascii, classify, rasterize } from './helpers';

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
