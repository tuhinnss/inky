import { unionBounds, type Bounds, type Stroke } from '../ink';
import { groupIntoLines } from './lines';
import { isFlat, lineHeight, measure, median, type StrokeMetrics } from './metrics';
import { segmentLine, type Line, type SymbolGroup } from './symbols';

/** A rule is at least this wide, measured in digit heights of the rows above it. */
const MIN_RULE_WIDTH = 0.8;
/** A rule runs under at least this much of the widest row. */
const MIN_ROW_COVER = 0.6;
/** Rows of one column are at most this many digit heights apart. */
const MAX_ROW_GAP = 1.25;
/** How far a row may dip below the thing underneath it, in digit heights. */
const DIP = 0.25;
/** The middle part of a stroke's height that counts as "level with it". */
const INNER_BAND = 0.2;
/** A stroke further away than this many of its own heights is not a neighbour. */
const NEIGHBOUR_REACH = 1.5;
/** Two bars are pieces of one rule when they are this level and this close, in bar widths. */
const PIECE_LEVEL = 0.15;
const PIECE_GAP = 0.1;
/**
 * How far beside a row a stroke may stand and still belong to it, in digit heights. The
 * operator is written to the left of the digits, often beyond the end of the rule, so
 * the reach is longer on that side.
 */
const REACH_LEFT = 1.0;
const REACH_RIGHT = 0.75;
/** How far above or below a row's own extent a stroke beside it may be centred. */
const LEVEL = 0.2;

/** A line that may have been drawn under a column: one flat stroke, or a few end to end. */
interface Rule extends Bounds {
  pieces: StrokeMetrics[];
  width: number;
  centreY: number;
}

function toRule(pieces: StrokeMetrics[]): Rule {
  const bounds = pieces.map((m): Bounds => m).reduce(unionBounds);
  return {
    ...bounds,
    pieces,
    width: bounds.maxX - bounds.minX,
    centreY: median(pieces.map((m) => m.centreY)),
  };
}

/**
 * Is there writing level with this bar, beside it or across it?
 *
 * A minus sign has digits either side of it, the bars of an "=" have the sum to their
 * left, the bar of a "+" has its upright through it. A rule has none of that: it sits
 * below the row above and nothing stands next to it. Being level means the bar passes
 * through the middle of the other stroke's height, not merely near its top or bottom, so
 * a digit whose tail reaches down to the rule does not count.
 */
function isFlanked(bar: StrokeMetrics, all: readonly StrokeMetrics[]): boolean {
  return all.some((other) => {
    if (other === bar || isFlat(other)) return false;
    const inset = INNER_BAND * other.height;
    if (bar.centreY < other.minY + inset || bar.centreY > other.maxY - inset) return false;
    const gap = Math.max(other.minX, bar.minX) - Math.min(other.maxX, bar.maxX);
    return gap <= NEIGHBOUR_REACH * other.height;
  });
}

/**
 * Joins bars that continue one another into single rules: a long line is often drawn in
 * two goes. The bars of an "=" are one above the other, not end to end, and stay apart.
 */
function joinPieces(bars: readonly StrokeMetrics[]): Rule[] {
  const rules: Rule[] = [];
  for (const bar of [...bars].sort((a, b) => a.minX - b.minX)) {
    const continued = rules.find((rule) => {
      const narrower = Math.min(rule.width, bar.width);
      return (
        Math.abs(rule.centreY - bar.centreY) <= PIECE_LEVEL * narrower &&
        bar.minX - rule.maxX <= PIECE_GAP * narrower
      );
    });
    if (continued) Object.assign(continued, toRule([...continued.pieces, bar]));
    else rules.push(toRule([bar]));
  }
  return rules;
}

/** Two flat strokes and nothing else: the shape of an "=". */
function looksLikeEquals(symbol: SymbolGroup): boolean {
  return symbol.strokes.length === 2 && symbol.strokes.every((stroke) => isFlat(measure(stroke)));
}

/**
 * Adds to a row the strokes that stand beside it: level with it and within reach. Mostly
 * that is the operator, written left of the digits where the rule may not reach.
 */
function withNeighbours(
  row: readonly StrokeMetrics[],
  beside: readonly StrokeMetrics[],
): StrokeMetrics[] {
  const members = [...row];
  const height = lineHeight(members);
  const { minY, maxY } = members.map((m): Bounds => m).reduce(unionBounds);
  let minX = Math.min(...members.map((m) => m.minX));
  let maxX = Math.max(...members.map((m) => m.maxX));

  for (let grown = true; grown;) {
    grown = false;
    for (const m of beside) {
      if (members.includes(m)) continue;
      if (m.centreY < minY - LEVEL * height || m.centreY > maxY + LEVEL * height) continue;
      if (minX - m.maxX > REACH_LEFT * height || m.minX - maxX > REACH_RIGHT * height) continue;
      members.push(m);
      minX = Math.min(minX, m.minX);
      maxX = Math.max(maxX, m.maxX);
      grown = true;
    }
  }
  return members;
}

