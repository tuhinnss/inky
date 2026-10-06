import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluatePage, readEquation, type Equation } from '../../src/app/equations';
import type { CanvasLayer } from '../../src/canvas/CanvasLayer';
import { layoutPage, segmentLine, type Line } from '../../src/layout';
import { MODEL_SYMBOLS, type ModelSymbol } from '../../src/recognition/model';
import {
  AnswerOverlay,
  answerOpacity,
  answerText,
  isDragged,
  lineOnPage,
  LOW_CONFIDENCE,
  roomTaken,
} from '../../src/ui/AnswerOverlay';
import { ink, inkColumn, strokesOf, turned } from '../fixtures/ink';

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
  /** Every turn of the canvas, in radians, in the order made. */
  const turns: number[] = [];
  /** Every shift of the canvas, in the order made. */
  const shifts: Array<[number, number]> = [];
  const clips: Array<Text['clip']> = [undefined];
  let pending: Text['clip'];
  let dash: number[] = [];
  let path: Array<{ x: number; y: number }> = [];

  const ctx = {
    font: '',
    globalAlpha: 1,
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
    arc: () => undefined,
    fill: () => undefined,
    strokeText: () => undefined,
    translate: (x: number, y: number) => shifts.push([x, y]),
    rotate: (angle: number) => turns.push(angle),
    measureText: (text: string) => ({ width: widthOf(text, ctx.font) }),
    fillText: (text: string, x: number, y: number) => {
      const w = widthOf(text, ctx.font);
      const left = ctx.textAlign === 'center' ? x - w / 2 : x;
      // The colour's own opacity, and that of everything drawn at the time.
      const opacity = Number(/,\s*([\d.]+)\)$/.exec(ctx.fillStyle)?.[1] ?? 1) * ctx.globalAlpha;
      texts.push({ text, left, right: left + w, y, opacity, clip: clips[clips.length - 1] });
    },
  };

  const clear = (): void => {
    texts.length = 0;
    dotted.length = 0;
    turns.length = 0;
    shifts.length = 0;
  };
  const layer = { ctx, width, height: 600, clear } as unknown as CanvasLayer;
  return { layer, texts, dotted, turns, shifts };
}

function show(
  equations: Equation[],
  pageWidth = 1200,
): { texts: Text[]; dotted: Dotted[]; turns: number[] } {
  const { layer, texts, dotted, turns } = fakeLayer(pageWidth);
  const overlay = new AnswerOverlay(layer);
  overlay.setEquations(equations);
  overlay.redraw();
  return { texts: [...texts], dotted: [...dotted], turns: [...turns] };
}

