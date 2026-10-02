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

/** A column sum read as if every symbol had been recognised with `confidence`. */
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

interface Text {
  text: string;
  /** Left and right edge of the text, by the fake context's simple metrics. */
  left: number;
  right: number;
  /** Where the text was put vertically, as given to fillText. */
  y: number;
  /** How opaque it was drawn: the alpha of the fill colour. */
  opacity: number;
  /** The clip in force when the text was drawn. */
  clip: { left: number; right: number } | undefined;
}

/** A straight dotted line, as drawn under a doubtful symbol. */
interface Dotted {
  left: number;
  right: number;
  y: number;
}

/** Every glyph is half an em wide. Enough to check that what is drawn fits where it goes. */
const widthOf = (text: string, font: string): number =>
  text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);

/** A canvas context that records the text and the dotted lines drawn on it. */
function fakeLayer(width: number) {
  const texts: Text[] = [];
  const dotted: Dotted[] = [];
  const clips: Array<Text['clip']> = [undefined];
  let pending: Text['clip'];
  let dash: number[] = [];
  let path: Array<{ x: number; y: number }> = [];

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
    restore: () => {
      clips.pop();
      dash = [];
    },
    beginPath: () => {
      pending = undefined;
      path = [];
    },
    rect: (x: number, _y: number, w: number) => (pending = { left: x, right: x + w }),
    clip: () => (clips[clips.length - 1] = pending),
    moveTo: (x: number, y: number) => path.push({ x, y }),
    lineTo: (x: number, y: number) => path.push({ x, y }),
    stroke: () => {
      if (dash.length > 0 && path.length === 2) {
        dotted.push({ left: path[0].x, right: path[1].x, y: path[0].y });
      }
    },
    setLineDash: (segments: number[]) => (dash = segments),
    measureText: (text: string) => ({ width: widthOf(text, ctx.font) }),
    fillText: (text: string, x: number, y: number) => {
      const w = widthOf(text, ctx.font);
      const left = ctx.textAlign === 'center' ? x - w / 2 : x;
      const opacity = Number(/,\s*([\d.]+)\)$/.exec(ctx.fillStyle)?.[1] ?? 1);
      texts.push({ text, left, right: left + w, y, opacity, clip: clips[clips.length - 1] });
    },
  };

  const clear = (): void => {
    texts.length = 0;
    dotted.length = 0;
  };
  return { layer: { ctx, width, height: 600, clear } as unknown as CanvasLayer, texts, dotted };
}

function show(equations: Equation[], pageWidth = 1200): { texts: Text[]; dotted: Dotted[] } {
  const { layer, texts, dotted } = fakeLayer(pageWidth);
  const overlay = new AnswerOverlay(layer);
  overlay.setEquations(equations);
  overlay.redraw();
  return { texts: [...texts], dotted: [...dotted] };
}

/** Makes the symbol at `index` the one the notebook was unsure of. */
function doubting(sum: Equation, index: number): Equation {
  const readings = sum.readings.map((reading, i) =>
    i === index ? { ...reading, confidence: 0.4 } : reading,
  );
  return { ...sum, readings, confidence: 0.4 };
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

  it('is nothing for a sum that does not make sense', () => {
    expect(answerText(equation('3++2='))).toBeNull();
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
    const [answer] = show([sum]).texts;
    expect(answer.text).toBe('30');
    expect(answer.left).toBeGreaterThan(sum.line.bounds.maxX);
  });

  it('writes the answer and nothing else, sure or not', () => {
    expect(show([equation('18+4×3=', 0.95)]).texts.map((t) => t.text)).toEqual(['30']);
    expect(show([doubting(equation('18+4×3='), 2)]).texts.map((t) => t.text)).toEqual(['30']);
  });

  it('writes a doubtful answer more faintly than a sure one', () => {
    const [sure] = show([equation('18+4×3=', 0.95)]).texts;
    const [unsure] = show([equation('18+4×3=', LOW_CONFIDENCE - 0.1)]).texts;
    expect(unsure.opacity).toBeLessThan(sure.opacity);
    expect(unsure.opacity).toBeGreaterThan(0.4); // faint, but there to be read
  });

  it('reveals the whole answer through the write-on clip', () => {
    const [answer] = show([equation('18+4×3=')]).texts;
    expect(answer.clip?.left).toBeLessThanOrEqual(answer.left);
    expect(answer.clip?.right).toBeGreaterThanOrEqual(answer.right);
  });

  it('keeps the answer on a page with little room left', () => {
    const sum = equation('18+4×3=');
    const pageWidth = sum.line.bounds.maxX + 90;
    const [answer] = show([sum], pageWidth).texts;
    expect(answer.right).toBeLessThanOrEqual(pageWidth);
  });
});

