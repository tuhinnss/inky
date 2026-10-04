/**
 * Measures recognition of operators, and of whole expressions, on real handwriting.
 * Not part of `npm test`: it needs data that is not in the repository. Run with
 * `npm run eval:operators`; see README.md in this folder.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readEquation } from '../../src/app/equations';
import { layoutPage, segmentLine, type SymbolGroup } from '../../src/layout';
import { interpret } from '../../src/recognition/interpret';
import { classify } from '../../tests/recognition/helpers';
import { SYMBOL_CLASSES, parseRecords, toStrokes, transplant } from './mathwriting';

const FILE = process.env.MATHWRITING_FILE ?? 'data/mathwriting/arithmetic.jsonl';
/** Height the writing is brought to, and the pen, as in ordinary use of the app. */
const SIZE = Number(process.env.EVAL_SIZE ?? 80);
const PEN = Number(process.env.EVAL_PEN ?? 4);
const BATCH = 256;

const pct = (a: number, b: number): string =>
  b === 0 ? '   -  ' : `${((100 * a) / b).toFixed(1)}%`;

interface Tally {
  n: number;
  right: number;
}

function tally(map: Map<string, Tally>, key: string, right: boolean): void {
  const row = map.get(key) ?? { n: 0, right: 0 };
  row.n++;
  if (right) row.right++;
  map.set(key, row);
}

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Probabilities for every symbol, by key, classified in batches as the worker would. */
async function classifyAll(
  symbols: SymbolGroup[],
  cache = new Map<string, Float32Array>(),
): Promise<Map<string, Float32Array>> {
  const unique = [
    ...new Map(symbols.filter((s) => !cache.has(s.key)).map((s) => [s.key, s.strokes] as const)),
  ];
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const predictions = await classify(batch.map(([, strokes]) => strokes));
    batch.forEach(([key], j) => cache.set(key, predictions[j].probabilities));
  }
  return cache;
}

