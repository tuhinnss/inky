import { describe, expect, it } from 'vitest';
import { createStroke, eraseFromStroke, type Stroke } from '../../src/ink';
import { groupIntoLines, layoutPage, segmentLine, type Line } from '../../src/layout';
import { ink, shuffled, strokesOf, type InkSymbol } from '../fixtures/ink';

/** The stroke ids of each symbol, as sets, in left-to-right order. */
const grouping = (line: Line): number[][] =>
  line.symbols.map((symbol) => symbol.strokes.map((stroke) => stroke.id));
const expected = (symbols: readonly InkSymbol[]): number[][] =>
  symbols.map((symbol) => symbol.strokes.map((stroke) => stroke.id));

describe('splitting a line into symbols', () => {
  it('finds each symbol of the example from the problem statement', () => {
    const written = ink('18+4×3=', { x: 40, y: 60, size: 80 });
    const line = segmentLine(strokesOf(written));

    expect(line.symbols).toHaveLength(7);
    expect(grouping(line)).toEqual(expected(written));
  });

  it('keeps single-stroke digits apart', () => {
    const written = ink('1234567890', { size: 70 });
    const line = segmentLine(strokesOf(written));
    expect(line.symbols.map((symbol) => symbol.strokes.length)).toEqual([
      1, 1, 1, 2, 1, 1, 1, 1, 1, 1,
    ]);
    expect(grouping(line)).toEqual(expected(written));
  });

  it.each([
    ['+', 2],
    ['×', 2],
    ['=', 2],
    ['÷', 3],
    ['4', 2],
  ])('groups the %s strokes of "%s" into one symbol', (char, strokeCount) => {
    const written = ink(`2${char}3`, { size: 80 });
    const line = segmentLine(strokesOf(written));
    expect(line.symbols).toHaveLength(3);
    expect(line.symbols[1].strokes).toHaveLength(strokeCount);
    expect(grouping(line)).toEqual(expected(written));
  });

  it('orders symbols left to right whatever order they were drawn in', () => {
    const written = ink('18+4×3=', { size: 80 });
    const line = segmentLine(shuffled(strokesOf(written)));
    expect(grouping(line)).toEqual(expected(written));
  });

  it('is unaffected by the size of the handwriting', () => {
    for (const size of [24, 48, 80, 160, 320]) {
      const written = ink('7.5÷2-60=', { size });
      expect(grouping(segmentLine(strokesOf(written)))).toEqual(expected(written));
    }
  });

  it('is unaffected by where on the page the line is', () => {
    const written = ink('12+3=', { x: 900, y: 1400, size: 60 });
    expect(grouping(segmentLine(strokesOf(written)))).toEqual(expected(written));
  });

  it('copes with tightly spaced writing', () => {
    const written = ink('18+4×3=', { size: 80, gap: 0.08 });
    expect(grouping(segmentLine(strokesOf(written)))).toEqual(expected(written));
  });

  it('copes with wobbly writing', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const written = ink('96÷8-4×2+7=', { size: 80, wobble: 0.05, seed });
      expect(grouping(segmentLine(strokesOf(written)))).toEqual(expected(written));
    }
  });

  it('gives each symbol a key that identifies its exact strokes', () => {
    const written = ink('1+1=', { size: 80 });
    const line = segmentLine(strokesOf(written));
    const keys = line.symbols.map((symbol) => symbol.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys[1]).toBe(written[1].strokes.map((stroke) => stroke.id).join(','));
  });

  it('reports the bounds of each symbol and of the line', () => {
    const written = ink('1+1', { x: 100, y: 50, size: 80, wobble: 0 });
    const line = segmentLine(strokesOf(written));
    // The fixture smooths its strokes, which rounds corners a few pixels past the box.
    expect(Math.abs(line.bounds.minY - 50)).toBeLessThan(4);
    expect(Math.abs(line.bounds.maxY - 130)).toBeLessThan(4);
    expect(line.symbols[0].bounds.minX).toBeGreaterThanOrEqual(96);
    expect(line.symbols[2].bounds.maxX).toBe(line.bounds.maxX);
  });

  it('measures the line by its digits, not its operators', () => {
    const line = segmentLine(strokesOf(ink('1-1=', { size: 80, wobble: 0 })));
    expect(Math.abs(line.height - 80)).toBeLessThan(4);
  });
});

