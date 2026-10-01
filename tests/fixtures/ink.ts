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
