import type { Equation } from '../app/equations';
import type { CanvasLayer } from '../canvas/CanvasLayer';
import type { Bounds } from '../ink';
import type { Line } from '../layout';
import type { Reading } from '../recognition/interpret';

/** Pencil graphite, as `r, g, b` for use with varying opacity. */
const GRAPHITE = '74, 78, 87';
/** Kalam's light weight: nearer to a pencil line than the regular weight is. */
const FONT = '300 {size}px Kalam, "Segoe Print", "Bradley Hand", cursive';
const font = (size: number): string => FONT.replace('{size}', String(size));

/** Below this a reading is shown as doubtful. */
export const LOW_CONFIDENCE = 0.6;
/** How long an answer takes to be pencilled in. */
const WRITE_MS = 260;
/** The "?" after a doubtful answer: its size and the gap before it, relative to the answer. */
const MARK_SCALE = 0.55;
const MARK_GAP = 0.12;

interface Shown {
  text: string;
  /** When this text first appeared, for the write-on animation. */
  since: number;
}

/**
 * What to pencil in after the "=", or null when there is nothing to say yet.
 * Malformed expressions get a question mark; the detail goes in a note below the line.
 * A bare "=" with nothing before it is not an error, just a line not yet written.
 */
export function answerText(equation: Equation): string | null {
  const { evaluation } = equation;
  if (!evaluation) return null;
  if (evaluation.status !== 'error') return evaluation.text;
  return evaluation.error.code === 'empty' ? null : '?';
}

/**
 * How dark to draw an answer. Confidence is the notebook's own: firm graphite when it is
 * sure of every symbol it read, a fainter line when it is guessing.
 */
export function answerOpacity(confidence: number): number {
  const sureness = Math.min(1, Math.max(0, (confidence - 0.4) / 0.5));
  return 0.42 + 0.53 * sureness;
}

/**
 * Draws everything the notebook writes back onto the page: answers, doubts and errors.
 *
 * The rule of the interface is that ink is the user's and pencil is the machine's, so
 * all of it is graphite. Nothing here runs unless an equation changes or an answer is
 * mid-animation; there is no standing render loop.
 */
export class AnswerOverlay {
  private equations: readonly Equation[] = [];
  private readonly shown = new Map<number, Shown>();
  private frame = 0;
  private readonly reducedMotion: boolean;

  constructor(private readonly layer: CanvasLayer) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setEquations(equations: readonly Equation[]): void {
    this.equations = equations;
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

    this.requestDraw();
  }

