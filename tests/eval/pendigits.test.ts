import { describe, expect, it } from 'vitest';
import { parsePendigits, scaleToSize } from '../../scripts/eval/pendigits';

const FILE = `
.INCLUDE        dene.doc

.LEXICON "0" "1" "2" "3" "4" "5" "6" "7" "8" "9"
.HIERARCHY      DIGIT

.SEGMENT DIGIT    0 ? "7"
.COMMENT 8  6  138
.PEN_DOWN
 100  400
 300  400
 200  100
.PEN_UP
.DT 100
.SEGMENT DIGIT    1 ? "4"
.COMMENT 1  2  3
.PEN_DOWN
 150  450
 100  250
 350  250
.PEN_UP
.DT 100
.PEN_DOWN
 300  450
 300   50
.PEN_UP
.DT 100
`;

describe('reading the pen digits files', () => {
  it('finds each sample and its label', () => {
    expect(parsePendigits(FILE).map((sample) => sample.label)).toEqual(['7', '4']);
  });

  it('keeps the strokes of a sample apart, in writing order', () => {
    const [seven, four] = parsePendigits(FILE);
    expect(seven.strokes.map((stroke) => stroke.length)).toEqual([3]);
    expect(four.strokes.map((stroke) => stroke.length)).toEqual([3, 2]);
  });

  it('turns the tablet upside up: y counts down the page', () => {
    const [seven] = parsePendigits(FILE);
    // The bar of the 7 is at the top of the tablet (y = 400), so near the top of the page.
    expect(seven.strokes[0][0]).toEqual({ x: 100, y: 100 });
    expect(seven.strokes[0][2]).toEqual({ x: 200, y: 400 });
  });

  it('accepts Windows line endings', () => {
    const samples = parsePendigits(FILE.replace(/\n/g, '\r\n'));
    expect(samples.map((sample) => sample.label)).toEqual(['7', '4']);
    expect(samples[1].strokes[1]).toHaveLength(2);
  });

  it('drops a sample that has no points', () => {
    const empty = '.SEGMENT DIGIT 0 ? "3"\n.PEN_DOWN\n.PEN_UP\n';
    expect(parsePendigits(empty + FILE)).toHaveLength(2);
  });

  it('gives nothing for a file that is something else', () => {
    expect(parsePendigits('hello\n1 2\n3 4\n')).toEqual([]);
    expect(parsePendigits('')).toEqual([]);
  });
});

describe('scaling a sample to a writing size', () => {
  it('makes the longer side the requested size and keeps the proportions', () => {
    const [seven] = parsePendigits(FILE);
    const points = scaleToSize(seven, 60).flat();
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(60); // 300 units tall
    expect(Math.max(...xs)).toBeCloseTo(40); // 200 units wide
  });

  it('copes with a sample that is a single point', () => {
    const dot = { label: '1', strokes: [[{ x: 250, y: 250 }]] };
    expect(scaleToSize(dot, 80)).toEqual([[{ x: 0, y: 0 }]]);
  });
});
