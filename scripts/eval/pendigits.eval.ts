/**
 * Measures recognition on real pen-written digits. Not part of `npm test`: it needs a
 * data set that is not in the repository. Run with `npm run eval:digits`.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStroke, isScribble, type Stroke } from '../../src/ink';
import { segmentLine } from '../../src/layout';
import { interpret } from '../../src/recognition/interpret';
import { ascii, classify, classifyAlone, rasterize } from '../../tests/recognition/helpers';
import { parsePendigits, scaleToSize, type PenSample } from './pendigits';

const DIR = process.env.PENDIGITS_DIR ?? 'data/pendigits';
const FILES = { test: 'pendigits-orig.tes', train: 'pendigits-orig.tra' } as const;
const SPLIT = (process.env.PENDIGITS_SPLIT ?? 'test') as keyof typeof FILES;
/** Height the digits are written at, and the pen, as in ordinary use of the app. */
const SIZE = Number(process.env.EVAL_SIZE ?? 80);
const PEN = Number(process.env.EVAL_PEN ?? 4);
const BATCH = 256;

const DIGITS = '0123456789';
const path = join(DIR, FILES[SPLIT]);

function toStrokes(sample: PenSample): Stroke[] {
  return scaleToSize(sample, SIZE).map((points) =>
    createStroke(
      points.map(({ x, y }) => ({ x, y, pressure: 0.5 })),
      PEN,
      '#000',
    ),
  );
}

describe.skipIf(!existsSync(path))(`real pen-written digits (${SPLIT} set)`, () => {
  it('reads them', { timeout: 600_000 }, async () => {
    const samples = parsePendigits(await readFile(path, 'utf8'));
    const inks = samples.map(toStrokes);

    // 1. Recognition as the worker does it, given each digit's strokes as one symbol:
    //    the main model with the digit helpers voting. And, for comparison, the main
    //    model by itself.
    const modelSays: string[] = [];
    const confidence: number[] = [];
    const probabilities: Float32Array[] = [];
    let aloneRight = 0;
    for (let i = 0; i < inks.length; i += BATCH) {
      const batch = inks.slice(i, i + BATCH);
      for (const prediction of await classify(batch)) {
        modelSays.push(prediction.symbol);
        confidence.push(prediction.confidence);
        probabilities.push(prediction.probabilities);
      }
      (await classifyAlone(batch)).forEach((prediction, j) => {
        if (prediction.symbol === samples[i + j].label) aloneRight++;
      });
    }

    // 2. The whole path: layout decides the grouping, geometry weighs in on the reading.
    const split: number[] = [];
    const pathSays = inks.map((strokes, i) => {
      const line = segmentLine(strokes);
      if (line.symbols.length !== 1) {
        split.push(i);
        return '?';
      }
      return interpret(line.symbols[0], line, probabilities[i]).symbol;
    });

    const confusion = new Map<string, number>();
    const perDigit = new Map<string, { n: number; model: number; path: number }>();
    for (const d of DIGITS) perDigit.set(d, { n: 0, model: 0, path: 0 });
    samples.forEach(({ label }, i) => {
      const row = perDigit.get(label)!;
      row.n++;
      if (modelSays[i] === label) row.model++;
      else
        confusion.set(
          `${label}→${modelSays[i]}`,
          (confusion.get(`${label}→${modelSays[i]}`) ?? 0) + 1,
        );
      if (pathSays[i] === label) row.path++;
    });

    const total = samples.length;
    const modelRight = [...perDigit.values()].reduce((sum, row) => sum + row.model, 0);
    const pathRight = [...perDigit.values()].reduce((sum, row) => sum + row.path, 0);
    const pct = (a: number, b: number): string => `${((100 * a) / b).toFixed(2)}%`;

    const lines = [
      `${FILES[SPLIT]}: ${total} digits, written at ${SIZE} px with a ${PEN} px pen`,
      `main model alone:  ${aloneRight}/${total} = ${pct(aloneRight, total)}`,
      `with the helpers:  ${modelRight}/${total} = ${pct(modelRight, total)}`,
      `whole path:        ${pathRight}/${total} = ${pct(pathRight, total)}  (${split.length} digits split into several symbols)`,
      '',
      'digit      n   recognised   whole path',
      ...[...perDigit].map(
        ([d, row]) =>
          `  ${d}    ${String(row.n).padStart(4)}   ${pct(row.model, row.n).padStart(8)}   ${pct(row.path, row.n).padStart(8)}`,
      ),
      '',
      'most common confusions (written→read):',
      ...[...confusion]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([pair, n]) => `  ${pair}  ${n}`),
    ];

    // How well confidence separates right from wrong: what the doubt indicator relies on.
    const wrongConfidence = samples.flatMap((s, i) =>
      modelSays[i] === s.label ? [] : [confidence[i]],
    );
    const rightConfidence = samples.flatMap((s, i) =>
      modelSays[i] === s.label ? [confidence[i]] : [],
    );
    const below = (values: number[], t: number): string =>
      pct(values.filter((v) => v < t).length, Math.max(1, values.length));
    lines.push(
      '',
      `flagged as doubtful (confidence < 0.6): ${below(wrongConfidence, 0.6)} of misreads, ${below(rightConfidence, 0.6)} of correct readings`,
    );

    // Writing must never be taken for a scribble, which would rub out what is under it.
    const strokes = inks.flat();
    const scribbles = strokes.filter((stroke) => isScribble(stroke.points)).length;
    lines.push(`strokes taken for a scratch-out scribble: ${scribbles} of ${strokes.length}`);

    const report = lines.join('\n');
    console.log(`\n${report}\n`);

    if (process.env.EVAL_SHOW) {
      const wanted = process.env.EVAL_SHOW;
      let shown = 0;
      for (let i = 0; i < samples.length && shown < 6; i++) {
        if (`${samples[i].label}→${modelSays[i]}` !== wanted) continue;
        console.log(
          `#${i} ${wanted} (${confidence[i].toFixed(2)}), ${inks[i].length} strokes\n${ascii(rasterize(inks[i]))}`,
        );
        shown++;
      }
    }
    if (process.env.EVAL_OUT) {
      await writeFile(
        process.env.EVAL_OUT,
        JSON.stringify({
          labels: samples.map((s) => s.label),
          modelSays,
          pathSays,
          confidence,
          split,
        }),
      );
    }

    expect(total).toBeGreaterThan(0);
  });
});
