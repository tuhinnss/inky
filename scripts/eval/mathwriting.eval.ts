/**
 * Measures recognition of operators, and of whole expressions, on real handwriting.
 * Not part of `npm test`: it needs data that is not in the repository. Run with
 * `npm run eval:operators`; see README.md in this folder.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { evaluatePage, readEquation, type Equation } from '../../src/app/equations';
import { isScribble } from '../../src/ink';
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
      // Inks with the letters x and y are measured on their own, in sections 4 and 5.
      const hasX = (ink: { label: string }): boolean => ink.label.includes('x');
      const hasY = (ink: { label: string }): boolean => ink.label.includes('y');
      const hasLetter = (ink: { label: string }): boolean => hasX(ink) || hasY(ink);
      const symbols = inks.filter((ink) => ink.kind === 'symbol' && !hasLetter(ink));
      const expressions = inks.filter((ink) => ink.kind === 'expression' && !hasLetter(ink));
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

      // 4. The variable x. The model has no letters, so an x is right when the model reads
      // it as "×": where a number belongs, or with nothing after it to multiply as in 3x,
      // that is read as x.
      const loneX = inks.filter((ink) => ink.kind === 'symbol' && ink.label === 'x');
      const xLines = loneX
        .map((ink) => segmentLine(toStrokes(ink, SIZE, PEN)))
        .filter((line) => line.symbols.length === 1);
      await classifyAll(
        xLines.map((line) => line.symbols[0]),
        cache,
      );
      const loneRead = xLines.filter(
        (line) => interpret(line.symbols[0], line, cache.get(line.symbols[0].key)).symbol === '×',
      ).length;
      const xExpressions = inks.filter(
        (ink) => ink.kind === 'expression' && hasX(ink) && !hasY(ink),
      );
      /** "3x" or "xx": x multiplied with no sign, read since graphs came in. */
      const implied = (label: string): boolean => /[\d.x]x/.test(label);
      const xPages = xExpressions.map((ink) => layoutPage(toStrokes(ink, SIZE, PEN)));
      await classifyAll(
        xPages
          .flatMap((lines) => lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
        cache,
      );
      const xExact = { plain: 0, implied: 0 };
      const xCount = { plain: 0, implied: 0 };
      let xSeen = 0;
      let xRead = 0;
      const xExamples: string[] = [];
      xExpressions.forEach((ink, i) => {
        const kind = implied(ink.label) ? 'implied' : 'plain';
        xCount[kind]++;
        const lines = xPages[i];
        if (lines.length !== 1) return;
        const read = readEquation({ id: i, version: 1, line: lines[0] }, cache).expression;
        if (read === ink.label) xExact[kind]++;
        else if (xExamples.length < 12) xExamples.push(`  ${ink.label.padEnd(22)} read as ${read}`);
        if (read.length !== ink.label.length) return;
        [...ink.label].forEach((written, k) => {
          if (written !== 'x') return;
          xSeen++;
          if (read[k] === 'x') xRead++;
        });
      });

      // 5. Graphs. A y is read by its place, not its shape: the first symbol of `y = …`, with
      // x after the "=" and no "=" at the end. Real `y = …` lines are few, so each real y
      // written on its own is also set in place of the y of each real one read right.
      const loneY = inks.filter((ink) => ink.label === 'y');
      const yGlyphs = loneY.map((ink) => toStrokes({ ...ink, kind: 'symbol' }, SIZE, PEN));
      const yLines = yGlyphs.map((strokes) => segmentLine(strokes));
      await classifyAll(
        yLines.filter((line) => line.symbols.length === 1).map((line) => line.symbols[0]),
        cache,
      );
      const yAsTimes = yLines.filter(
        (line) =>
          line.symbols.length === 1 &&
          interpret(line.symbols[0], line, cache.get(line.symbols[0].key)).symbol === '×',
      ).length;
      const isGraphLabel = (label: string): boolean =>
        label.startsWith('y=') && label.slice(2).includes('x') && !label.slice(2).includes('=');
      const graphInks = inks.filter((ink) => ink.kind === 'expression' && isGraphLabel(ink.label));
      /** The line read on a page of its own, with x and y read as the page would. */
      const readPage = (lines: ReturnType<typeof layoutPage>): Equation | null =>
        lines.length === 1
          ? evaluatePage([readEquation({ id: 0, version: 1, line: lines[0] }, cache)])[0]
          : null;
      const isGraphOf = (equation: Equation | null, label: string): boolean =>
        equation?.expression === label && equation.graph?.body === label.slice(2);
      const graphPages = graphInks.map((ink) => layoutPage(toStrokes(ink, SIZE, PEN)));
      await classifyAll(
        graphPages
          .flatMap((lines) => lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
        cache,
      );
      const graphRead = graphInks.filter((ink, i) => isGraphOf(readPage(graphPages[i]), ink.label));
      const yTrials: Array<{ label: string; lines: ReturnType<typeof layoutPage> }> = [];
      graphRead.forEach((ink) => {
        const [line] = layoutPage(toStrokes(ink, SIZE, PEN));
        const [y, ...rest] = line.symbols;
        const kept = rest.flatMap((symbol) => symbol.strokes);
        for (const glyph of yGlyphs) {
          yTrials.push({
            label: ink.label,
            lines: layoutPage([...transplant(glyph, y.bounds), ...kept]),
          });
        }
      });
      await classifyAll(
        yTrials
          .flatMap((t) => t.lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
        cache,
      );
      const yTrialsRead = yTrials.filter((t) => isGraphOf(readPage(t.lines), t.label)).length;
      // And no line that is not a graph's should be taken for one.
      const notGraphs = inks.filter((ink) => ink.kind === 'expression' && !isGraphLabel(ink.label));
      const notGraphPages = notGraphs.map((ink) => layoutPage(toStrokes(ink, SIZE, PEN)));
      await classifyAll(
        notGraphPages
          .flatMap((lines) => lines.flatMap((line) => line.symbols))
          .filter((s) => s.kind === 'shape'),
        cache,
      );
      const falseGraphs: string[] = [];
      notGraphs.forEach((ink, i) => {
        const read = readPage(notGraphPages[i]);
        if (read?.graph) falseGraphs.push(`  ${ink.label.padEnd(22)} read as ${read.expression}`);
      });

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
        '',
        `The variable x: ${loneX.length} written on their own, ${xExpressions.length} expressions using it`,
        `  a lone x read as "×", which is x at the start of a line: ${loneRead}/${loneX.length} = ${pct(loneRead, loneX.length)}`,
        `  expressions read exactly right: ${xExact.plain + xExact.implied}/${xExpressions.length} = ${pct(xExact.plain + xExact.implied, xExpressions.length)}`,
        `    without "3x" for 3 × x: ${xExact.plain}/${xCount.plain} = ${pct(xExact.plain, xCount.plain)}`,
        `    with it:                ${xExact.implied}/${xCount.implied} = ${pct(xExact.implied, xCount.implied)}`,
        `  each x read as x, in those grouped right: ${xRead}/${xSeen} = ${pct(xRead, xSeen)}`,
        ...xExamples,
        '',
        `Graphs, y = …: ${loneY.length} y written on their own, ${graphInks.length} real lines y = … using x`,
        `  a lone y read as "×", taken for x unless x has no value above: ${yAsTimes}/${loneY.length} = ${pct(yAsTimes, loneY.length)}`,
        `  real lines read as the right graph: ${graphRead.length}/${graphInks.length}`,
        `  each lone y set at the start of those: ${yTrialsRead}/${yTrials.length} = ${pct(yTrialsRead, yTrials.length)} read as the right graph`,
        `  other expressions taken for a graph: ${falseGraphs.length} of ${notGraphs.length}`,
        ...falseGraphs.slice(0, 10),
      );

      // Writing must never be taken for a scribble, which would rub out what is under it.
      const strokes = inks.flatMap((ink) => toStrokes(ink, SIZE, PEN));
      const scribbles = strokes.filter((stroke) => isScribble(stroke.points)).length;
      report.push(
        '',
        `Strokes taken for a scratch-out scribble: ${scribbles} of ${strokes.length}`,
      );

      const text = report.join('\n');
      console.log(text);
      if (process.env.EVAL_REPORT) await writeFile(process.env.EVAL_REPORT, text + '\n');
      expect(expressions.length + symbols.length).toBeGreaterThan(0);
    });
  },
);
