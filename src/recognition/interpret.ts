/**
 * Decides what a symbol is, from two sources of evidence: the model's probabilities and
 * the symbol's geometry.
 *
 * The model sees each symbol cropped and scaled to fill its frame. That is what makes
 * it insensitive to handwriting size, and it is also what it cannot see past: once
 * normalised, the image no longer says how big the symbol was, where on the line it
 * sat, or how many strokes it was written with. Geometry knows exactly those things.
 *
 * So the two are combined the way independent evidence should be. The model gives
 * P(symbol | image). Geometry gives a weight per symbol, P(shape | symbol): how
 * plausible this stroke arrangement is if the symbol really were that one. The product,
 * renormalised, is the final distribution, and its largest value is the confidence.
 * Geometry never overrules the model outright; a weight only scales its opinion. The one
 * exception is the decimal point, which geometry decides alone (see ARCHITECTURE.md).
 */

import { crossingPoint, distance, pathLength, type Stroke } from '../ink';
import { isFlat, measure, type Line, type StrokeMetrics, type SymbolGroup } from '../layout';
import { MODEL_SYMBOLS, type ModelSymbol, type RecognisedSymbol } from './model';

export interface Reading {
  symbol: RecognisedSymbol;
  /** 0 to 1. For model symbols, the fused probability of `symbol`. */
  confidence: number;
}

/** The stroke arrangements that geometry can recognise by itself. */
export type Shape = 'bar' | 'stacked-bars' | 'bar-with-dots' | 'cross' | 'other';

/** A dot at least this far down the line (0 = top, 1 = baseline) is a decimal point. */
const DECIMAL_ZONE = 0.55;

/** The bar of a cross is at least this many times wider than tall, its stem taller than wide. */
const CROSS_RATIO = 2;
/** A stroke is straight if its path is at most this many times the distance between its ends. */
const STRAIGHT = 1.25;
/** Bar and stem cross away from their ends: not within this fraction of either end. */
const CROSS_MARGIN = 0.1;

function isStraight(stroke: Stroke): boolean {
  const points = stroke.points;
  return pathLength(points) <= STRAIGHT * distance(points[0], points[points.length - 1]);
}

/** Where two strokes cross, or `null` if they do not. */
function crossing(a: Stroke, b: Stroke): { x: number; y: number } | null {
  for (let i = 1; i < a.points.length; i++) {
    for (let j = 1; j < b.points.length; j++) {
      const at = crossingPoint(a.points[i - 1], a.points[i], b.points[j - 1], b.points[j]);
      if (at) return at;
    }
  }
  return null;
}

/**
 * Two straight strokes, one flat and one upright, crossing near the middle of both: how
 * nearly every "+" is written. A "+" with a short bar can look like a "1" or a "4" to the
 * model; but a "4" is not made of two straight strokes, a "7" with a bar across has a bent
 * one, and the bar of a "1" or "5" sits at its end.
 */
function isCross(strokes: readonly StrokeMetrics[]): boolean {
  if (strokes.length !== 2) return false;
  const bar = strokes.find((m) => m.width >= CROSS_RATIO * m.height);
  const stem = strokes.find((m) => m.height >= CROSS_RATIO * m.width);
  if (!bar || !stem || bar === stem) return false;
  if (!isStraight(bar.stroke) || !isStraight(stem.stroke)) return false;
  const at = crossing(bar.stroke, stem.stroke);
  if (!at) return false;
  const along = (at.x - bar.minX) / bar.width;
  const down = (at.y - stem.minY) / stem.height;
  const inMiddle = (f: number): boolean => f >= CROSS_MARGIN && f <= 1 - CROSS_MARGIN;
  return inMiddle(along) && inMiddle(down);
}

export function shapeOf(symbol: SymbolGroup, line: Line): Shape {
  const strokes = symbol.strokes.map(measure);
  const isDot = (m: StrokeMetrics): boolean => Math.max(m.width, m.height) <= 0.22 * line.height;
  const bars = strokes.filter(isFlat);
  const dots = strokes.filter((m) => !isFlat(m) && isDot(m));
  const rest = strokes.length - bars.length - dots.length;

  if (isCross(strokes)) return 'cross';
  if (rest > 0) return 'other';
  if (bars.length === 1 && dots.length === 0) return 'bar';
  if (bars.length === 2 && dots.length === 0) return 'stacked-bars';
  if (bars.length === 1 && dots.length <= 2) return 'bar-with-dots';
  return 'other';
}

/**
 * P(shape | symbol), up to a constant: how likely each symbol is to be written as this
 * arrangement of strokes. Values are deliberately soft. A weight of 0.05 does not forbid
 * a reading; it means the model must be twenty times surer of it to win.
 */
const SHAPE_WEIGHTS: Readonly<Record<Shape, Partial<Record<ModelSymbol, number>>>> = {
  // One flat stroke is a minus sign.
  bar: { '-': 1 },
  // Two flat strokes, one above the other, are an equals sign.
  'stacked-bars': { '=': 1 },
  // A flat stroke with a dot above or below is a division sign.
  'bar-with-dots': { '÷': 1 },
  // A flat and an upright stroke crossing in the middle are a plus sign. A "×" written
  // askew can look the same, and the model tells those two apart well, so it is spared.
  cross: { '+': 1, '×': 1 },
  // Anything else cannot be a symbol that consists only of flat strokes.
  other: { '-': 0.05, '=': 0.2 },
};

/** Weight for symbols a shape's table does not mention. */
const DEFAULT_WEIGHT: Readonly<Record<Shape, number>> = {
  bar: 0.05,
  'stacked-bars': 0.05,
  'bar-with-dots': 0.1,
  cross: 0.05,
  other: 1,
};

/** Fuses model probabilities with the geometric prior for `shape`. */
export function fuse(probabilities: ArrayLike<number>, shape: Shape): Reading {
  const weights = SHAPE_WEIGHTS[shape];
  let best = 0;
  let bestScore = -1;
  let total = 0;
  for (let i = 0; i < MODEL_SYMBOLS.length; i++) {
    const score = probabilities[i] * (weights[MODEL_SYMBOLS[i]] ?? DEFAULT_WEIGHT[shape]);
    total += score;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { symbol: MODEL_SYMBOLS[best], confidence: total > 0 ? bestScore / total : 0 };
}

/**
 * A lone dot is a decimal point if it sits low on the line. One floating higher up is
 * probably a stray mark; it is still read as a point, the only thing a dot can be, but
 * with low confidence so the interface can flag it.
 */
export function readDot(symbol: SymbolGroup, line: Line): Reading {
  const span = line.bounds.maxY - line.bounds.minY;
  if (span <= 0) return { symbol: '.', confidence: 0.3 };

  const centre = (symbol.bounds.minY + symbol.bounds.maxY) / 2;
  const position = (centre - line.bounds.minY) / span;
  return { symbol: '.', confidence: position >= DECIMAL_ZONE ? 0.95 : 0.3 };
}

/**
 * @param probabilities the model's output for this symbol. Not needed for dots, which
 *   are never sent to the model.
 */
export function interpret(
  symbol: SymbolGroup,
  line: Line,
  probabilities: ArrayLike<number> | undefined,
): Reading {
  if (symbol.kind === 'dot') return readDot(symbol, line);
  if (!probabilities) return { symbol: '-', confidence: 0 };
  return fuse(probabilities, shapeOf(symbol, line));
}