describe('dots', () => {
  it('treats a decimal point as its own symbol', () => {
    const written = ink('7.5', { size: 80 });
    const line = segmentLine(strokesOf(written));
    expect(line.symbols.map((symbol) => symbol.kind)).toEqual(['shape', 'dot', 'shape']);
    expect(grouping(line)).toEqual(expected(written));
  });

  it('does not swallow a decimal point tucked under the overhang of a 7', () => {
    const [seven] = ink('7', { x: 0, y: 0, size: 80, wobble: 0 });
    // Baseline dot placed inside the 7's horizontal extent, under its top bar.
    const dot = createStroke([{ x: 38, y: 79, pressure: 0.5 }], 4, '#000');
    const line = segmentLine([...seven.strokes, dot]);
    expect(line.symbols).toHaveLength(2);
    expect(line.symbols.find((symbol) => symbol.kind === 'dot')?.strokes).toEqual([dot]);
  });

  it('attaches both dots of a division sign to its bar', () => {
    const written = ink('8÷2', { size: 80 });
    const division = segmentLine(strokesOf(written)).symbols[1];
    expect(division.kind).toBe('shape');
    expect(division.strokes).toHaveLength(3);
  });

  it('does not attach a dot to an equals sign or a plus', () => {
    const written = ink('3=', { size: 80, wobble: 0 });
    const equals = written[1];
    const xs = equals.strokes.flatMap((stroke) => stroke.points.map((p) => p.x));
    const dot = createStroke(
      [{ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 20, pressure: 0.5 }],
      4,
      '#000',
    );
    const line = segmentLine([...strokesOf(written), dot]);
    expect(line.symbols.filter((symbol) => symbol.kind === 'dot')).toHaveLength(1);
    expect(line.symbols.find((symbol) => symbol.strokes.length === 2)?.strokes).toEqual(
      equals.strokes,
    );
  });

  it('keeps a minus sign and a decimal point beside it separate', () => {
    const written = ink('-.5', { size: 80 });
    const line = segmentLine(strokesOf(written));
    expect(grouping(line)).toEqual(expected(written));
  });
});

