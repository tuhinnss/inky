/**
 * What a graph shows: the curve sampled across the page's window onto it, and the axes'
 * ranges and ticks. Pure functions, no DOM; AnswerOverlay draws the result.
 *
 * The window starts as a square from −10 to 10, as on squared paper: lines, parabolas and
 * 1 ÷ x keep their true shape in it. When most of the curve would fall outside it, as for
 * y = x + 50 or y = x × x × x, the y axis is fitted to the curve instead, leaving out the
 * last few per cent at either end so that one steep tail does not flatten the rest.
 */

export interface Range {
  min: number;
  max: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Plot {
  x: Range;
  y: Range;
  /** Where the axes are marked and numbered, in the graph's own units. */
  xTicks: number[];
  yTicks: number[];
  /**
   * The curve, as runs of points with no break in them. It breaks where it has no value,
   * as 1 ÷ x has none at 0, and where it leaps from one side of the window to the other.
   */
  runs: Point[][];
}

/** The x the graph is drawn over, unless asked otherwise. */
export const X_RANGE: Range = { min: -10, max: 10 };
/** Points worked out across the window: closer together than the pixels they are drawn on. */
const SAMPLES = 401;
/** The square window is kept when at least this share of the curve is inside it. */
const KEEP_SQUARE = 0.5;
/** A fitted window leaves out this share of the values at either end... */
const TAIL = 0.02;
/** ...and has this much room added above and below, as a share of its height. */
const PAD = 0.08;
/** Ticks are wanted about this many steps apart across an axis. */
const TICK_STEPS = 5;
/** Points further off than this many window heights are drawn at that distance. */
const FAR = 10;

/**
 * Samples `f` across `x` and decides what to show of it.
 *
 * @param f the curve: a value for each x, or null where it has none.
 */
export function plot(f: (x: number) => number | null, x: Range = X_RANGE, samples = SAMPLES): Plot {
  const points: Array<Point | null> = [];
  for (let i = 0; i < samples; i++) {
    const at = x.min + ((x.max - x.min) * i) / (samples - 1);
    const value = f(at);
    points.push(value === null || !Number.isFinite(value) ? null : { x: at, y: value });
  }
  const values = points.filter((p): p is Point => p !== null).map((p) => p.y);

  const y = yWindow(values, x);
  return {
    x,
    y,
    xTicks: niceTicks(x.min, x.max),
    yTicks: niceTicks(y.min, y.max),
    runs: runsOf(points, y),
  };
}

/** The y window: the square one, or one fitted to the values when most miss the square. */
export function yWindow(values: readonly number[], x: Range = X_RANGE): Range {
  if (values.length === 0) return { ...x };
  const inside = values.filter((v) => v >= x.min && v <= x.max).length;
  if (inside >= KEEP_SQUARE * values.length) return { ...x };

  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))];
  let min = at(TAIL);
  let max = at(1 - TAIL);
  if (max - min < 1e-9 * Math.max(1, Math.abs(max))) {
    // Flat: give it room around its one value.
    const room = Math.max(1, Math.abs(max) / 2);
    min -= room;
    max += room;
  }
  const pad = (max - min) * PAD;
  min -= pad;
  max += pad;
  // Take in the x axis when it is near, so that where the curve crosses zero shows.
  const span = max - min;
  if (min > 0 && min < span / 3) min = 0;
  if (max < 0 && -max < span / 3) max = 0;
  return { min, max };
}

/**
 * Round numbers to mark an axis from `min` to `max` with: the multiples, between the two,
 * of a step of 1, 2 or 5 times a power of ten, about five steps apart.
 */
export function niceTicks(min: number, max: number, steps = TICK_STEPS): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  const rough = span / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough * 0.75) ?? 10 * power;
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  const ticks: number[] = [];
  for (let i = first; i <= last; i++) ticks.push(clean(i * step));
  return ticks;
}

/** A tick's number without the noise of binary fractions: 0.30000000000000004 is 0.3. */
function clean(value: number): number {
  const rounded = Number(value.toPrecision(12));
  return rounded === 0 ? 0 : rounded;
}

/**
 * The curve as runs of points. A run ends where the curve has no value, and where it
 * jumps from above the window to below it or back between two samples: that is an
 * asymptote, as at x = 0 for 1 ÷ x, not a line to draw. Far-off points are brought in to
 * a few window heights, which changes nothing that can be seen and keeps the numbers
 * the canvas is given small.
 */
function runsOf(points: ReadonlyArray<Point | null>, y: Range): Point[][] {
  const height = y.max - y.min;
  const low = y.min - FAR * height;
  const high = y.max + FAR * height;
  const runs: Point[][] = [];
  let run: Point[] = [];
  let previous: Point | null = null;
  for (const point of points) {
    const leapt =
      point !== null &&
      previous !== null &&
      ((previous.y > y.max && point.y < y.min) || (previous.y < y.min && point.y > y.max));
    if (point === null || leapt) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    if (point !== null) run.push({ x: point.x, y: Math.min(high, Math.max(low, point.y)) });
    previous = point;
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Space kept between a graph and the edges of the page. */
const MARGIN = 12;

/**
 * Where a graph goes: under its line, from where the line starts, sized to the writing
 * but never wider than the page allows. A graph near the right edge is moved left onto
 * the page rather than cut off.
 *
 * @param line the box of the graph's line on the page.
 * @param lineHeight the height of a digit on that line.
 */
export function graphFrame(
  line: { minX: number; maxY: number },
  lineHeight: number,
  pageWidth: number,
): Frame {
  const width = Math.max(0, Math.min(Math.max(5 * lineHeight, 260), 420, pageWidth - 2 * MARGIN));
  const left = Math.max(MARGIN, Math.min(line.minX, pageWidth - MARGIN - width));
  const top = line.maxY + Math.max(16, 0.4 * lineHeight);
  return { left, top, width, height: Math.round(width * 0.72) };
}
