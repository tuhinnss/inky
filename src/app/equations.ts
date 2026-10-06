/**
 * From a laid-out line of symbols to an evaluated equation. Pure logic, no browser APIs.
 */

import type { Line } from '../layout';
import { compile, evaluate, EQUALS, SUPERSCRIPTS, VARIABLE, type Evaluation } from '../math';
import { interpret, type Reading } from '../recognition/interpret';
import type { Superscript } from '../recognition/model';
import { assembleColumn } from './columnSum';
import { GRAPH_VARIABLE, graphOf, hasGraphForm, readGraph, type Graph } from './graphs';
import { readPowers } from './powers';
import { equationIn, solve, type Solution } from './solve';
import { definitionOf, readVariables, type Definition } from './variables';

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
  /** Set when the line gives x a value, as in "x=10". Lines below then use it. */
  definition?: Definition;
  /** Set when the line asks for a graph, as in "y=2x+1". */
  graph?: Graph;
  /** Set when the line is an equation in x to solve, as in "x²-5x+6=0". */
  solution?: Solution;
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
    const interpreted = line.symbols.map((symbol) =>
      interpret(symbol, line, cache.get(symbol.key)),
    );
    const read = readPowers(
      interpreted.map((reading) => reading.symbol),
      line,
    );
    const symbols = readGraph(readVariables(read, { graph: hasGraphForm(read) }));
    // x, y and powers are read by their place on the line. x is a "×" the model was sure of
    // to some degree, and a power a digit; a y can be anything the model took it for, so
    // its reading says nothing.
    const readings = interpreted.map((reading, i): Reading => {
      const symbol = symbols[i];
      if (symbol === GRAPH_VARIABLE) return { symbol: GRAPH_VARIABLE, confidence: 1 };
      if (symbol === VARIABLE) return { ...reading, symbol: VARIABLE };
      if (SUPERSCRIPTS.includes(symbol)) return { ...reading, symbol: symbol as Superscript };
      return reading;
    });
    return { readings, expression: symbols.join('') };
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

function evaluateSafely(expression: string, values: ReadonlyMap<string, number>): Evaluation {
  try {
    return evaluate(expression, values);
  } catch (error) {
    // The math engine is written never to throw. This is the backstop that keeps one
    // bad line from taking the whole page down if that ever proves untrue.
    return {
      status: 'error',
      error: {
        code: 'unexpected-token',
        position: 0,
        message: error instanceof Error ? error.message : 'Could not evaluate this',
      },
    };
  }
}

/**
 * Reads and evaluates one line. The expression is evaluated only when it ends in "=",
 * which is how the writer says "I am done, work this out". Under a column sum the rule
 * says the same thing. A line that uses x is evaluated again by `evaluatePage`, which
 * knows the value x has there.
 */
export function readEquation(tracked: TrackedLine, cache: ProbabilityCache): Equation {
  const { readings, expression, sources } = readLine(tracked.line, cache);
  const evaluation = expression.endsWith(EQUALS) ? evaluateSafely(expression, new Map()) : null;

  return {
    ...tracked,
    readings,
    expression,
    ...(sources ? { sources } : {}),
    evaluation,
    confidence: readings.reduce((lowest, reading) => Math.min(lowest, reading.confidence), 1),
  };
}

/**
 * Works out every line of the page in reading order, so that each one sees the value of
 * x given nearest above it. A definition holds from its line down, the way a page is
 * read; a later one takes over from there, and `x = x + 1` uses the x above it.
 *
 * @param equations the page's lines, top to bottom.
 */
export function evaluatePage(equations: readonly Equation[]): Equation[] {
  const values = new Map<string, number>();
  return equations.map((equation): Equation => {
    if (equation.line.column) return equation;

    const graph = graphOf(equation.expression);
    if (graph) return withGraph(equation, graph);
    const misread = misreadGraph(equation, values);
    if (misread) return misread;

    const definition = definitionOf(equation.expression);
    if (definition) {
      const evaluation = evaluateSafely(definition.body, values);
      if (evaluation.status === 'ok') {
        values.set(definition.name, evaluation.value);
        return {
          ...equation,
          evaluation: null,
          definition: { name: definition.name, value: evaluation.value },
        };
      }
      // A definition that does not work out leaves x as it was, and what went wrong is
      // shown under it. Positions are moved from the part after "=" to the whole line.
      const offset = equation.expression.length - definition.body.length;
      if (evaluation.status === 'error') {
        const error = { ...evaluation.error, position: evaluation.error.position + offset };
        return { ...equation, evaluation: { ...evaluation, error } };
      }
      if (evaluation.status === 'undefined') {
        return {
          ...equation,
          evaluation: { ...evaluation, position: evaluation.position + offset },
        };
      }
      return { ...equation, evaluation };
    }

    const sides = equationIn(equation.expression);
    if (sides) {
      const solved = solve(sides.left, sides.right);
      return solved.ok
        ? { ...equation, evaluation: null, solution: solved.solution }
        : { ...equation, evaluation: { status: 'error', error: solved.error } };
    }

    if (!equation.expression.endsWith(EQUALS) || !equation.expression.includes(VARIABLE)) {
      return equation;
    }
    return { ...equation, evaluation: evaluateSafely(equation.expression, values) };
  });
}

/**
 * A graph's line, checked: the graph to draw, or what is wrong with its expression, at
 * its place in the line as written.
 */
function withGraph(equation: Equation, graph: Graph): Equation {
  const compiled = compile(graph.body);
  if (compiled.ok) return { ...equation, evaluation: null, graph };
  const offset = equation.expression.length - graph.body.length;
  const error = { ...compiled.error, position: compiled.error.position + offset };
  return { ...equation, evaluation: { status: 'error', error } };
}

/**
 * `x = …` using x, where x has no value above: not a definition, which could not be
 * worked out, but a graph whose y was read as "×" (see graphs.ts).
 */
function misreadGraph(equation: Equation, values: ReadonlyMap<string, number>): Equation | null {
  const definition = definitionOf(equation.expression);
  if (!definition || values.has(VARIABLE) || !definition.body.includes(VARIABLE)) return null;
  const readings = equation.readings.map((reading, i): Reading =>
    i === 0 ? { symbol: GRAPH_VARIABLE, confidence: 1 } : reading,
  );
  const expression = GRAPH_VARIABLE + equation.expression.slice(1);
  return withGraph({ ...equation, readings, expression }, { body: definition.body });
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