describe('showing doubt', () => {
  it('draws a dotted line under the symbol it was unsure of, and only that one', () => {
    const sum = doubting(equation('18+4×3='), 3); // the "4"
    const { dotted } = show([sum]);
    const four = sum.line.symbols[3].bounds;

    expect(dotted).toHaveLength(1);
    expect(dotted[0].left).toBeLessThanOrEqual(four.minX);
    expect(dotted[0].right).toBeGreaterThanOrEqual(four.maxX);
    expect(dotted[0].y).toBeGreaterThan(sum.line.bounds.maxY);
  });

  it('draws no dotted line when it was sure of everything', () => {
    expect(show([equation('18+4×3=')]).dotted).toEqual([]);
  });

  it('marks each of several doubtful symbols', () => {
    const sum = doubting(doubting(equation('18+4×3='), 0), 5);
    expect(show([sum]).dotted).toHaveLength(2);
  });

  it('marks a doubtful symbol on a line that has no answer yet', () => {
    const { texts, dotted } = show([doubting(equation('18+4'), 1)]);
    expect(texts).toEqual([]);
    expect(dotted).toHaveLength(1);
  });

  it('never writes a question mark, whatever it has to say', () => {
    const everything = [
      equation('18+4×3=', 0.2),
      doubting(equation('96-27='), 1),
      equation('3++2='),
      equation('9÷0=', 0.3),
      equation('='),
      doubting(column(['8', '7', '+3']), 1),
      column(['8', '++3']),
    ].map((each, id) => ({ ...each, id }));

    for (const { text } of show(everything).texts) expect(text).not.toContain('?');
  });
});

describe('a line that does not make sense', () => {
  it('gets a note saying why, and nothing where the answer would be', () => {
    const { texts } = show([equation('3++2=')]);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toContain('needs a number');
  });

  it('has the note below the line', () => {
    const sum = equation('3++2=');
    const [note] = show([sum]).texts;
    expect(note.y).toBeGreaterThan(sum.line.bounds.maxY);
  });

  it('keeps the note on the page when the fault is near the right edge', () => {
    const sum = equation('3++2=', 1, 700);
    const pageWidth = sum.line.bounds.maxX + 20;
    const [note] = show([sum], pageWidth).texts;
    expect(note.right).toBeLessThanOrEqual(pageWidth);
    expect(note.left).toBeGreaterThanOrEqual(0);
  });

  it('gets no note when it is only a bare "=", a line not yet written', () => {
    expect(show([equation('=')]).texts).toEqual([]);
  });
});

describe('drawing the answer of a column sum', () => {
  it('writes it under the rule', () => {
    const sum = column(['8', '7', '+3']);
    const [answer] = show([sum]).texts;
    expect(answer.text).toBe('18');
    expect(answer.y).toBeGreaterThan(sum.line.column!.rule.bounds.maxY);
  });

  it('ends it under the last digits of the rows above', () => {
    const sum = column(['125', '+48']);
    const [answer] = show([sum]).texts;
    const digitsEnd = Math.max(...sum.line.column!.rows.map((row) => row.bounds.maxX));
    expect(answer.text).toBe('173');
    expect(answer.right).toBeCloseTo(digitsEnd, 0);
  });

  it('keeps a long answer on the page', () => {
    const sum = column(['8', '÷0']); // "Undefined" is far wider than the column
    for (const pageWidth of [1200, 430]) {
      const [answer] = show([sum], pageWidth).texts;
      expect(answer.text).toBe('Undefined');
      expect(answer.left).toBeGreaterThanOrEqual(0);
      expect(answer.right).toBeLessThanOrEqual(pageWidth);
    }
  });

  it('marks a doubtful digit just under its own row, clear of the row below', () => {
    const sum = doubting(column(['8', '7', '+3']), 1); // the "7", in the second row
    const { dotted, texts } = show([sum]);
    const [, second, third] = sum.line.column!.rows;

    expect(texts.map((t) => t.text)).toEqual(['18']);
    expect(dotted).toHaveLength(1);
    expect(dotted[0].y).toBeGreaterThan(second.bounds.maxY);
    expect(dotted[0].y).toBeLessThan(third.bounds.minY);
  });

  it('writes the reason under the rule of a column that makes no sense', () => {
    const sum = column(['8', '++3']);
    const { texts } = show([sum]);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toContain('needs a number');
    expect(texts[0].y).toBeGreaterThan(sum.line.bounds.maxY);
  });
});
