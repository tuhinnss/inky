import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEquation, type Equation } from '../../src/app/equations';
import type { CanvasLayer } from '../../src/canvas/CanvasLayer';
import { layoutPage, segmentLine } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import {
  AnswerOverlay,
  answerOpacity,
  answerText,
  LOW_CONFIDENCE,
} from '../../src/ui/AnswerOverlay';
import { ink, inkColumn, strokesOf } from '../fixtures/ink';

/** An equation as the pipeline would hand it over, read with the given confidence. */
function equation(text: string, confidence = 1, x = 40): Equation {
  const written = ink(text, { size: 80, x, y: 100 });
  const line = segmentLine(strokesOf(written));
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    if (symbol.kind !== 'shape') return;
    const char = written[i].char as ModelSymbol;
    cache.set(
      symbol.key,
      Float32Array.from(MODEL_SYMBOLS, (s) => (s === char ? 1 : 0)),
    );
  });
  return { ...readEquation({ id: 1, version: 1, line }, cache), confidence };
}

interface Drawn {
  text: string;
  /** Left and right edge of the text, by the fake context's simple metrics. */
  left: number;
  right: number;
  /** Where the text was put vertically, as given to fillText. */
  y: number;
  /** The clip in force when the text was drawn. */
  clip: { left: number; right: number } | undefined;
}

/** Every glyph is half an em wide. Enough to check that what is drawn fits where it goes. */
const widthOf = (text: string, font: string): number =>
  text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);

/** A canvas context that records text and the clip it was drawn under. */
function fakeLayer(width: number) {
  const drawn: Drawn[] = [];
  const clips: Array<Drawn['clip']> = [undefined];
  let pending: Drawn['clip'];

  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'left',
    textBaseline: 'middle',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: () => clips.push(clips[clips.length - 1]),
    restore: () => clips.pop(),
    beginPath: () => (pending = undefined),
    rect: (x: number, _y: number, w: number) => (pending = { left: x, right: x + w }),
    clip: () => (clips[clips.length - 1] = pending),
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
    measureText: (text: string) => ({ width: widthOf(text, ctx.font) }),
    fillText: (text: string, x: number, y: number) => {
      const w = widthOf(text, ctx.font);
      const left = ctx.textAlign === 'center' ? x - w / 2 : x;
      drawn.push({ text, left, right: left + w, y, clip: clips[clips.length - 1] });
    },
  };

  const layer = { ctx, width, height: 600, clear: () => (drawn.length = 0) };
  return { layer: layer as unknown as CanvasLayer, drawn };
}

function show(equations: Equation[], pageWidth = 1200): Drawn[] {
  const { layer, drawn } = fakeLayer(pageWidth);
  const overlay = new AnswerOverlay(layer);
  overlay.setEquations(equations);
  overlay.redraw();
  return [...drawn];
}