describe.skipIf(!existsSync(FILE))(
  'real handwritten operators and expressions (MathWriting)',
  () => {
    it('reads them', { timeout: 1_800_000 }, async () => {
      const inks = parseRecords(await readFile(FILE, 'utf8'));
      const symbols = inks.filter((ink) => ink.kind === 'symbol');
      const expressions = inks.filter((ink) => ink.kind === 'expression');
      const report: string[] = [
        `${FILE}: ${expressions.length} expressions and ${symbols.length} single symbols,`,
        `written at ${SIZE} px with a ${PEN} px pen. None of these writers' inks were used to`,
        'train any of the bundled models.',
        '',
      ];

      // 1. Single symbols: each taken as a line of one symbol, as a lone sign on the page.
      const symbolLines = symbols.map((ink) => segmentLine(toStrokes(ink, SIZE, PEN)));
      const single = symbolLines.filter((line) => line.symbols.length === 1);
      const singleCache = await classifyAll(single.map((line) => line.symbols[0]));
      const bySymbol = new Map<string, Tally>();
      const symbolConfusion = new Map<string, number>();
      symbols.forEach((ink, i) => {
        const line = symbolLines[i];
        const read =
          line.symbols.length === 1
            ? interpret(line.symbols[0], line, singleCache.get(line.symbols[0].key)).symbol
            : `(${line.symbols.length} pieces)`;
        tally(bySymbol, ink.label, read === ink.label);
        if (read !== ink.label) count(symbolConfusion, `${ink.label}→${read}`);
      });

      // 2. Whole expressions, through the same path as the page: layout, recognition, reading.
      const pages = expressions.map((ink) => layoutPage(toStrokes(ink, SIZE, PEN)));
      const cache = await classifyAll(
        pages
          .flatMap((lines) => lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
      );
      let exact = 0;
      const failures = new Map<string, number>();
      const inContext = new Map<string, Tally>();
      const contextConfusion = new Map<string, number>();
      const examples: string[] = [];
      expressions.forEach((ink, i) => {
        const lines = pages[i];
        if (lines.length !== 1) {
          count(failures, 'split over several lines');
          return;
        }
        const read = readEquation({ id: i, version: 1, line: lines[0] }, cache).expression;
        if (read === ink.label) exact++;
        else if (examples.length < 25) examples.push(`  ${ink.label.padEnd(22)} read as ${read}`);
        if (lines[0].column) {
          count(failures, 'taken for a column sum');
          return;
        }
        if (read.length !== ink.label.length) {
          count(failures, 'symbols grouped differently');
          return;
        }
        // Grouped right: every symbol can be scored on its own, in context.
        [...ink.label].forEach((written, k) => {
          tally(inContext, written, read[k] === written);
          if (read[k] !== written) count(contextConfusion, `${written}→${read[k]}`);
        });
      });

      // 3. "÷" in context. MathWriting's arithmetic has almost none, so each real "÷" from
      // the single symbols is set in place of a "+" or "−" that a writer put between two
      // numbers, in every expression that was read exactly right. All else is the writer's.
      const signs = symbols
        .filter((ink) => ink.label === '÷')
        .map((ink) => toStrokes(ink, SIZE, PEN));
      const trials: Array<{ label: string; lines: ReturnType<typeof layoutPage> }> = [];
      expressions.forEach((ink, i) => {
        const lines = pages[i];
        if (lines.length !== 1 || lines[0].column) return;
        const line = lines[0];
        const read = readEquation({ id: i, version: 1, line }, cache).expression;
        if (read !== ink.label || line.symbols.length !== ink.label.length) return;
        const k = [...ink.label].findIndex(
          (c, j) =>
            (c === '+' || c === '-') &&
            /\d/.test(ink.label[j - 1] ?? '') &&
            /\d/.test(ink.label[j + 1] ?? ''),
        );
        if (k < 0) return;
        const replaced = line.symbols[k];
        const kept = line.symbols.filter((s) => s !== replaced).flatMap((s) => s.strokes);
        const label = ink.label.slice(0, k) + '÷' + ink.label.slice(k + 1);
        for (const sign of signs) {
          trials.push({
            label,
            lines: layoutPage([...kept, ...transplant(sign, replaced.bounds)]),
          });
        }
      });
      await classifyAll(
        trials
          .flatMap((t) => t.lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
        cache,
      );
      let divisionExact = 0;
      let divisionRead = 0;
      const divisionFailures = new Map<string, number>();
      const divisionExamples: string[] = [];
      for (const { label, lines } of trials) {
        if (lines.length !== 1) {
          count(divisionFailures, 'split over several lines');
          continue;
        }
        const read = readEquation({ id: 0, version: 1, line: lines[0] }, cache).expression;
        if (read === label) divisionExact++;
        else if (divisionExamples.length < 15)
          divisionExamples.push(`  ${label.padEnd(22)} read as ${read}`);
        if (read.length !== label.length) {
          count(divisionFailures, 'the ÷ came apart or joined a neighbour');
          continue;
        }
        const k = label.indexOf('÷');
        if (read[k] === '÷') divisionRead++;
        else count(divisionFailures, `÷ read as ${read[k]}`);
      }

      const table = (rows: Map<string, Tally>, heading: string): string[] => {
        const lines = [heading, '  symbol      n   read right'];
        let n = 0;
        let right = 0;
        for (const symbol of SYMBOL_CLASSES) {
          const row = rows.get(symbol);
          if (!row) continue;
          n += row.n;
          right += row.right;
          lines.push(
            `  ${symbol.padEnd(6)} ${String(row.n).padStart(6)}   ${pct(row.right, row.n).padStart(7)}`,
          );
        }
        lines.push(`  all    ${String(n).padStart(6)}   ${pct(right, n).padStart(7)}`);
        return lines;
      };
      const top = (map: Map<string, number>, k = 15): string[] =>
        [...map]
          .sort((a, b) => b[1] - a[1])
          .slice(0, k)
          .map(([pair, n]) => `  ${pair}  ${n}`);

      const grouped = expressions.length - [...failures.values()].reduce((a, b) => a + b, 0);
      report.push(
        ...table(bySymbol, 'Single symbols, each on its own:'),
        '',
        'Most common confusions (written→read):',
        ...top(symbolConfusion),
        '',
        `Whole expressions: ${exact}/${expressions.length} = ${pct(exact, expressions.length)} read exactly right`,
        `  grouped into the right symbols: ${grouped}/${expressions.length} = ${pct(grouped, expressions.length)}`,
        ...[...failures].map(([why, n]) => `  ${why}: ${n}`),
        '',
        ...table(inContext, 'Each symbol, in expressions grouped right:'),
        '',
        'Most common confusions in context (written→read):',
        ...top(contextConfusion),
        '',
        'Some expressions read wrongly:',
        ...examples,
        '',
        `÷ in context: ${signs.length} real "÷" each set in place of a "+" or "−" in ${trials.length / Math.max(signs.length, 1)}`,
        'expressions that were read exactly right:',
        `  ÷ read as ÷:                ${divisionRead}/${trials.length} = ${pct(divisionRead, trials.length)}`,
        `  whole expression read right: ${divisionExact}/${trials.length} = ${pct(divisionExact, trials.length)}`,
        ...top(divisionFailures),
        ...divisionExamples,
      );

      const text = report.join('\n');
      console.log(text);
      if (process.env.EVAL_REPORT) await writeFile(process.env.EVAL_REPORT, text + '\n');
      expect(expressions.length + symbols.length).toBeGreaterThan(0);
    });
  },
);
