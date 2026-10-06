import type { Equation } from '../app/equations';
import type { CanvasLayer } from '../canvas/CanvasLayer';
import type { Drag } from '../canvas/InkCanvas';
import type { Bounds } from '../ink';
import type { Line } from '../layout';
import { solutionText } from '../app/solve';
import { compile } from '../math';
import type { Reading } from '../recognition/interpret';
import { drawGraph } from './drawGraph';
import { GRAPHITE, font } from './pencil';
import { graphFrame, plot, type Frame, type Plot, type Range } from './plot';
import { equationAt, labelFor } from './readings';

/** Below this a reading is shown as doubtful. */
export const LOW_CONFIDENCE = 0.6;
/** How long an answer takes to be pencilled in. */
const WRITE_MS = 260;
/** How long a graph's curve takes to be drawn in, from left to right. */
const GRAPH_MS = 700;

interface Shown {
  text: string;
  /** When this text first appeared, for the write-on animation. */
  since: number;
}

interface ShownGraph {
  /** What it is the graph of: the expression after `y=`. */
  body: string;
  since: number;
  plot: Plot;
  /** The curve's value at any x, for reading it off where the graph is tapped. */
  at: (x: number) => number | null;
}

/**
 * The box a line takes up on the page. A line written at an angle is stored turned
 * level; its box on the page is that of its corners turned back.
 */
export function lineOnPage(line: Line): Bounds {
  const { bounds, tilt } = line;
  if (!tilt) return bounds;
  const cos = Math.cos(tilt.angle);
  const sin = Math.sin(tilt.angle);
  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.maxY],
  ].map(([x, y]) => {
    const dx = x - tilt.pivotX;
    const dy = y - tilt.pivotY;
    return { x: tilt.pivotX + dx * cos - dy * sin, y: tilt.pivotY + dx * sin + dy * cos };
  });
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/**
 * What to pencil in after the "=", or null when there is nothing to write there: the
 * line is not finished, or it does not make sense, in which case a note below it says
 * why and the place for the answer stays empty.
 */
export function answerText(equation: Equation): string | null {
  const { evaluation, solution } = equation;
  if (solution) return solutionText(solution);
  if (!evaluation || evaluation.status === 'error') return null;
  return evaluation.text;
}

/**
 * How dark to draw an answer. Confidence is the notebook's own: firm graphite when it is
 * sure of every symbol it read, a fainter line when it is guessing.
 */
export function answerOpacity(confidence: number): number {
  const sureness = Math.min(1, Math.max(0, (confidence - 0.4) / 0.5));
  return 0.42 + 0.53 * sureness;
}

const inFrame = (at: { x: number; y: number }, frame: Frame): boolean =>
  at.x >= frame.left &&
  at.x <= frame.left + frame.width &&
  at.y >= frame.top &&
  at.y <= frame.top + frame.height;

/**
 * The x a tap reads a graph off at, `share` of the way across its window, rounded to a
 * hundredth of the window's width in a round step: a tenth across −10 to 10, so the point
 * read is x = 1.4, not x = 1.3871.
 */
export function readOff(x: Range, share: number): number {
  const at = x.min + Math.max(0, Math.min(1, share)) * (x.max - x.min);
  const step = 10 ** Math.floor(Math.log10((x.max - x.min) / 100));
  const rounded = Number((Math.round(at / step) * step).toPrecision(12));
  return rounded === 0 ? 0 : rounded;
}

/**
 * The room a line takes on the page: its writing, and the answer written after it or,
 * for a column sum, under it. The answer's width is reckoned at half a digit height per
 * character, as the handwriting font sets it.
 */
export function roomTaken(equation: Equation): Bounds {
  const box = lineOnPage(equation.line);
  const text = answerText(equation);
  if (text === null) return box;
  const { height } = equation.line;
  if (equation.line.column) return { ...box, maxY: box.maxY + 1.3 * height };
  return { ...box, maxX: box.maxX + height * (0.34 + 0.55 * text.length) };
}

