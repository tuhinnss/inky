import { describe, expect, it } from 'vitest';
import { packSymbols, transferables, unpackSymbols } from '../../src/recognition/protocol';
import { ink } from '../fixtures/ink';

describe('packing strokes for the worker', () => {
  const symbols = ink('4÷2=', { size: 80 }).map((symbol) => symbol.strokes);

  it('records the shape of the batch', () => {
    const packed = packSymbols(symbols);
    expect([...packed.symbolStrokeCounts]).toEqual([2, 3, 1, 2]);
    expect(packed.strokeLengths).toHaveLength(8);
    expect(packed.strokeWidths).toHaveLength(8);

    const points = symbols.flat().reduce((sum, stroke) => sum + stroke.points.length, 0);
    expect(packed.coords).toHaveLength(points * 2);
  });

  it('round-trips every coordinate and pen width', () => {
    const unpacked = unpackSymbols(packSymbols(symbols));
    expect(unpacked).toHaveLength(symbols.length);

    symbols.forEach((strokes, s) => {
      expect(unpacked[s]).toHaveLength(strokes.length);
      strokes.forEach((stroke, k) => {
        expect(unpacked[s][k].width).toBe(stroke.width);
        const expected = Float32Array.from(stroke.points.flatMap((p) => [p.x, p.y]));
        expect(unpacked[s][k].coords).toEqual(expected);
      });
    });
  });

  it('unpacks as views onto the packed buffer, not copies', () => {
    const packed = packSymbols(symbols);
    for (const strokes of unpackSymbols(packed)) {
      for (const stroke of strokes) {
        expect((stroke.coords as Float32Array).buffer).toBe(packed.coords.buffer);
      }
    }
  });

  it('lists every buffer for transfer', () => {
    const packed = packSymbols(symbols);
    const buffers = transferables(packed);
    expect(buffers).toHaveLength(4);
    expect(new Set(buffers).size).toBe(4);
    expect(buffers).toContain(packed.coords.buffer);
  });

  it('detaches the buffers when they are transferred, proving nothing was copied', () => {
    const packed = packSymbols(symbols);
    const bytes = packed.coords.byteLength;
    expect(bytes).toBeGreaterThan(0);

    const moved = structuredClone(packed, { transfer: transferables(packed) });

    expect(packed.coords.byteLength).toBe(0); // the sender's view is now empty
    expect(moved.coords.byteLength).toBe(bytes);
    expect(unpackSymbols(moved)).toHaveLength(symbols.length);
  });

  it('handles an empty batch', () => {
    const packed = packSymbols([]);
    expect(packed.coords).toHaveLength(0);
    expect(unpackSymbols(packed)).toEqual([]);
  });
});