describe('grouping strokes into lines', () => {
  it('separates two equations written one above the other', () => {
    const first = ink('18+4×3=', { x: 40, y: 60, size: 80 });
    const second = ink('7.5÷2-60=', { x: 40, y: 220, size: 80, seed: 2 });
    const lines = layoutPage([...strokesOf(first), ...strokesOf(second)]);

    expect(lines).toHaveLength(2);
    expect(grouping(lines[0])).toEqual(expected(first));
    expect(grouping(lines[1])).toEqual(expected(second));
  });

  it('returns lines top to bottom whatever order they were written in', () => {
    const top = ink('1+1=', { y: 50, size: 60 });
    const middle = ink('2+2=', { y: 200, size: 60 });
    const bottom = ink('3+3=', { y: 350, size: 60 });
    const lines = layoutPage(
      shuffled([...strokesOf(bottom), ...strokesOf(top), ...strokesOf(middle)]),
    );
    expect(lines.map(grouping)).toEqual([top, middle, bottom].map(expected));
  });

  it('separates lines that are close together', () => {
    // Only a third of a digit-height of clear space between the lines.
    const first = ink('12+34=', { y: 0, size: 60 });
    const second = ink('56-78=', { y: 80, size: 60 });
    expect(layoutPage([...strokesOf(first), ...strokesOf(second)])).toHaveLength(2);
  });

  it('separates two equations written side by side on the same row', () => {
    const left = ink('1+2=', { x: 0, y: 100, size: 60 });
    const right = ink('3+4=', { x: 500, y: 100, size: 60 });
    const lines = layoutPage([...strokesOf(left), ...strokesOf(right)]);
    expect(lines).toHaveLength(2);
    expect(lines.map(grouping)).toEqual([left, right].map(expected));
  });

  it('keeps one equation together across generous spacing', () => {
    const written = ink('1 + 2 = ', { size: 60, gap: 0.5 });
    expect(layoutPage(strokesOf(written))).toHaveLength(1);
  });

  it('follows a line that drifts down the page', () => {
    // Each symbol sits 12% of a digit-height lower than the one before it.
    const symbols = '12345678'
      .split('')
      .map((char, i) => ink(char, { x: i * 60, y: i * 10, size: 80 })[0]);
    const lines = layoutPage(strokesOf(symbols));
    expect(lines).toHaveLength(1);
    expect(lines[0].symbols).toHaveLength(8);
  });

  it('keeps the bars of an equals sign with their line', () => {
    const written = ink('9-4=', { size: 80 });
    const lines = layoutPage(shuffled(strokesOf(written)));
    expect(lines).toHaveLength(1);
    expect(grouping(lines[0])).toEqual(expected(written));
  });

  it('groups an equals sign written on its own', () => {
    const lines = layoutPage(strokesOf(ink('=', { size: 80 })));
    expect(lines).toHaveLength(1);
    expect(lines[0].symbols).toHaveLength(1);
  });

  it('gives the same result regardless of drawing order', () => {
    const page = [
      ...strokesOf(ink('18+4×3=', { y: 40, size: 70 })),
      ...strokesOf(ink('7.5÷2-60=', { y: 200, size: 70, seed: 3 })),
    ];
    const reference = layoutPage(page).map(grouping);
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(layoutPage(shuffled(page, seed)).map(grouping)).toEqual(reference);
    }
  });

  it('handles an empty page and a single stroke', () => {
    expect(layoutPage([])).toEqual([]);
    const lines = layoutPage(strokesOf(ink('7')));
    expect(lines).toHaveLength(1);
    expect(lines[0].symbols).toHaveLength(1);
  });

  it('scales: line grouping is unaffected by handwriting size', () => {
    for (const size of [24, 60, 200]) {
      const first = ink('12+3=', { y: 0, size });
      const second = ink('45-6=', { y: size * 2, size });
      expect(groupIntoLines([...strokesOf(first), ...strokesOf(second)])).toHaveLength(2);
    }
  });
});

describe('layout after editing', () => {
  it('drops a symbol when its strokes are erased', () => {
    const written = ink('18+4×3=', { size: 80 });
    const withoutFour = written.filter((symbol) => symbol.char !== '4');
    const line = segmentLine(strokesOf(withoutFour));
    expect(grouping(line)).toEqual(expected(withoutFour));
  });

  it('gives a pixel-erased symbol a new key, so stale recognition cannot be reused', () => {
    const written = ink('8', { x: 0, y: 0, size: 80, wobble: 0 });
    const before = segmentLine(strokesOf(written)).symbols[0];

    // Rub out the top loop of the 8.
    const fragments: Stroke[] = eraseFromStroke(
      before.strokes[0],
      { x: 0, y: 12 },
      { x: 60, y: 12 },
      14,
    )!;
    expect(fragments.length).toBeGreaterThan(0);
    const after = segmentLine(fragments).symbols[0];

    expect(after.key).not.toBe(before.key);
  });

  it('keeps the keys of symbols that were not touched', () => {
    const written = ink('12+3=', { size: 80 });
    const before = segmentLine(strokesOf(written));
    const extra = ink('4', { x: 600, size: 80 });
    const after = segmentLine([...strokesOf(written), ...strokesOf(extra)]);

    expect(after.symbols.slice(0, 5).map((symbol) => symbol.key)).toEqual(
      before.symbols.map((symbol) => symbol.key),
    );
  });
});
