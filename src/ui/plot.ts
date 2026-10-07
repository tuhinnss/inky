/**
 * What a graph shows: the curve sampled across the page's window onto it, and the axes'
 * ranges and ticks. Pure functions, no DOM; AnswerOverlay draws the result.
 *
 * The window starts as a square from −10 to 10, as on squared paper: lines, parabolas and
 * 1 ÷ x keep their true shape in it. When most of the curve would fall outside it, as for
 * y = x + 50 or y = x × x × x, the y axis is fitted to the curve instead, leaving out the
 * last few per cent at either end so that one steep tail does not flatten the rest.
 *
 * A curve that turns and climbs out of the square, as a parabola does, would leave its roots
 * and vertex squeezed into a sliver at the foot of a fitted window. So the window closes in
 * on them instead, from a little before the first to a little after the last.
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
  /** Where the curve crosses the axes and where it turns, inside the window. */
  keyPoints: KeyPoint[];
}

/**
 * A point worth marking on a curve: where it crosses zero (a root), where it crosses the
 * y axis, or where it turns, as the vertex of a parabola.
 */
export interface KeyPoint extends Point {
  kinds: Array<'root' | 'y-intercept' | 'turning'>;
  /** Which way the curve runs through it, from left to right: up, down, or flat (turning). */
  slope: number;
  /** At a turn: 1 for a lowest point, −1 for a highest. 0 elsewhere. */
  bend: number;
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
  const whole = sample(f, x, samples);
  const focus = whole.fitted ? focusOn(whole.plot.keyPoints, x) : null;
  return focus ? sample(f, focus, samples).plot : whole.plot;
}

/** Room left either side of a curve's key points when the window closes in on them. */
const FOCUS_ROOM = 3;

/**
 * The x a fitted window closes in on: its key points, with room either side, when the curve
 * turns or crosses zero more than once. Null when there is nothing to close in on, or when
 * the closer window would be nearly as wide as the whole one.
 */
export function focusOn(points: readonly KeyPoint[], x: Range): Range | null {
  const turns = points.filter((p) => p.kinds.includes('turning')).length;
  const roots = points.filter((p) => p.kinds.includes('root')).length;
  if (turns === 0 && roots < 2) return null;
  const xs = points.map((p) => p.x);
  const first = Math.min(...xs);
  const last = Math.max(...xs);
  const room = Math.max(FOCUS_ROOM, 0.6 * (last - first));
  const min = Math.max(x.min, Math.floor(first - room));
  const max = Math.min(x.max, Math.ceil(last + room));
  return max - min > 0.8 * (x.max - x.min) ? null : { min, max };
}

/** The curve sampled across `x`, and whether its y axis had to be fitted to it. */
function sample(
  f: (x: number) => number | null,
  x: Range,
  samples: number,
): { plot: Plot; fitted: boolean } {
  const points: Array<Point | null> = [];
  for (let i = 0; i < samples; i++) {
    const at = x.min + ((x.max - x.min) * i) / (samples - 1);
    const value = f(at);
    points.push(value === null || !Number.isFinite(value) ? null : { x: at, y: value });
  }
  const values = points.filter((p): p is Point => p !== null).map((p) => p.y);

  const window = yWindow(values, x);
  const found = keyPointsOf(f, points, window);
  const y = takeIn(window, found);
  const keyPoints = found.filter((p) => p.y >= y.min && p.y <= y.max);
  return {
    plot: {
      x,
      y,
      xTicks: niceTicks(x.min, x.max),
      yTicks: niceTicks(y.min, y.max),
      runs: runsOf(points, y),
      keyPoints: keyPoints.length > MAX_KEY_POINTS ? [] : keyPoints,
    },
    fitted: window.min !== x.min || window.max !== x.max,
  };
}

/**
 * The window stretched, if need be, to show the curve's turns and where it crosses the y
 * axis with a little room around them: a vertex on the very edge of the window, or just past
 * it, would leave the most telling point of a parabola unmarked. One far beyond the window
 * is left out rather than flatten the rest.
 */
function takeIn(window: Range, points: readonly KeyPoint[]): Range {
  const height = window.max - window.min;
  let { min, max } = window;
  for (const point of points) {
    if (!point.kinds.includes('turning') && !point.kinds.includes('y-intercept')) continue;
    if (point.y < window.min - 2 * height || point.y > window.max + 2 * height) continue;
    min = Math.min(min, point.y - PAD * height);
    max = Math.max(max, point.y + PAD * height);
  }
  return { min, max };
}

/** More key points than this on one curve would crowd it; none are marked then. */
const MAX_KEY_POINTS = 8;
/** Halvings when closing in on a root or a turn: far below anything that can be drawn. */
const REFINE = 60;

/**
 * Where the curve crosses zero, crosses the y axis, and turns. Each is first found between
 * two neighbouring samples, by a change of sign of the curve or of its slope, and then
 * closed in on by halving. A change of sign across a gap or a leap is an asymptote, not a
 * root, and is passed over. Points that land in the same place, as the root, the crossing
 * and the vertex of y = x × x all do, are one point.
 */
