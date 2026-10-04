import { unionBounds, type Bounds, type Stroke } from '../ink';
import { isFlat, lineHeight, measure, type StrokeMetrics } from './metrics';
import type { Tilt } from './tilt';

/** One handwritten symbol: the strokes that make it up, and where it is. */
export interface SymbolGroup {
  /** In drawing order. */
  strokes: Stroke[];
  bounds: Bounds;
  /**
   * `dot`: a single tiny mark on its own. `rule`: the line drawn under a column sum.
   * `shape`: everything else. Only shapes are sent to the model; dots and rules are
   * recognised by geometry alone (see ARCHITECTURE.md, "The decimal point").
   */
  kind: 'dot' | 'shape' | 'rule';
  /**
   * Identifies this exact ink. Strokes are immutable and ids are never reused, so two
   * symbols with the same key are guaranteed to look the same, and a recognition
   * result can be cached against it.
   */
  key: string;
}

export interface Line {
  /** Left to right. For a column sum: row by row, top to bottom, then the rule. */
  symbols: SymbolGroup[];
  bounds: Bounds;
  /** Typical height of a digit on this line, in CSS px. The yardstick for everything. */
  height: number;
  /**
   * Set when this is a sum written as a column: numbers stacked one above the other
   * with a rule drawn underneath. Each row is a line in its own right.
   */
  column?: Column;
  /**
   * Set when the line was written at an angle and has been turned level to be read.
   * Everything else here, the bounds and the strokes of every symbol, is then in the
   * line's own level frame; this says how that frame sits on the page.
   */
  tilt?: Tilt;
}

export interface Column {
  /** Top to bottom. */
  rows: Line[];
  /** The line drawn under the last row. It plays the part of the "=". */
  rule: SymbolGroup;
}

/** A mark no larger than this fraction of the line height is a dot. */
const DOT_SIZE = 0.22;
/** Strokes narrower than this fraction of the line height are widened before comparing. */
const MIN_WIDTH = 0.1;
/** Two strokes are one symbol when they share this much of the narrower one's width. */
const OVERLAP = 0.4;
/**
 * A small mark at least this many times wider than tall, and higher on the line than a
 * decimal point sits, is a short minus sign rather than a dot.
 */
const DASH_RATIO = 2.5;
/** ...and at least this long, as a fraction of the line height. A dot can be a short tick. */
const DASH_LENGTH = 0.13;
/** Below this fraction of the line's height a small mark is low enough to be a point. */
const POINT_ZONE = 0.55;

interface Group {
  members: StrokeMetrics[];
  minX: number;
  maxX: number;
}

/** Horizontal extent used for overlap tests, with very thin strokes widened. */
function span(m: StrokeMetrics, minWidth: number): [number, number] {
  if (m.width >= minWidth) return [m.minX, m.maxX];
  return [m.centreX - minWidth / 2, m.centreX + minWidth / 2];
}

/**
 * Which side of a bar a dot sits on, if it sits directly above or below it as in "÷".
 * A dot beside the bar, or far from it, belongs to something else.
 */
function sideOfBar(dot: StrokeMetrics, bar: StrokeMetrics): 'above' | 'below' | null {
  const slack = 0.1 * bar.width;
  const offset = dot.centreY - bar.centreY;
  const overBar = dot.centreX >= bar.minX - slack && dot.centreX <= bar.maxX + slack;
  if (!overBar || offset === 0 || Math.abs(offset) > 0.9 * bar.width) return null;
  return offset < 0 ? 'above' : 'below';
}

/**
 * Hands each dot to the bar it completes into a "÷", and returns the dots left over.
 * Only a bar that is a symbol by itself qualifies (not one bar of "=" or of "+"), and it
 * takes at most one dot on each side.
 */
function attachDivisionDots(dots: StrokeMetrics[], groups: Group[]): StrokeMetrics[] {
  const bars = groups
    .filter((group) => group.members.length === 1 && isFlat(group.members[0]))
    .map((group) => ({ group, bar: group.members[0], above: false, below: false }));

  return dots.filter((dot) => {
    for (const candidate of bars) {
      const side = sideOfBar(dot, candidate.bar);
      if (side && !candidate[side]) {
        candidate[side] = true;
        candidate.group.members.push(dot);
        return false;
      }
    }
    return true;
  });
}

function boundsOf(group: Group): Bounds {
  return group.members.map((m): Bounds => m).reduce(unionBounds);
}

/**
 * Whether `piece`, just left of `stem`, is the rest of the digit the stem belongs to.
 *
 * Many people write a 4 as an "L" and then a separate stroke down, and a 9 as a loop and
 * then a stem. The two strokes only touch, so they do not overlap enough to be grouped,
 * and the digit is read as "11", "01" or "61". The piece is recognisable: shorter than
 * the stem, level with its top, right against it, and not just a bar or two (a "-1" or
 * "=1" must stay two symbols).
 */