/**
 * Whether a drag carries the whole of an equation. One the lasso took only part of keeps
 * its answer where it is until it is read again.
 */
export function isDragged(equation: Equation, drag: Drag): boolean {
  return equation.line.symbols.every((symbol) =>
    symbol.strokes.every((stroke) => drag.ids.has(stroke.id)),
  );
}

/**
 * Draws everything the notebook writes back onto the page: answers, doubts and errors.
 *
 * The rule of the interface is that ink is the user's and pencil is the machine's, so
 * all of it is graphite. Doubt is shown the way a careful reader would mark it, without
 * a word: the answer is written more faintly, and the symbol it was unsure of gets a
 * dotted line beneath it.
 *
 * Nothing here runs unless an equation changes or an answer is mid-animation; there is
 * no standing render loop.
 */
export class AnswerOverlay {
  private equations: readonly Equation[] = [];
  private readonly shown = new Map<number, Shown>();
  /** The graphs drawn, by equation id, sampled once each time their expression changes. */
  private readonly graphs = new Map<number, ShownGraph>();
  /** Where each graph was last drawn, by equation id. */
  private readonly graphFrames = new Map<number, Frame>();
  /** The point read off a graph where it was tapped: the graph's id and the x. */
  private trace: { id: number; x: number } | null = null;
  private frame = 0;
  private readonly reducedMotion: boolean;
  /** Strokes the lasso is dragging. What is written for them is drawn moved with them. */
  private drag: Drag | null = null;
  /** Sums whose readings are shown, by equation id. */
  private readonly revealed = new Set<number>();
  /** Where each answer was last drawn, by equation id, in its line's own frame. */
  private readonly answerBoxes = new Map<number, Bounds>();

  /** How far down the graphs reached when last reported. */
  private graphsReach = 0;

  /**
   * @param onGraphsReach told how far down the page the graphs go, whenever that changes,
   *   so that there is paper under them.
   */
  constructor(
    private readonly layer: CanvasLayer,
    private readonly onGraphsReach: (bottom: number) => void = () => {},
  ) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * While the lasso drags a sum, its answer goes with it. Once the sum is dropped, the
   * answer stays at the new place until the moved strokes have been read again and the
   * fresh answer takes over, so it never jumps back for a moment.
   */
  setDrag(drag: Drag | null): void {
    this.drag = drag;
    this.requestDraw();
  }

  setEquations(equations: readonly Equation[]): void {
    this.equations = equations;
    // These were read from the page after the drop, from the moved strokes themselves.
    if (this.drag?.dropped) this.drag = null;
    const now = performance.now();

    const present = new Set<number>();
    for (const equation of equations) {
      const text = answerText(equation);
      if (text === null) continue;
      present.add(equation.id);
      // Only a changed answer is written afresh. An unchanged one stays put.
      if (this.shown.get(equation.id)?.text !== text) {
        this.shown.set(equation.id, { text, since: now });
      }
    }
    for (const id of this.shown.keys()) if (!present.has(id)) this.shown.delete(id);

    const graphed = new Set<number>();
    for (const equation of equations) {
      if (!equation.graph) continue;
      graphed.add(equation.id);
      const { body } = equation.graph;
      if (this.graphs.get(equation.id)?.body === body) continue;
      const compiled = compile(body);
      // evaluatePage has said what is wrong with it under the line: nothing to draw.
      if (!compiled.ok) continue;
      const at = (x: number): number | null => compiled.at(x);
      this.graphs.set(equation.id, { body, since: now, plot: plot(at), at });
      // A point read off the old curve says nothing about the new one.
      if (this.trace?.id === equation.id) this.trace = null;
    }
    for (const id of this.graphs.keys()) if (!graphed.has(id)) this.graphs.delete(id);
    if (this.trace && !this.graphs.has(this.trace.id)) this.trace = null;
    const alive = new Set(equations.map((equation) => equation.id));
    for (const id of this.revealed) if (!alive.has(id)) this.revealed.delete(id);

    this.requestDraw();
  }