function keyPointsOf(
  f: (x: number) => number | null,
  points: ReadonlyArray<Point | null>,
  y: Range,
): KeyPoint[] {
  const found: KeyPoint[] = [];
  const height = y.max - y.min;
  const add = (point: Point, kind: KeyPoint['kinds'][number], slope: number, bend = 0): void => {
    const near = found.find(
      (p) => Math.abs(p.x - point.x) < 1e-6 && Math.abs(p.y - point.y) < 1e-6 * (1 + height),
    );
    if (near) {
      if (!near.kinds.includes(kind)) near.kinds.push(kind);
      if (kind === 'turning') {
        near.slope = 0;
        near.bend = bend;
      }
      return;
    }
    found.push({ x: tidy(point.x), y: tidy(point.y), kinds: [kind], slope, bend });
  };

  // Roots. A curve that is zero over a stretch, as x − x is, has no roots worth marking
  // there, so a sample that is exactly zero is a root only when its neighbours are not.
  // Whole-number roots, as the −1, 0 and 1 of x × x × x − x, land on samples.
  for (let i = 0; i < points.length; i++) {
    const b = points[i];
    if (!b) continue;
    const a = points[i - 1];
    const slope = a ? b.y - a.y : (points[i + 1]?.y ?? b.y) - b.y;
    if (b.y === 0) {
      if (a?.y !== 0 && points[i + 1]?.y !== 0) add(b, 'root', slope);
      continue;
    }
    if (!a || a.y === 0 || Math.sign(a.y) === Math.sign(b.y)) continue;
    const root = bisect(f, a.x, b.x);
    if (root === null) continue;
    const value = f(root);
    // A sign change across a pole closes in on a huge value, not on zero.
    if (value === null || Math.abs(value) > 1e-6 * (1 + height)) continue;
    add({ x: root, y: 0 }, 'root', slope);
  }

  const atZero = f(0);
  if (atZero !== null && Number.isFinite(atZero)) {
    const i = points.findIndex((p) => p !== null && p.x >= 0);
    const after = points[i + 1];
    const before = points[i - 1];
    const slope = after && before ? after.y - before.y : 0;
    add({ x: 0, y: atZero }, 'y-intercept', slope);
  }

  // Turns: where the slope changes sign between three neighbouring samples.
  for (let i = 1; i + 1 < points.length; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    if (!a || !b || !c) continue;
    const left = b.y - a.y;
    const right = c.y - b.y;
    if (left === 0 || right === 0 || Math.sign(left) === Math.sign(right)) continue;
    const x = extremum(f, a.x, c.x, left < 0);
    const value = x === null ? null : f(x);
    if (x === null || value === null) continue;
    add({ x, y: value }, 'turning', 0, left < 0 ? 1 : -1);
  }

  return found;
}

/** Where `f` crosses zero between `a` and `b`, where it changes sign, closed in on by halving. */
function bisect(f: (x: number) => number | null, a: number, b: number): number | null {
  let fa = f(a);
  if (fa === null) return null;
  let lo = a;
  let hi = b;
  for (let i = 0; i < REFINE; i++) {
    const mid = (lo + hi) / 2;
    const value = f(mid);
    if (value === null) return null;
    if (value === 0) return mid;
    if (Math.sign(value) === Math.sign(fa)) {
      lo = mid;
      fa = value;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * The lowest point of `f` between `a` and `b` if `minimum`, else the highest, by
 * narrowing the interval by thirds.
 */
function extremum(
  f: (x: number) => number | null,
  a: number,
  b: number,
  minimum: boolean,
): number | null {
  let lo = a;
  let hi = b;
  for (let i = 0; i < REFINE; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const v1 = f(m1);
    const v2 = f(m2);
    if (v1 === null || v2 === null) return null;
    if (minimum ? v1 < v2 : v1 > v2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/**
 * A found point's coordinate without the noise of closing in on it: 1.9999999999 is 2. A
 * turn is only found to about eight digits, since the curve is flat there and its value
 * hardly changes either side; seven are kept, far more than are ever written.
 */
function tidy(value: number): number {
  const rounded = Number(value.toPrecision(7));
  return rounded === 0 ? 0 : rounded;
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
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough * 0.7) ?? 10 * power;
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

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where a graph goes: under its line, from where the line starts, sized to the writing
 * but never wider than the page allows. A graph near the right edge is moved left onto
 * the page rather than cut off.
 *
 * Writing comes first. When there is writing where the graph would go, it goes to the
 * right of its line instead, moved on past any writing there, as long as it stays on the
 * page. When there is room nowhere, it stays under the line, over what is there.
 *
 * @param line the box of the graph's line on the page.
 * @param lineHeight the height of a digit on that line.
 * @param others the boxes of the other writing on the page.
 */
export function graphFrame(
  line: Box,
  lineHeight: number,
  pageWidth: number,
  others: readonly Box[] = [],
): Frame {
  const width = Math.max(0, Math.min(Math.max(4.5 * lineHeight, 300), 420, pageWidth - 2 * MARGIN));
  const height = Math.round(width * 0.72);
  const gap = Math.max(16, 0.4 * lineHeight);
  const below: Frame = {
    left: Math.max(MARGIN, Math.min(line.minX, pageWidth - MARGIN - width)),
    top: line.maxY + gap,
    width,
    height,
  };
  const overlaps = (frame: Frame, box: Box): boolean =>
    box.maxX >= frame.left &&
    box.minX <= frame.left + frame.width &&
    box.maxY >= frame.top &&
    box.minY <= frame.top + frame.height;
  const fits = (frame: Frame): boolean =>
    frame.left + frame.width <= pageWidth - MARGIN && !others.some((box) => overlaps(frame, box));
  if (fits(below)) return below;

  let beside: Frame = { left: line.maxX + 2 * gap, top: line.minY, width, height };
  // Each move clears at least one box, so this ends after one move per box at most.
  for (let moves = 0; moves < others.length; moves++) {
    const blocking = others.filter((box) => overlaps(beside, box));
    if (blocking.length === 0) break;
    beside = { ...beside, left: Math.max(...blocking.map((box) => box.maxX)) + gap };
  }
  return fits(beside) ? beside : below;
}
