/**
 * Showing what the notebook read: which sum a tap points at, and how each symbol is
 * labelled. Pure functions, no DOM.
 */

import type { Equation } from '../app/equations';
import type { Bounds } from '../ink';
import type { Tilt } from '../layout';
import type { RecognisedSymbol } from '../recognition/model';

interface XY {
  x: number;
  y: number;
}

/** How far from the ink a tap still counts as on it, beyond half the pen width. */
const INK_SLACK = 6;

/**
 * A point on the page in a line's own level frame. A line written at an angle was turned
 * level to be read; its symbols, and the answer drawn for it, are in that frame.
 */
export function toLineFrame(at: XY, tilt: Tilt | undefined): XY {
  if (!tilt) return at;
  // The inverse of the turn the answer is drawn with.
  const dx = at.x - tilt.pivotX;
  const dy = at.y - tilt.pivotY;
  const cos = Math.cos(tilt.angle);
  const sin = Math.sin(tilt.angle);
  return { x: tilt.pivotX + dx * cos + dy * sin, y: tilt.pivotY - dx * sin + dy * cos };
}

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The index of the symbol whose ink is under the point, or -1. Only the ink itself
 * counts, not the empty corners of the symbol's box: a dot written beside a 7 is a decimal
 * point, and must stay one.
 */
export function symbolAt(equation: Equation, at: XY): number {
  const p = toLineFrame(at, equation.line.tilt);
  return equation.line.symbols.findIndex((symbol) =>
    symbol.strokes.some((stroke) => {
      const reach = stroke.width / 2 + INK_SLACK;
      const points = stroke.points;
      if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= reach;
      for (let i = 1; i < points.length; i++) {
        if (distanceToSegment(p, points[i - 1], points[i]) <= reach) return true;
      }
      return false;
    }),
  );
}

function inside(p: XY, box: Bounds): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

/**
 * The sum a tap points at: one whose symbols' ink or whose answer is under it. `answers`
 * holds where each answer was drawn, by equation id, in its line's frame.
 */
export function equationAt(
  equations: readonly Equation[],
  answers: ReadonlyMap<number, Bounds>,
  at: XY,
): Equation | null {
  for (const equation of equations) {
    const answer = answers.get(equation.id);
    if (answer && inside(toLineFrame(at, equation.line.tilt), answer)) return equation;
    if (symbolAt(equation, at) >= 0) return equation;
  }
  return null;
}

/** How a symbol is written in its label: the characters a person would write. */
export function labelFor(symbol: RecognisedSymbol): string {
  return symbol === '-' ? '−' : symbol;
}