  /** Call after the canvas was resized, which cleared it. */
  redraw(): void {
    this.draw(performance.now());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.shown.clear();
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
    let animating = false;

    for (const equation of this.equations) {
      this.drawDoubts(ctx, equation);

      const shown = this.shown.get(equation.id);
      if (!shown) continue;
      const progress = this.reducedMotion ? 1 : Math.min(1, (now - shown.since) / WRITE_MS);
      if (progress < 1) animating = true;
      this.drawAnswer(ctx, equation, shown.text, progress);
      this.drawErrorNote(ctx, equation);
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

    // Match the size of the handwriting; words are set smaller than numbers.
    let size = Math.min(220, Math.max(22, line.height * (isNumber ? 1.0 : 0.6)));
    let x = equals.maxX + line.height * 0.34;
    let y = (equals.minY + equals.maxY) / 2;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // A doubtful answer is followed by a small "?". It is part of what is written, so it
    // counts towards the room the answer needs and towards what the animation reveals.
    const doubtful = isNumber && equation.confidence < LOW_CONFIDENCE;
    const measure = (): { width: number; extent: number } => {
      let mark = 0;
      if (doubtful) {
        ctx.font = font(size * MARK_SCALE);
        mark = size * MARK_GAP + ctx.measureText('?').width;
      }
      ctx.font = font(size);
      const width = ctx.measureText(text).width;
      return { width, extent: width + mark };
    };
    let { width, extent } = measure();

    if (line.column) {
      // Under the rule, where the answer of a column sum is written, with its last digit
      // under the last digits of the rows above.
      const right = Math.max(...line.column.rows.map((row) => row.bounds.maxX));
      x = Math.max(8, Math.min(right - width, this.layer.width - extent - 10));
      y = line.column.rule.bounds.maxY + line.height * 0.2 + size / 2;
    } else {
      // Running off the right edge: first write smaller, then drop below the line.
      const room = this.layer.width - x - 10;
      if (extent > room) {
        const fitted = Math.max(size * 0.55, (size * room) / extent);
        if ((extent * fitted) / size <= room) {
          size = fitted;
        } else {
          size *= 0.7;
          x = Math.max(8, Math.min(x, this.layer.width - extent * 0.7 - 10));
          y = line.bounds.maxY + size * 0.75;
        }
        ({ width, extent } = measure());
      }
    }

    ctx.save();
    // The write-on effect: reveal the text from left to right, easing out.
    const eased = 1 - (1 - progress) ** 3;
    ctx.beginPath();
    ctx.rect(x - size * 0.2, y - size, (extent + size * 0.4) * eased, size * 2);
    ctx.clip();

    ctx.fillStyle = `rgba(${GRAPHITE}, ${isNumber ? answerOpacity(equation.confidence) : 0.78})`;
    // Kalam's digits sit a little above the middle of its line box.
    ctx.fillText(text, x, y + size * 0.06);

    if (doubtful) {
      ctx.font = font(size * MARK_SCALE);
      ctx.fillText('?', x + width + size * MARK_GAP, y - size * 0.18);
    }
    ctx.restore();
  }

  /** What was read beneath, or beside, each doubtful symbol. */
  private drawDoubts(ctx: CanvasRenderingContext2D, equation: Equation): void {
    const { line, readings } = equation;
    if (!line.column) {
      this.drawRowDoubts(ctx, line, readings);
      return;
    }
    // In a column the next row is directly underneath, so the note goes out to the side.
    const beside = line.bounds.maxX + line.height * 0.3;
    let first = 0;
    for (const row of line.column.rows) {
      this.drawRowDoubts(ctx, row, readings.slice(first, first + row.symbols.length), beside);
      first += row.symbols.length;
    }
  }

  /**
   * A dotted pencil underline beneath each doubtful symbol of one row of writing, with
   * what it was taken to be.
   * @param beside if given, the notes are written at this x, level with the row, instead
   *   of under their symbols.
   */
  private drawRowDoubts(
    ctx: CanvasRenderingContext2D,
    row: Line,
    readings: readonly Reading[],
    beside?: number,
  ): void {
    const size = Math.max(13, row.height * 0.3);
    const y = row.bounds.maxY + row.height * (beside === undefined ? 0.14 : 0.07);
    const notes: string[] = [];

    ctx.save();
    ctx.strokeStyle = `rgba(${GRAPHITE}, 0.7)`;
    ctx.fillStyle = `rgba(${GRAPHITE}, 0.75)`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.setLineDash([1, 5]);
    ctx.font = font(size);

    row.symbols.forEach((symbol, index) => {
      const reading = readings[index];
      if (!reading || reading.confidence >= LOW_CONFIDENCE) return;

      ctx.beginPath();
      ctx.moveTo(symbol.bounds.minX - 2, y);
      ctx.lineTo(symbol.bounds.maxX + 2, y);
      ctx.stroke();

      const note = `${reading.symbol === '-' ? '−' : reading.symbol}?`;
      if (beside !== undefined) {
        notes.push(note);
        return;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(note, (symbol.bounds.minX + symbol.bounds.maxX) / 2, y + 3);
    });

    if (beside !== undefined && notes.length > 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(notes.join(' '), beside, (row.bounds.minY + row.bounds.maxY) / 2);
    }
    ctx.restore();
  }

  /** For a malformed line: a zigzag under the symbol at fault and a note saying why. */
  private drawErrorNote(ctx: CanvasRenderingContext2D, equation: Equation): void {
    const { evaluation, line, sources } = equation;
    if (evaluation?.status !== 'error') return;

    // The position is an index into the expression. Past the end means "something is
    // missing here", which is at the "=". On a line of writing each character is a
    // symbol; for a column sum `sources` says which symbol each character came from.
    const position = Math.min(
      evaluation.error.position,
      (sources?.length ?? line.symbols.length) - 1,
    );
    const index = Math.min(sources ? sources[position] : position, line.symbols.length - 1);
    const at: Bounds = line.symbols[index].bounds;
    // In a column the zigzag goes right under the symbol and the note under the answer.
    const y = (line.column ? at.maxY : line.bounds.maxY) + line.height * 0.16;
    const noteY = line.column ? line.bounds.maxY + line.height * 0.95 : y + 9;

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