/**
 * The rows stacked on a rule, nearest first.
 *
 * Only the ink directly over the rule is looked at to begin with, grouped into lines by
 * itself. That keeps the rows apart whatever is written beside the column: an equation
 * to the right, level with two rows at once, would otherwise tie them into one line.
 * Each row then takes in what stands close beside it.
 *
 * Starting at the rule, the climb goes from row to row for as long as each is directly
 * above the last and close enough to be part of the same sum. It ends at a gap, at
 * another rule, or at a line that is an equation in its own right.
 */
function rowsAbove(
  rule: Rule,
  free: readonly StrokeMetrics[],
  rules: readonly Rule[],
  claimed: ReadonlySet<Stroke>,
): Line[] {
  const available = free.filter((m) => !claimed.has(m.stroke));
  const over = new Set(
    available.filter((m) => m.centreY < rule.centreY && m.maxX >= rule.minX && m.minX <= rule.maxX),
  );
  const beside = available.filter((m) => !over.has(m));

  const above = groupIntoLines([...over].map((m) => m.stroke))
    .map((strokes) => withNeighbours(strokes.map(measure), beside))
    .map((members) => segmentLine(members.map((m) => m.stroke)))
    .sort((a, b) => b.bounds.maxY - a.bounds.maxY);

  const rows: Line[] = [];
  let floor = rule.centreY; // the top of whatever the next row has to sit on
  for (const row of above) {
    const dip = row.bounds.maxY - floor;
    if (dip > DIP * row.height) continue; // beside the previous row, not above it
    if (row.symbols.some(looksLikeEquals)) break;

    const yardstick = Math.max(row.height, rows[rows.length - 1]?.height ?? 0);
    if (-dip > MAX_ROW_GAP * yardstick) break;

    const ceiling = row.bounds.maxY;
    const below = floor;
    const interrupted = rules.some(
      (other) =>
        other !== rule &&
        other.centreY > ceiling &&
        other.centreY < below &&
        Math.min(other.maxX, rule.maxX) > Math.max(other.minX, rule.minX),
    );
    if (interrupted) break;

    rows.push(row);
    floor = row.bounds.minY;
  }
  return rows;
}

/** A rule with at least two rows on it, long enough to be meant as one. */
function isColumn(rule: Rule, rows: readonly Line[]): boolean {
  if (rows.length < 2) return false;
  const height = median(rows.map((row) => row.height));
  const widest = Math.max(...rows.map((row) => row.bounds.maxX - row.bounds.minX));
  return rule.width >= MIN_RULE_WIDTH * height && rule.width >= MIN_ROW_COVER * widest;
}

function toColumnLine(rule: Rule, rowsNearestFirst: readonly Line[]): Line {
  const rows = [...rowsNearestFirst].reverse();
  const strokes = rule.pieces.map((m) => m.stroke).sort((a, b) => a.id - b.id);
  const symbol: SymbolGroup = {
    strokes,
    kind: 'rule',
    bounds: { minX: rule.minX, minY: rule.minY, maxX: rule.maxX, maxY: rule.maxY },
    key: strokes.map((stroke) => stroke.id).join(','),
  };
  return {
    symbols: [...rows.flatMap((row) => row.symbols), symbol],
    bounds: [...rows.map((row) => row.bounds), symbol.bounds].reduce(unionBounds),
    height: median(rows.map((row) => row.height)),
    column: { rows, rule: symbol },
  };
}

const strokesIn = (lines: readonly Line[]): Stroke[] =>
  lines.flatMap((line) => line.symbols.flatMap((symbol) => symbol.strokes));

/**
 * Everything on the page as lines of symbols, top to bottom, with sums written as a
 * column recognised as such.
 *
 *        8
 *        7
 *     +  3
 *     ‾‾‾‾‾
 *
 * A column is found by its rule. The rule cannot be treated as an ordinary stroke: lying
 * under a whole row, it would be merged with every symbol above it. So flat strokes that
 * could be rules are looked at first. Each is checked for rows stacked above it; those
 * that have them become columns, and the rule and the rows are taken off the page. What
 * is left is laid out as ordinary lines of writing.
 *
 * A candidate that turns out not to be a rule changes what the others may claim, so the
 * search is repeated without it. The set of candidates only ever shrinks, which bounds
 * the repeats; in practice there are none or one.
 */
export function layoutPage(strokes: readonly Stroke[]): Line[] {
  const metrics = strokes.map(measure);
  let rules = joinPieces(metrics.filter((m) => isFlat(m) && !isFlanked(m, metrics)));

  for (;;) {
    if (rules.length === 0) return groupIntoLines(strokes).map(segmentLine);

    const inRule = new Set(rules.flatMap((rule) => rule.pieces));
    const free = metrics.filter((m) => !inRule.has(m));

    const claimed = new Set<Stroke>();
    const columns: Array<{ rule: Rule; rows: Line[] }> = [];
    for (const rule of rules) {
      const rows = rowsAbove(rule, free, rules, claimed);
      if (!isColumn(rule, rows)) continue;
      columns.push({ rule, rows });
      for (const stroke of strokesIn(rows)) claimed.add(stroke);
    }
    if (columns.length < rules.length) {
      rules = columns.map(({ rule }) => rule);
      continue;
    }

    const rest = free.filter((m) => !claimed.has(m.stroke)).map((m) => m.stroke);
    return [
      ...groupIntoLines(rest).map(segmentLine),
      ...columns.map(({ rule, rows }) => toColumnLine(rule, rows)),
    ].sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX);
  }
}