beforeEach(() => {
  // Reduced motion draws answers complete, so one draw shows the finished state.
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe('what is pencilled in after the "="', () => {
  it('is the value of a sum that works out', () => {
    expect(answerText(equation('18+4×3='))).toBe('30');
  });

  it('is Undefined for a division by zero', () => {
    expect(answerText(equation('9÷0='))).toBe('Undefined');
  });

  it('is a question mark for a malformed sum', () => {
    expect(answerText(equation('3++2='))).toBe('?');
  });

  it('is nothing before the "=" is written', () => {
    expect(answerText(equation('18+4×3'))).toBeNull();
  });

  it('is nothing for a bare "="', () => {
    expect(answerText(equation('='))).toBeNull();
  });
});

describe('how dark an answer is drawn', () => {
  it('is firm for a sure reading and faint for a doubtful one', () => {
    expect(answerOpacity(1)).toBeCloseTo(0.95);
    expect(answerOpacity(0.2)).toBeCloseTo(0.42);
  });

  it('never gets darker as confidence falls', () => {
    for (let c = 1; c > 0; c -= 0.05) {
      expect(answerOpacity(c - 0.05)).toBeLessThanOrEqual(answerOpacity(c));
    }
  });
});

describe('drawing an answer', () => {
  it('writes the answer to the right of the "="', () => {
    const sum = equation('18+4×3=');
    const [answer] = show([sum]).filter((d) => d.text === '30');
    expect(answer.left).toBeGreaterThan(sum.line.bounds.maxX);
  });

  it('adds no question mark to an answer it is sure of', () => {
    expect(show([equation('18+4×3=', 0.95)]).map((d) => d.text)).toEqual(['30']);
  });

  it('marks a doubtful answer with a question mark after it', () => {
    const drawn = show([equation('18+4×3=', LOW_CONFIDENCE - 0.1)]);
    const answer = drawn.find((d) => d.text === '30');
    const mark = drawn.find((d) => d.text === '?');
    expect(mark?.left).toBeGreaterThan(answer?.right ?? Infinity);
  });

  // The write-on animation reveals the answer through a clip. A mark outside that clip
  // shows as a stray speck beside the answer, or not at all.
  it('reveals the whole question mark, not a sliver of it', () => {
    const mark = show([equation('18+4×3=', LOW_CONFIDENCE - 0.1)]).find((d) => d.text === '?');
    expect(mark?.clip?.left).toBeLessThanOrEqual(mark?.left ?? -Infinity);
    expect(mark?.clip?.right).toBeGreaterThanOrEqual(mark?.right ?? Infinity);
  });

  it('keeps a doubtful answer and its mark on a page with little room left', () => {
    const sum = equation('18+4×3=', LOW_CONFIDENCE - 0.1);
    const pageWidth = sum.line.bounds.maxX + 90;
    for (const piece of show([sum], pageWidth).filter((d) => d.text === '30' || d.text === '?')) {
      expect(piece.right).toBeLessThanOrEqual(pageWidth);
    }
  });
});

describe('drawing the answer of a column sum', () => {
  /** A column read as if every symbol had been recognised with `confidence`. */
  function column(rows: string[], confidence = 1): Equation {
    const written = inkColumn(rows, { right: 400, y: 60, size: 80 });
    const [line] = layoutPage(written.strokes);
    const chars = written.rows.flat().map((symbol) => symbol.char as ModelSymbol);
    const cache = new Map<string, Float32Array>();
    line.symbols.forEach((symbol, i) => {
      if (symbol.kind !== 'shape') return;
      cache.set(
        symbol.key,
        Float32Array.from(MODEL_SYMBOLS, (s) => (s === chars[i] ? 1 : 0)),
      );
    });
    return { ...readEquation({ id: 1, version: 1, line }, cache), confidence };
  }

  it('writes it under the rule', () => {
    const sum = column(['8', '7', '+3']);
    const answer = show([sum]).find((d) => d.text === '18');
    expect(answer?.y).toBeGreaterThan(sum.line.column!.rule.bounds.maxY);
  });

  it('ends it under the last digits of the rows above', () => {
    const sum = column(['125', '+48']);
    const answer = show([sum]).find((d) => d.text === '173');
    const digitsEnd = Math.max(...sum.line.column!.rows.map((row) => row.bounds.maxX));
    expect(answer?.right).toBeCloseTo(digitsEnd, 0);
  });

  it('keeps a long answer on the page', () => {
    const sum = column(['8', '÷0']); // "Undefined" is far wider than the column
    for (const pageWidth of [1200, 430]) {
      const answer = show([sum], pageWidth).find((d) => d.text === 'Undefined');
      expect(answer?.left).toBeGreaterThanOrEqual(0);
      expect(answer?.right).toBeLessThanOrEqual(pageWidth);
    }
  });

  it('reveals the whole answer and its doubt mark', () => {
    const drawn = show([column(['8', '7', '+3'], LOW_CONFIDENCE - 0.1)]);
    for (const piece of drawn.filter((d) => d.text === '18' || d.text === '?')) {
      expect(piece.clip?.left).toBeLessThanOrEqual(piece.left);
      expect(piece.clip?.right).toBeGreaterThanOrEqual(piece.right);
    }
    expect(drawn.some((d) => d.text === '?')).toBe(true);
  });

  it('puts the note about a doubtful digit beside its row, not on the row below', () => {
    const sum = column(['8', '7', '+3']);
    sum.readings[1] = { symbol: '7', confidence: 0.4 };
    const note = show([sum]).find((d) => d.text === '7?');
    const [, second] = sum.line.column!.rows;
    expect(note?.left).toBeGreaterThan(sum.line.bounds.maxX);
    expect(note?.y).toBeGreaterThan(second.bounds.minY);
    expect(note?.y).toBeLessThan(second.bounds.maxY);
  });

  it('writes the reason under a column that makes no sense', () => {
    const sum = column(['8', '++3']);
    const drawn = show([sum]);
    expect(drawn.some((d) => d.text === '?')).toBe(true);
    const note = drawn.find((d) => d.text.includes('needs a number'));
    expect(note?.y).toBeGreaterThan(sum.line.bounds.maxY);
  });
});
