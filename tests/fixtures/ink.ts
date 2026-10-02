import { createStroke, type Stroke } from '../../src/ink';
import { write, type WriteOptions, type WrittenSymbol } from './handwriting';

export interface InkSymbol {
  char: string;
  strokes: Stroke[];
}

function toStrokes(symbol: WrittenSymbol, penWidth: number): InkSymbol {
  return {
    char: symbol.char,
    strokes: symbol.strokes.map((points) =>
      createStroke(
        points.map(({ x, y }) => ({ x, y, pressure: 0.5 })),
        penWidth,
        '#000',
      ),
    ),
  };
}

/** `write()` as real strokes, one entry per symbol. */
export function ink(text: string, options: WriteOptions & { penWidth?: number } = {}): InkSymbol[] {
  return write(text, options).map((symbol) => toStrokes(symbol, options.penWidth ?? 4));
}

export function strokesOf(symbols: readonly InkSymbol[]): Stroke[] {
  return symbols.flatMap((symbol) => symbol.strokes);
}

/** The x at which to carry on writing after `symbols`, leaving a normal gap. */
export function after(symbols: readonly InkSymbol[], gap = 18): number {
  const xs = strokesOf(symbols).flatMap((stroke) => stroke.points.map((point) => point.x));
  return Math.max(...xs) + gap;
}

export function leftEdge(symbols: readonly InkSymbol[]): number {
  return Math.min(...strokesOf(symbols).flatMap((stroke) => stroke.points.map((p) => p.x)));
}

export interface ColumnOptions {
  /** Right edge that every row ends at, as the numbers of a column sum do. */
  right?: number;
  /** Top of the first row. */
  y?: number;
  size?: number;
  /** Space between rows, as a fraction of the digit height. */
  rowGap?: number;
  /** Space between the last row and the rule, as a fraction of the digit height. */
  ruleGap?: number;
  /** How far the rule runs past the widest row on each side, as a fraction of the digit height. */
  overhang?: number;
  /** False leaves the rule out: a column sum that is not finished yet. */
  rule?: boolean;
  wobble?: number;
  seed?: number;
  penWidth?: number;
}

export interface InkColumn {
  /** The symbols of each row, top to bottom. */
  rows: InkSymbol[][];
  /** The line under the last row, if one was asked for. */
  rule: Stroke | undefined;
  /** Everything, in the order it would be written. */
  strokes: Stroke[];
}

/**
 * A sum written as a column: each row right-aligned under the last, then a rule.
 *
 *     inkColumn(['8', '7', '+3'])
 */
export function inkColumn(rows: readonly string[], options: ColumnOptions = {}): InkColumn {
  const {
    right = 400,
    y = 60,
    size = 80,
    rowGap = 0.4,
    ruleGap = 0.2,
    overhang = 0.2,
    rule = true,
    wobble = 0.02,
    seed = 1,
    penWidth = 4,
  } = options;

  const written = rows.map((text, index) => {
    const row = { y: y + index * size * (1 + rowGap), size, wobble, seed: seed + index, penWidth };
    // Write it once to find how wide it comes out, then again ending at `right`.
    const width = after(ink(text, { ...row, x: 0 }), 0);
    return ink(text, { ...row, x: right - width });
  });

  const left = Math.min(...written.map(leftEdge));
  const bottom = y + rows.length * size * (1 + rowGap) - size * rowGap;
  const ruleY = bottom + ruleGap * size;
  const from = left - overhang * size;
  const to = right + overhang * size;
  const line = rule
    ? createStroke(
        Array.from({ length: 21 }, (_, i) => ({
          x: from + ((to - from) * i) / 20,
          y: ruleY + Math.sin(i) * wobble * size * 0.5,
          pressure: 0.5,
        })),
        penWidth,
        '#000',
      )
    : undefined;

  return {
    rows: written,
    rule: line,
    strokes: [...written.flatMap(strokesOf), ...(line ? [line] : [])],
  };
}

/** Deterministic shuffle, to check that results do not depend on drawing order. */
export function shuffled<T>(items: readonly T[], seed = 7): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The same writing with the whole line turned: every symbol rotated with it, as when the
 * page lies at an angle. Positive degrees rise to the right.
 */
export function turned(symbols: readonly InkSymbol[], degrees: number): Stroke[] {
  const strokes = strokesOf(symbols);
  const pivot = { x: leftEdge(symbols), y: strokes[0].points[0].y };
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  return strokes.map((stroke) =>
    createStroke(
      stroke.points.map((p) => ({
        x: pivot.x + (p.x - pivot.x) * cos + (p.y - pivot.y) * sin,
        y: pivot.y - (p.x - pivot.x) * sin + (p.y - pivot.y) * cos,
        pressure: p.pressure,
      })),
      stroke.width,
      stroke.color,
    ),
  );
}

/**
 * The same writing climbing the page: every symbol stays upright and is moved up by the
 * height of a sloped baseline under its middle. Positive degrees rise to the right.
 */
export function climbing(symbols: readonly InkSymbol[], degrees: number): Stroke[] {
  const slope = Math.tan((degrees * Math.PI) / 180);
  const start = leftEdge(symbols);
  return symbols.flatMap((symbol) => {
    const xs = symbol.strokes.flatMap((stroke) => stroke.points.map((p) => p.x));
    const lift = slope * ((Math.min(...xs) + Math.max(...xs)) / 2 - start);
    return symbol.strokes.map((stroke) =>
      createStroke(
        stroke.points.map((p) => ({ x: p.x, y: p.y - lift, pressure: p.pressure })),
        stroke.width,
        stroke.color,
      ),
    );
  });
}
