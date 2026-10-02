/**
 * A page of handwriting saved as data: the ink exactly as written, and what was read
 * from it. Pure functions, no DOM.
 *
 * This is how real handwriting gets into the test suite. Someone writes on a tablet,
 * saves the page, and the file can be replayed through layout and recognition on any
 * machine, as many times as needed, giving the same result every time.
 */

import type { Equation } from '../app/equations';
import { createStroke, type Stroke } from '../ink';

export interface StrokeRecord {
  id: number;
  width: number;
  /** False when the device reported real pen pressure. */
  simulatePressure: boolean;
  /** Flat `x, y, pressure` triples. */
  points: number[];
}

export interface SymbolRecord {
  /** Ids of the strokes grouped into this symbol. */
  strokes: number[];
  kind: 'dot' | 'shape';
  read: string;
  confidence: number;
}

export interface EquationRecord {
  expression: string;
  /** What was shown after the "=", or null if nothing was. */
  answer: string | null;
  confidence: number;
  symbols: SymbolRecord[];
}

export interface DeviceInfo {
  userAgent: string;
  width: number;
  height: number;
  pixelRatio: number;
}

export interface PageSnapshot {
  format: 'calcink-page';
  version: 1;
  /** What the writer says the page was meant to say. The ground truth. */
  note: string;
  capturedAt: string;
  device: DeviceInfo;
  strokes: StrokeRecord[];
  equations: EquationRecord[];
}

const round = (value: number, places: number): number => Number(value.toFixed(places));

export function takeSnapshot(
  strokes: readonly Stroke[],
  equations: readonly Equation[],
  details: { note: string; capturedAt: string; device: DeviceInfo },
): PageSnapshot {
  return {
    format: 'calcink-page',
    version: 1,
    ...details,
    strokes: strokes.map((stroke) => ({
      id: stroke.id,
      width: stroke.width,
      simulatePressure: stroke.simulatePressure,
      // A hundredth of a pixel is far finer than any digitiser, and keeps files small.
      points: stroke.points.flatMap((p) => [round(p.x, 2), round(p.y, 2), round(p.pressure, 3)]),
    })),
    equations: equations.map((equation) => ({
      expression: equation.expression,
      answer: answerOf(equation),
      confidence: round(equation.confidence, 3),
      symbols: equation.line.symbols.map((symbol, index) => ({
        strokes: symbol.strokes.map((stroke) => stroke.id),
        kind: symbol.kind,
        read: equation.readings[index]?.symbol ?? '',
        confidence: round(equation.readings[index]?.confidence ?? 0, 3),
      })),
    })),
  };
}

function answerOf({ evaluation }: Equation): string | null {
  if (!evaluation) return null;
  return evaluation.status === 'error' ? `error: ${evaluation.error.code}` : evaluation.text;
}

/**
 * The ink of a snapshot as live strokes, in the order it was written.
 * The strokes get new ids, because ids are only unique within one running app.
 */
export function restoreStrokes(snapshot: PageSnapshot, color = '#1c2b6e'): Stroke[] {
  return [...snapshot.strokes]
    .sort((a, b) => a.id - b.id)
    .map((record) => {
      const points = [];
      for (let i = 0; i + 2 < record.points.length; i += 3) {
        points.push({
          x: record.points[i],
          y: record.points[i + 1],
          pressure: record.points[i + 2],
        });
      }
      return createStroke(points, record.width, color, record.simulatePressure);
    });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));

/**
 * Checks that `value` is a page snapshot and returns it typed. A file from somewhere
 * else, or a damaged one, throws an Error that says what is wrong with it.
 *
 * Only what replaying the ink depends on is checked. The recorded readings are a note
 * of what happened at the time, and a replay computes its own.
 */
export function parseSnapshot(value: unknown): PageSnapshot {
  if (!isRecord(value) || value.format !== 'calcink-page') {
    throw new Error('Not a CalcInk page snapshot');
  }
  if (value.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.strokes)) throw new Error('Snapshot has no strokes');

  value.strokes.forEach((stroke: unknown, index) => {
    const ok =
      isRecord(stroke) &&
      typeof stroke.id === 'number' &&
      typeof stroke.width === 'number' &&
      stroke.width > 0 &&
      typeof stroke.simulatePressure === 'boolean' &&
      isNumbers(stroke.points) &&
      stroke.points.length >= 3 &&
      stroke.points.length % 3 === 0;
    if (!ok) throw new Error(`Stroke ${index} of the snapshot is malformed`);
  });

  return {
    ...(value as unknown as PageSnapshot),
    note: typeof value.note === 'string' ? value.note : '',
    equations: Array.isArray(value.equations) ? (value.equations as EquationRecord[]) : [],
  };
}
