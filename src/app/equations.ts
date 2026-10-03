/**
 * From a laid-out line of symbols to an evaluated equation. Pure logic, no browser APIs.
 */

import type { Line } from '../layout';
import { evaluate, EQUALS, type Evaluation } from '../math';
import { interpret, type Reading } from '../recognition/interpret';
import { assembleColumn } from './columnSum';

/** Model output per symbol, keyed by `SymbolGroup.key`. */
export type ProbabilityCache = ReadonlyMap<string, ArrayLike<number>>;

export interface Equation {
  /** Stable for as long as this line of writing exists, across edits. */
  id: number;
  /** Increases every time the line's ink changes. */
  version: number;
  line: Line;
  /** One per symbol, in the order of `line.symbols`. */
  readings: Reading[];
  /**
   * What was read: "18+4×3=". For a line of writing it has one character per symbol.
   * A column sum is written out on one line, which can add characters; `sources` then
   * says where each came from.
   */
  expression: string;
  /**
   * Column sums only: for each character of `expression`, the index of the symbol it
   * came from. Absent for a line of writing, where character n is simply symbol n.
   */
  sources?: number[];
  /** Null until the line ends with "=": there is nothing to answer yet. */
  evaluation: Evaluation | null;
  /** The weakest reading on the line. An answer is only as sure as its least sure symbol. */
  confidence: number;
}

export interface TrackedLine {
  id: number;
  version: number;
  line: Line;
}

/** True when every symbol that needs the model has a cached result. */
export function isReadable(line: Line, cache: ProbabilityCache): boolean {
  return line.symbols.every((symbol) => symbol.kind !== 'shape' || cache.has(symbol.key));
}

/** Reads each symbol and writes the line out as an expression. */
function readLine(
  line: Line,
  cache: ProbabilityCache,
): Pick<Equation, 'readings' | 'expression' | 'sources'> {
  if (!line.column) {
    const readings = line.symbols.map((symbol) => interpret(symbol, line, cache.get(symbol.key)));
    return { readings, expression: readings.map((reading) => reading.symbol).join('') };
  }

  // Each row is read as the line of writing it is, so that a decimal point is judged
  // against its own row and not against the whole column.
  const rows = line.column.rows.map((row) =>
    row.symbols.map((symbol) => interpret(symbol, row, cache.get(symbol.key))),
  );
  // The rule is what it is by position alone. It stands for the "=".
  const rule: Reading = { symbol: EQUALS, confidence: 1 };
  return {
    readings: [...rows.flat(), rule],
    ...assembleColumn(rows.map((row) => row.map((reading) => reading.symbol))),
  };
}

/**
 * Reads and evaluates one line. The expression is evaluated only when it ends in "=",
 * which is how the writer says "I am done, work this out". Under a column sum the rule
 * says the same thing.
 */
export function readEquation(tracked: TrackedLine, cache: ProbabilityCache): Equation {
  const { readings, expression, sources } = readLine(tracked.line, cache);

  let evaluation: Evaluation | null = null;
  if (expression.endsWith(EQUALS)) {
    try {
      evaluation = evaluate(expression);
    } catch (error) {
      // The math engine is written never to throw. This is the backstop that keeps one
      // bad line from taking the whole page down if that ever proves untrue.
      evaluation = {
        status: 'error',
        error: {
          code: 'unexpected-token',
          position: 0,
          message: error instanceof Error ? error.message : 'Could not evaluate this',
        },
      };
    }
  }

  return {
    ...tracked,
    readings,
    expression,
    ...(sources ? { sources } : {}),
    evaluation,
    confidence: readings.reduce((lowest, reading) => Math.min(lowest, reading.confidence), 1),
  };
}

interface Known {
  id: number;
  version: number;
  strokeIds: Set<number>;
  /** The line's symbol keys: changes exactly when its ink or its grouping does. */
  signature: string;
}

/**
 * Gives lines an identity that survives editing.
 *
 * Layout is recomputed from scratch on every change and returns anonymous lines. To
 * know that "the second line" now is the same equation as before, each new line is
 * matched to the previous one it shares the most strokes with. A match keeps its id and
 * gets a new version if its ink changed; an unmatched line is a new equation.
 *
 * The (id, version) pair is what recognition requests are tagged with, so a result that
 * comes back for a line that has since changed can be recognised as stale and dropped.
 */
export class EquationTracker {
  private known: Known[] = [];
  private nextId = 1;

  update(lines: readonly Line[]): TrackedLine[] {
    const candidates = lines.map((line) => {
      const strokeIds = new Set(line.symbols.flatMap((s) => s.strokes.map((stroke) => stroke.id)));
      const signature = line.symbols.map((symbol) => symbol.key).join('|');
      return { line, strokeIds, signature };
    });

    // Score every (new line, previous line) pair by shared strokes, best first.
    const pairs: Array<{ candidate: number; known: Known; shared: number }> = [];
    candidates.forEach((candidate, index) => {
      for (const known of this.known) {
        let shared = 0;
        for (const id of candidate.strokeIds) if (known.strokeIds.has(id)) shared++;
        if (shared > 0) pairs.push({ candidate: index, known, shared });
      }
    });
    pairs.sort((a, b) => b.shared - a.shared);

    // Greedy assignment: each previous equation passes its identity to at most one line.
    const matched = new Map<number, Known>();
    const taken = new Set<Known>();
    for (const { candidate, known } of pairs) {
      if (matched.has(candidate) || taken.has(known)) continue;
      matched.set(candidate, known);
      taken.add(known);
    }

    const next: Known[] = [];
    const tracked = candidates.map(({ line, strokeIds, signature }, index): TrackedLine => {
      const previous = matched.get(index);
      const id = previous?.id ?? this.nextId++;
      const version = !previous
        ? 1
        : previous.signature === signature
          ? previous.version
          : previous.version + 1;
      next.push({ id, version, strokeIds, signature });
      return { id, version, line };
    });

    this.known = next;
    return tracked;
  }

  /** The current version of an equation, or undefined if it no longer exists. */
  versionOf(id: number): number | undefined {
    return this.known.find((known) => known.id === id)?.version;
  }
}
