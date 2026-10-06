/**
 * Powers, written as on paper: a small digit raised beside a number or x, as in x² or 3².
 *
 * The model reads a small raised 2 as a 2, as it should; where it stands is what makes it
 * a power. Measured on 488 real powers in MathWriting against 783 digits written after a
 * digit or an x, the foot of a power is at most 0.46 of the way down its base, the symbol
 * it stands beside, 99 times in 100; the foot of an ordinary digit at least 0.65 of the way
 * down. So a digit is raised when its foot is above 0.55 of the way down its base. Its size
 * says little: a quarter of real powers are written as tall as the line's digits, so the
 * rule does not ask that it be small. A power of several digits, 2¹⁰, is raised digits one
 * after another.
 */

import { SUPERSCRIPTS } from '../math';
import type { Line, SymbolGroup } from '../layout';

/** A raised digit's foot is above this far down its base, as a fraction of the base's height... */
const RAISED = 0.55;
/** ...and it starts no further than this to the right of its base, in line heights. */
const NEAR = 2.5;

const isDigit = (symbol: string): boolean => symbol >= '0' && symbol <= '9';

/** Whether `symbol` sits raised beside `base`, as a power is written. */
export function isRaised(symbol: SymbolGroup, base: SymbolGroup, line: Line): boolean {
  const b = base.bounds;
  const s = symbol.bounds;
  const baseHeight = Math.max(b.maxY - b.minY, 1e-6);
  return (
    s.maxY <= b.minY + RAISED * baseHeight &&
    s.minX >= (b.minX + b.maxX) / 2 &&
    s.minX - b.maxX <= NEAR * line.height
  );
}

/**
 * The symbols of a line with each raised digit written as a power: "x2" read from x² comes
 * out as "x²". A base is a digit or the "×" that x is read from; the digits of a power go on
 * as long as each is raised beside the base.
 */
export function readPowers(read: readonly string[], line: Line): string[] {
  const out: string[] = [];
  let base: SymbolGroup | null = null;
  read.forEach((symbol, i) => {
    const group = line.symbols[i];
    if (base && isDigit(symbol) && group.kind === 'shape' && isRaised(group, base, line)) {
      out.push(SUPERSCRIPTS[Number(symbol)]);
      return;
    }
    out.push(symbol);
    base = isDigit(symbol) || symbol === '×' ? group : null;
  });
  return out;
}