/** A line written at an angle, read as if every symbol had been recognised. */
function askew(text: string, degrees: number): Equation {
  const written = ink(text, { size: 80, x: 100, y: 400 });
  const [line] = layoutPage(turned(written, degrees));
  const cache = new Map<string, Float32Array>();
  line.symbols.forEach((symbol, i) => {
    if (symbol.kind !== 'shape') return;
    const char = written[i].char as ModelSymbol;
    cache.set(
      symbol.key,
      Float32Array.from(MODEL_SYMBOLS, (s) => (s === char ? 1 : 0)),
    );
  });
  return readEquation({ id: 1, version: 1, line }, cache);
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

describe('the solution of an equation', () => {
  it('is what x is, pencilled in after the equation', () => {
    const solved = { ...equation('18+4'), solution: { kind: 'roots' as const, values: [2, 3] } };
    expect(answerText(solved)).toBe('x = 2 or 3');
    const { texts } = show([solved]);
    expect(texts.map((t) => t.text)).toEqual(['x = 2 or 3']);
    expect(texts[0].left).toBeGreaterThan(solved.line.bounds.maxX);
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

describe('a line written at an angle', () => {
  it('has its answer written along the line, by turning the canvas the way the line runs', () => {
    const sum = askew('18+4×3=', 25);
    const { texts, turns } = show([sum]);

    expect(sum.line.tilt).toBeDefined();
    expect(texts.map((t) => t.text)).toEqual(['30']);
    expect(turns).toEqual([sum.line.tilt!.angle]);
  });

  it('has the answer after the "=", measured along the line', () => {
    const sum = askew('18+4×3=', -25);
    const [answer] = show([sum]).texts;
    const equals = sum.line.symbols[sum.line.symbols.length - 1].bounds;
    // Both are in the line's own level frame, which is the frame the canvas was turned to.
    expect(answer.left).toBeGreaterThan(equals.maxX);
    expect(answer.y).toBeGreaterThan(equals.minY - 10);
    expect(answer.y).toBeLessThan(equals.maxY + 10);
  });

  it('does not turn the canvas for a level line', () => {
    expect(show([equation('18+4×3=')]).turns).toEqual([]);
  });

  it('turns it for the askew line only, when both are on the page', () => {
    const level = { ...equation('96-27='), id: 1 };
    const sloped = { ...askew('18+4×3=', 25), id: 2 };
    expect(show([level, sloped]).turns).toHaveLength(1);
  });
});

describe('a sum dragged with the lasso', () => {
  const idsOf = (sum: Equation): Set<number> =>
    new Set(sum.line.symbols.flatMap((symbol) => symbol.strokes.map((stroke) => stroke.id)));

  /** The overlay, showing `equations`, and what it drew in its last frame. */
  function overlayOf(equations: Equation[]) {
    const fake = fakeLayer(1200);
    const overlay = new AnswerOverlay(fake.layer);
    overlay.setEquations(equations);
    const frame = () => {
      overlay.redraw();
      return { texts: [...fake.texts], shifts: [...fake.shifts] };
    };
    return { overlay, frame };
  }

  it('is carried whole only when the lasso holds every one of its strokes', () => {
    const sum = equation('96-27=');
    const all = idsOf(sum);
    expect(isDragged(sum, { ids: all, dx: 0, dy: 0, dropped: false })).toBe(true);
    const some = new Set([...all].slice(1));
    expect(isDragged(sum, { ids: some, dx: 0, dy: 0, dropped: false })).toBe(false);
  });

  it('takes its answer along while it is dragged, and leaves the others', () => {
    const dragged = { ...equation('96-27='), id: 1 };
    const still = { ...equation('7+5=', 1, 600), id: 2 };
    const { overlay, frame } = overlayOf([dragged, still]);
    overlay.setDrag({ ids: idsOf(dragged), dx: 40, dy: 180, dropped: false });
    const { texts, shifts } = frame();
    expect(texts.map((t) => t.text).sort()).toEqual(['12', '69']);
    expect(shifts).toEqual([[40, 180]]);
  });

  it('keeps the answer at the drop until the moved sum has been read again', () => {
    const sum = equation('96-27=');
    const { overlay, frame } = overlayOf([sum]);
    overlay.setDrag({ ids: idsOf(sum), dx: 40, dy: 180, dropped: true });
    expect(frame().shifts).toEqual([[40, 180]]);
    // The reading of the moved strokes arrives: it is drawn where it is, unshifted.
    overlay.setEquations([equation('96-27=', 1, 80)]);
    expect(frame().shifts).toEqual([]);
  });

  it('puts the answer back when the drag comes to nothing', () => {
    const sum = equation('96-27=');
    const { overlay, frame } = overlayOf([sum]);
    overlay.setDrag({ ids: idsOf(sum), dx: 40, dy: 180, dropped: false });
    overlay.setDrag(null);
    expect(frame().shifts).toEqual([]);
  });
});

describe('a graph', () => {
  /** A graph's line, read and worked out as the page would be. */
  const graphed = (text: string, x = 40): Equation => evaluatePage([equation(text, 1, x)])[0];
  const idsOf = (line: Equation): Set<number> =>
    new Set(line.line.symbols.flatMap((symbol) => symbol.strokes.map((stroke) => stroke.id)));

  it('is drawn under its line, numbered on both axes', () => {
    const line = graphed('y=2×+1');
    expect(line.graph).toEqual({ body: '2x+1' });
    const { texts } = show([line]);
    expect(texts.map((t) => t.text)).toEqual(expect.arrayContaining(['x', 'y', '0', '5', '−5']));
    for (const text of texts) expect(text.y).toBeGreaterThan(line.line.bounds.maxY);
  });

  it('marks where it crosses the axes, with their coordinates', () => {
    const labels = show([graphed('y=2×+1')]).texts.map((t) => t.text);
    expect(labels).toEqual(expect.arrayContaining(['(−0.5, 0)', '(0, 1)']));
  });

  it('is numbered on the y axis it was fitted to', () => {
    const labels = show([graphed('y=×+50')]).texts.map((t) => t.text);
    expect(labels).toEqual(expect.arrayContaining(['40', '45', '50', '55']));
    // With no x axis in view, x is numbered along the bottom, right to the end.
    expect(labels).toEqual(expect.arrayContaining(['−10', '0', '10']));
    expect(labels).not.toContain('x');
  });

  it('goes with its line while the lasso drags it', () => {
    const line = graphed('y=2×+1');
    const fake = fakeLayer(1200);
    const overlay = new AnswerOverlay(fake.layer);
    overlay.setEquations([line]);
    overlay.setDrag({ ids: idsOf(line), dx: 40, dy: 180, dropped: false });
    overlay.redraw();
    // Once for what is written on the line, once for the graph.
    expect(fake.shifts).toEqual([
      [40, 180],
      [40, 180],
    ]);
  });

  it('is drawn fainter when the notebook doubts a symbol of its line', () => {
    const sure = graphed('y=2×+1');
    const unsure = { ...sure, confidence: 0.45 };
    const darkest = (equation: Equation): number =>
      Math.max(...show([equation]).texts.map((t) => t.opacity));
    expect(darkest(unsure)).toBeLessThan(0.6 * darkest(sure));
  });

  it('is gone once its line no longer asks for one', () => {
    const fake = fakeLayer(1200);
    const overlay = new AnswerOverlay(fake.layer);
    overlay.setEquations([graphed('y=2×+1')]);
    overlay.setEquations([{ ...equation('18+4='), id: 1 }]);
    overlay.redraw();
    expect(fake.texts.map((t) => t.text)).toEqual(['22']);
  });
});

describe('the room a line takes', () => {
  it('runs on past the "=" as far as its answer', () => {
    const sum = equation('18+4=');
    const room = roomTaken(sum);
    expect(room.minX).toBe(sum.line.bounds.minX);
    expect(room.maxX).toBeGreaterThan(sum.line.bounds.maxX + sum.line.height);
  });

  it('is only the writing while there is no answer', () => {
    const sum = equation('18+4');
    expect(roomTaken(sum)).toEqual(sum.line.bounds);
  });
});

describe('lineOnPage', () => {
  const line = (tilt?: Line['tilt']): Line => ({
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 20 },
    height: 20,
    symbols: [],
    tilt,
  });

  it('is the box of a level line', () => {
    expect(lineOnPage(line())).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 20 });
  });

  it('turns the box of a line written at an angle back onto the page', () => {
    const box = lineOnPage(line({ angle: Math.PI / 2, degrees: 90, pivotX: 0, pivotY: 0 }));
    expect(box.minX).toBeCloseTo(-20);
    expect(box.maxX).toBeCloseTo(0);
    expect(box.minY).toBeCloseTo(0);
    expect(box.maxY).toBeCloseTo(100);
  });
});
