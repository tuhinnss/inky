/**
 * Messages between the main thread and the recognition worker.
 *
 * Strokes cross the boundary as four flat typed arrays, not as arrays of objects.
 * Objects would be deep-copied by `postMessage`; a typed array's buffer can instead be
 * *transferred*, which hands the memory over without copying a byte. The sender loses
 * access to it, which is fine: the arrays are built for the message and never reused.
 */

import type { Stroke } from '../ink';
import type { ModelName } from './model';
import type { RasterStroke } from './rasterize';

export interface PackedSymbols {
  /** `x, y` of every point of every stroke of every symbol, back to back. */
  coords: Float32Array;
  /** Number of points in each stroke. */
  strokeLengths: Uint32Array;
  /** Pen width of each stroke. */
  strokeWidths: Float32Array;
  /** Number of strokes in each symbol. */
  symbolStrokeCounts: Uint32Array;
}

export type WorkerRequest =
  | { type: 'init'; modelUrls: Readonly<Record<ModelName, string>> }
  | ({ type: 'classify'; id: number } & PackedSymbols);

export type WorkerResponse =
  | { type: 'ready'; loadMs: number }
  | {
      type: 'result';
      id: number;
      /** `MODEL.classes` probabilities per symbol, back to back. */
      probabilities: Float32Array;
      /** Time spent rasterising and running the model, for the performance readout. */
      elapsedMs: number;
    }
  | { type: 'error'; id?: number; message: string };

export function packSymbols(symbols: ReadonlyArray<readonly Stroke[]>): PackedSymbols {
  let strokeCount = 0;
  let pointCount = 0;
  for (const strokes of symbols) {
    strokeCount += strokes.length;
    for (const stroke of strokes) pointCount += stroke.points.length;
  }

  const packed: PackedSymbols = {
    coords: new Float32Array(pointCount * 2),
    strokeLengths: new Uint32Array(strokeCount),
    strokeWidths: new Float32Array(strokeCount),
    symbolStrokeCounts: new Uint32Array(symbols.length),
  };

  let strokeIndex = 0;
  let coordIndex = 0;
  symbols.forEach((strokes, symbolIndex) => {
    packed.symbolStrokeCounts[symbolIndex] = strokes.length;
    for (const stroke of strokes) {
      packed.strokeLengths[strokeIndex] = stroke.points.length;
      packed.strokeWidths[strokeIndex] = stroke.width;
      strokeIndex++;
      for (const point of stroke.points) {
        packed.coords[coordIndex++] = point.x;
        packed.coords[coordIndex++] = point.y;
      }
    }
  });
  return packed;
}

/** The buffers to hand over with a packed message. */
export function transferables(packed: PackedSymbols): ArrayBuffer[] {
  return [
    packed.coords.buffer as ArrayBuffer,
    packed.strokeLengths.buffer as ArrayBuffer,
    packed.strokeWidths.buffer as ArrayBuffer,
    packed.symbolStrokeCounts.buffer as ArrayBuffer,
  ];
}

/**
 * The reverse of {@link packSymbols}, for the rasteriser. Each stroke's coordinates are
 * a `subarray`, a window onto the packed buffer, so unpacking copies nothing either.
 */
export function unpackSymbols(packed: PackedSymbols): RasterStroke[][] {
  const symbols: RasterStroke[][] = [];
  let strokeIndex = 0;
  let coordIndex = 0;
  for (const strokeCount of packed.symbolStrokeCounts) {
    const strokes: RasterStroke[] = [];
    for (let i = 0; i < strokeCount; i++, strokeIndex++) {
      const length = packed.strokeLengths[strokeIndex] * 2;
      strokes.push({
        coords: packed.coords.subarray(coordIndex, coordIndex + length),
        width: packed.strokeWidths[strokeIndex],
      });
      coordIndex += length;
    }
    symbols.push(strokes);
  }
  return symbols;
}
