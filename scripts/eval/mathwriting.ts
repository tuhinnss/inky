/**
 * Reading the arithmetic picked out of MathWriting by `prepare_mathwriting.py`.
 */
import { createStroke, strokeBounds, unionBounds, type Bounds, type Stroke } from '../../src/ink';

export interface MathWritingInk {
  id: string;
  split: 'train' | 'valid' | 'test' | 'symbols';
  /** A whole expression, or one symbol cut out of one. */
  kind: 'expression' | 'symbol';
  /** What was written, as CalcInk would write it: "12+7=19", "×". */
  label: string;
  /** Each stroke as x, y, x, y, ... in the writer's own screen coordinates. */
  strokes: number[][];
}

export function parseRecords(text: string): MathWritingInk[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as MathWritingInk);
}

/**
 * The ink as strokes on a CalcInk page. The inks come from many devices and are not
 * scaled alike, so each is brought to the size handwriting has on the page: an
 * expression to `size` tall, a lone symbol to `size` along its longer side (a minus sign
 * has next to no height). It is moved to near the top left of the page.
 */
export function toStrokes(ink: MathWritingInk, size: number, pen: number): Stroke[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of ink.strokes) {
    for (let i = 0; i < stroke.length; i += 2) {
      minX = Math.min(minX, stroke[i]);
      maxX = Math.max(maxX, stroke[i]);
      minY = Math.min(minY, stroke[i + 1]);
      maxY = Math.max(maxY, stroke[i + 1]);
    }
  }
  const extent = ink.kind === 'expression' ? maxY - minY : Math.max(maxX - minX, maxY - minY);
  const scale = size / Math.max(extent, 1e-6);
  return ink.strokes.map((stroke) => {
    const points = [];
    for (let i = 0; i < stroke.length; i += 2) {
      points.push({
        x: 40 + (stroke[i] - minX) * scale,
        y: 40 + (stroke[i + 1] - minY) * scale,
        pressure: 0.5,
      });
    }
    return createStroke(points, pen, '#000');
  });
}

/**
 * One writer's sign put in place of another's: `sign` scaled to the width of `into` and
 * centred on it. "÷" is too rare in MathWriting's arithmetic to measure on its own, so
 * real ones are set into real expressions where the writer put a "+" or "−". Everything
 * around the sign, its size on the line included, is still that writer's.
 */
export function transplant(sign: readonly Stroke[], into: Bounds): Stroke[] {
  if (sign.length === 0) return [];
  const from = sign.map((stroke) => strokeBounds(stroke)).reduce(unionBounds);
  const scale = (into.maxX - into.minX) / Math.max(from.maxX - from.minX, 1e-6);
  const fromX = (from.minX + from.maxX) / 2;
  const fromY = (from.minY + from.maxY) / 2;
  const toX = (into.minX + into.maxX) / 2;
  const toY = (into.minY + into.maxY) / 2;
  return sign.map((stroke) =>
    createStroke(
      stroke.points.map((p) => ({
        ...p,
        x: toX + (p.x - fromX) * scale,
        y: toY + (p.y - fromY) * scale,
      })),
      stroke.width,
      stroke.color,
      stroke.simulatePressure,
    ),
  );
}

/** The kinds of symbol reported on, in the order of the report. */
export const SYMBOL_CLASSES = [
  '+',
  '-',
  '×',
  '÷',
  '=',
  '.',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
] as const;