  /**
   * A tap on a sum, on the ink of one of its symbols or on its answer, shows what the
   * notebook read there: each symbol labelled with the character it was taken for. A
   * second tap hides it again.
   *
   * @returns whether the tap was on a sum, and so was taken.
   */
  toggleReadingsAt(at: { x: number; y: number }): boolean {
    // A tap on a graph reads the curve off there; a tap anywhere else puts that away.
    for (const [id, frame] of this.graphFrames) {
      if (!inFrame(at, frame)) continue;
      const { x } = this.graphs.get(id)!.plot;
      this.trace = { id, x: readOff(x, (at.x - frame.left) / frame.width) };
      this.requestDraw();
      return true;
    }
    if (this.trace) {
      this.trace = null;
      this.requestDraw();
      return true;
    }
    const equation = equationAt(this.equations, this.answerBoxes, at);
    if (!equation) return false;
    if (!this.revealed.delete(equation.id)) this.revealed.add(equation.id);
    this.requestDraw();
    return true;
  }

  /** Ids of the sums whose readings are shown. */
  get showingReadings(): ReadonlySet<number> {
    return this.revealed;
  }

  /** Call after the canvas was resized, which cleared it. */
  redraw(): void {
    this.draw(performance.now());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.shown.clear();
    this.graphs.clear();
    this.graphFrames.clear();
    this.trace = null;
    this.equations = [];
  }

  private requestDraw(): void {
    this.frame ||= requestAnimationFrame((now) => {
      this.frame = 0;
      this.draw(now);
    });
  }

  private draw(now: number): void {
    const { ctx } = this.layer;
    this.layer.clear();
    this.answerBoxes.clear();
    this.graphFrames.clear();
    let animating = false;
    /** The graphs drawn so far in this frame: a later one keeps clear of them. */
    const placed: Bounds[] = [];

    for (const equation of this.equations) {
      // A line written at an angle was turned level to be read, and its geometry is in
      // that level frame. Turning the canvas the same way puts everything written back
      // onto it along the line: the answer carries on in the direction of the writing.
      const { tilt } = equation.line;
      ctx.save();
      if (this.drag && isDragged(equation, this.drag)) ctx.translate(this.drag.dx, this.drag.dy);
      if (tilt) {
        ctx.translate(tilt.pivotX, tilt.pivotY);
        ctx.rotate(tilt.angle);
        ctx.translate(-tilt.pivotX, -tilt.pivotY);
      }

      this.drawDoubts(ctx, equation);
      if (this.revealed.has(equation.id)) this.drawReadings(ctx, equation);
      this.drawErrorNote(ctx, equation);

      const shown = this.shown.get(equation.id);
      if (shown) {
        const progress = this.reducedMotion ? 1 : Math.min(1, (now - shown.since) / WRITE_MS);
        if (progress < 1) animating = true;
        this.drawAnswer(ctx, equation, shown.text, progress);
      }
      ctx.restore();

      // A graph is drawn square to the page, under its line, even when the line is not.
      const graph = this.graphs.get(equation.id);
      if (graph) {
        const progress = this.reducedMotion ? 1 : Math.min(1, (now - graph.since) / GRAPH_MS);
        if (progress < 1) animating = true;
        ctx.save();
        if (this.drag && isDragged(equation, this.drag)) ctx.translate(this.drag.dx, this.drag.dy);
        const others = this.equations.filter((other) => other !== equation).map(roomTaken);
        const frame = graphFrame(
          lineOnPage(equation.line),
          equation.line.height,
          this.layer.width,
          [...others, ...placed],
        );
        // A graph is as sure as its line: fainter when the notebook doubts a symbol of it,
        // as an answer is.
        const opacity = answerOpacity(equation.confidence) / answerOpacity(1);
        const traced = this.trace?.id === equation.id ? this.trace.x : null;
        const trace = traced === null ? undefined : { x: traced, y: graph.at(traced) };
        drawGraph(ctx, frame, graph.plot, progress, opacity, trace);
        if (!(this.drag && isDragged(equation, this.drag)))
          this.graphFrames.set(equation.id, frame);
        placed.push({
          minX: frame.left,
          minY: frame.top,
          maxX: frame.left + frame.width,
          maxY: frame.top + frame.height,
        });
        ctx.restore();
      }
    }

    let reach = 0;
    for (const frame of this.graphFrames.values())
      reach = Math.max(reach, frame.top + frame.height);
    if (reach !== this.graphsReach) {
      this.graphsReach = reach;
      if (reach > 0) this.onGraphsReach(reach);
    }

    if (animating) this.requestDraw();
  }