function completesStem(piece: Group, stem: Group, height: number): boolean {
  if (stem.members.length !== 1) return false;
  const s = boundsOf(stem);
  const p = boundsOf(piece);
  const stemHeight = s.maxY - s.minY;
  const pieceHeight = p.maxY - p.minY;
  return (
    s.maxX - s.minX <= 0.25 * height &&
    stemHeight >= 0.7 * height &&
    !piece.members.every(isFlat) &&
    pieceHeight >= 0.25 * height &&
    pieceHeight <= 0.75 * stemHeight &&
    p.minY <= s.minY + 0.2 * stemHeight &&
    s.minX - p.maxX <= 0.12 * height
  );
}

/**
 * Whether a lone bar is the flag of the digit just left of it. A 5 is often written as
 * a body and then a separate flag across its top; the flag sits at the top of the digit,
 * where a minus sign never does.
 */
function isFlagOf(bar: Group, digit: Group, height: number): boolean {
  if (bar.members.length !== 1 || !isFlat(bar.members[0])) return false;
  const b = boundsOf(bar);
  const d = boundsOf(digit);
  const digitHeight = d.maxY - d.minY;
  return (
    !digit.members.every(isFlat) &&
    digitHeight >= 0.6 * height &&
    (b.minY + b.maxY) / 2 <= d.minY + 0.2 * digitHeight &&
    b.minX >= d.minX &&
    b.minX - d.maxX <= 0.15 * height
  );
}

/** Puts back together the digits that people write in two strokes side by side. */
function joinBrokenDigits(groups: Group[], height: number): Group[] {
  const joined: Group[] = [];
  for (const group of groups) {
    const previous = joined[joined.length - 1];
    if (previous && (completesStem(previous, group, height) || isFlagOf(group, previous, height))) {
      previous.members.push(...group.members);
      previous.minX = Math.min(previous.minX, group.minX);
      previous.maxX = Math.max(previous.maxX, group.maxX);
      continue;
    }
    joined.push(group);
  }
  return joined;
}

function toSymbol(members: StrokeMetrics[], kind: SymbolGroup['kind']): SymbolGroup {
  const strokes = members.map((m) => m.stroke).sort((a, b) => a.id - b.id);
  return {
    strokes,
    kind,
    bounds: members.map((m): Bounds => m).reduce(unionBounds),
    key: strokes.map((stroke) => stroke.id).join(','),
  };
}

/**
 * Splits one line of strokes into symbols, left to right.
 *
 * The rule is horizontal overlap. Strokes of one symbol sit on top of each other: the
 * two bars of "+", the two diagonals of "×", the bars of "=", the stem and flag of "4".
 * Strokes of neighbouring symbols sit side by side. So strokes that share enough of
 * their horizontal extent are merged, and those that do not are kept apart.
 *
 * Dots are the exception, handled separately: a decimal point written under the
 * overhang of a "7" overlaps it horizontally but is not part of it, and the dots of a
 * "÷" must be attached to their bar although nothing else joins them to it.
 */
export function segmentLine(strokes: readonly Stroke[]): Line {
  const metrics = strokes.map(measure);
  const height = lineHeight(metrics);

  const top = Math.min(...metrics.map((m) => m.minY));
  const depth = Math.max(...metrics.map((m) => m.maxY)) - top;
  // A small mark is a dot, unless it is a short dash up in the middle of the line: that
  // is a minus sign written small, which a decimal point, sitting low, never is.
  const isShortDash = (m: StrokeMetrics): boolean =>
    m.width >= DASH_RATIO * m.height &&
    m.width >= DASH_LENGTH * height &&
    depth > 0 &&
    (m.centreY - top) / depth < POINT_ZONE;
  const isDot = (m: StrokeMetrics): boolean =>
    Math.max(m.width, m.height) <= DOT_SIZE * height && !isShortDash(m);
  const dots = metrics.filter(isDot);
  const shapes = metrics.filter((m) => !isDot(m)).sort((a, b) => a.minX - b.minX);

  // Sweep left to right, merging each stroke into the group it overlaps.
  const groups: Group[] = [];
  const minWidth = MIN_WIDTH * height;
  for (const m of shapes) {
    const [minX, maxX] = span(m, minWidth);
    const current = groups[groups.length - 1];
    if (current) {
      const shared = Math.min(current.maxX, maxX) - Math.max(current.minX, minX);
      const narrower = Math.min(current.maxX - current.minX, maxX - minX);
      if (shared >= OVERLAP * narrower) {
        current.members.push(m);
        current.maxX = Math.max(current.maxX, maxX);
        continue;
      }
    }
    groups.push({ members: [m], minX, maxX });
  }

  const joined = joinBrokenDigits(groups, height);
  const loose = attachDivisionDots(dots, joined);
  const symbols = [
    ...joined.map((group) => toSymbol(group.members, 'shape')),
    ...loose.map((dot) => toSymbol([dot], 'dot')),
  ];

  symbols.sort(
    (a, b) => a.bounds.minX + a.bounds.maxX - (b.bounds.minX + b.bounds.maxX), // by centre
  );

  return {
    symbols,
    height,
    bounds: metrics.map((m): Bounds => m).reduce(unionBounds),
  };
}
