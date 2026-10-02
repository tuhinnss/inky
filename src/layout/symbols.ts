import { unionBounds, type Bounds, type Stroke } from '../ink';
import { isFlat, lineHeight, measure, type StrokeMetrics } from './metrics';

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

  const isDot = (m: StrokeMetrics): boolean => Math.max(m.width, m.height) <= DOT_SIZE * height;
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

  const loose = attachDivisionDots(dots, groups);
  const symbols = [
    ...groups.map((group) => toSymbol(group.members, 'shape')),
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