  private drawAnswer(
    ctx: CanvasRenderingContext2D,
    equation: Equation,
    text: string,
    progress: number,
  ): void {
    const { line } = equation;
    const equals = line.symbols[line.symbols.length - 1].bounds;
    const isNumber = equation.evaluation?.status === 'ok';
    // A solution is written a little smaller than an answer and further off: "x = 2 or 3"
    // follows a finished equation, not an "=" waiting for it.
    const solved = equation.solution !== undefined;

    // Match the size of the handwriting; words are set smaller than numbers.
    let size = Math.min(220, Math.max(22, line.height * (isNumber ? 1.0 : solved ? 0.75 : 0.6)));
    let x = equals.maxX + line.height * (solved ? 0.8 : 0.34);
    let y = (equals.minY + equals.maxY) / 2;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(size);
    let width = ctx.measureText(text).width;

    if (line.column) {
      // Under the rule, where the answer of a column sum is written, with its last digit
      // under the last digits of the rows above.
      const right = Math.max(...line.column.rows.map((row) => row.bounds.maxX));
      x = Math.max(8, Math.min(right - width, this.layer.width - width - 10));
      y = line.column.rule.bounds.maxY + line.height * 0.2 + size / 2;
    } else {
      // Running off the right edge: first write smaller, then drop below the line.
      const room = this.layer.width - x - 10;
      if (width > room) {
        const fitted = Math.max(size * 0.55, (size * room) / width);
        if ((width * fitted) / size <= room) {
          size = fitted;
        } else {
          size *= 0.7;
          x = Math.max(8, Math.min(x, this.layer.width - width * 0.7 - 10));
          y = line.bounds.maxY + size * 0.75;
        }
        ctx.font = font(size);
        width = ctx.measureText(text).width;
      }
    }

    ctx.save();
    // The write-on effect: reveal the text from left to right, easing out.
    const eased = 1 - (1 - progress) ** 3;
    ctx.beginPath();
    ctx.rect(x - size * 0.2, y - size, (width + size * 0.4) * eased, size * 2);
    ctx.clip();

    // A doubtful answer is the same answer, written more faintly.
    const sure = isNumber || (solved && equation.solution?.kind !== 'beyond');
    ctx.fillStyle = `rgba(${GRAPHITE}, ${sure ? answerOpacity(equation.confidence) : 0.78})`;
    // Kalam's digits sit a little above the middle of its line box.
    ctx.fillText(text, x, y + size * 0.06);
    this.answerBoxes.set(equation.id, {
      minX: x - size * 0.2,
      minY: y - size * 0.6,
      maxX: x + width + size * 0.2,
      maxY: y + size * 0.6,
    });
    ctx.restore();
  }

  /**
   * What the notebook read, written small above each symbol on a slip of highlighter:
   * the character it took the symbol for. One it was unsure of is written more faintly,
   * the same way its answer is.
   */
  private drawReadings(ctx: CanvasRenderingContext2D, equation: Equation): void {
    const { line, readings } = equation;
    const size = Math.max(14, Math.min(40, line.height * 0.32));
    ctx.save();
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    line.symbols.forEach((symbol, index) => {
      const reading = readings[index];
      // The rule under a column sum is not something anyone wrote as a character.
      if (!reading || symbol.kind === 'rule') return;
      const text = labelFor(reading.symbol);
      const x = (symbol.bounds.minX + symbol.bounds.maxX) / 2;
      const y = symbol.bounds.minY - size * 0.75;
      const half = Math.max(size * 0.45, ctx.measureText(text).width / 2 + size * 0.25);
      ctx.fillStyle = 'rgba(255, 229, 102, 0.55)';
      ctx.beginPath();
      ctx.roundRect(x - half, y - size * 0.55, half * 2, size * 1.1, size * 0.2);
      ctx.fill();
      const opacity = reading.confidence < LOW_CONFIDENCE ? 0.45 : 0.9;
      ctx.fillStyle = `rgba(${GRAPHITE}, ${opacity})`;
      ctx.fillText(text, x, y + size * 0.06);
    });
    ctx.restore();
  }

  /** A dotted pencil line under each symbol the notebook was unsure of. */
  private drawDoubts(ctx: CanvasRenderingContext2D, equation: Equation): void {
    const { line, readings } = equation;
    if (!line.column) {
      this.drawRowDoubts(ctx, line, readings, 0.14);
      return;
    }
    // In a column the next row is directly underneath, so the line is kept close.
    let first = 0;
    for (const row of line.column.rows) {
      this.drawRowDoubts(ctx, row, readings.slice(first, first + row.symbols.length), 0.07);
      first += row.symbols.length;
    }
  }

  /** @param drop how far below the row the dotted lines go, in digit heights. */
  private drawRowDoubts(
    ctx: CanvasRenderingContext2D,
    row: Line,
    readings: readonly Reading[],
    drop: number,
  ): void {
    const y = row.bounds.maxY + row.height * drop;

    ctx.save();
    ctx.strokeStyle = `rgba(${GRAPHITE}, 0.7)`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([1, 5]);

    row.symbols.forEach((symbol, index) => {
      const reading = readings[index];
      if (!reading || reading.confidence >= LOW_CONFIDENCE) return;

      ctx.beginPath();
      ctx.moveTo(symbol.bounds.minX - 2, y);
      ctx.lineTo(symbol.bounds.maxX + 2, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  /** For a malformed line: a zigzag under the symbol at fault and a note saying why. */
  private drawErrorNote(ctx: CanvasRenderingContext2D, equation: Equation): void {
    const { evaluation, line, sources } = equation;
    if (evaluation?.status !== 'error') return;
    // A bare "=" with nothing before it is not a mistake, just a line not yet written.
    if (evaluation.error.code === 'empty') return;

    // The position is an index into the expression. Past the end means "something is
    // missing here", which is at the "=". On a line of writing each character is a
    // symbol; for a column sum `sources` says which symbol each character came from.
    const position = Math.min(
      evaluation.error.position,
      (sources?.length ?? line.symbols.length) - 1,
    );
    const index = Math.min(sources ? sources[position] : position, line.symbols.length - 1);
    const at: Bounds = line.symbols[index].bounds;
    // In a column the zigzag goes right under the symbol and the note under the rule.
    const y = (line.column ? at.maxY : line.bounds.maxY) + line.height * 0.16;
    const noteY = line.column ? line.bounds.maxY + line.height * 0.3 : y + 9;

    ctx.save();
    ctx.strokeStyle = `rgba(${GRAPHITE}, 0.8)`;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    const left = at.minX - 3;
    const right = Math.max(at.maxX + 3, left + 14);
    for (let x = left, up = true; x <= right; x += 4, up = !up) {
      const yy = y + (up ? -2 : 2);
      if (x === left) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();

    const size = Math.max(14, line.height * 0.28);
    ctx.font = font(size);
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(${GRAPHITE}, 0.8)`;
    const width = ctx.measureText(evaluation.error.message).width;
    // Keep the note on the page even when the fault is near the right edge.
    const x = Math.max(
      8,
      Math.min(line.column ? line.bounds.minX : left, this.layer.width - width - 10),
    );
    ctx.textAlign = 'left';
    ctx.fillText(evaluation.error.message, x, noteY);
    ctx.restore();
  }
}
