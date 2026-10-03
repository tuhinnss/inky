/**
 * Lets the digit helpers vote.
 *
 * The main model decides what kind of symbol something is. When it says "a digit", two
 * small models that know only digits help decide which one. Each was trained on
 * different handwriting, so each fails on different shapes: the main model takes a `4`
 * written in one stroke for a `9`, which the helpers do not. Multiplying their opinions
 * together keeps the readings they agree on and settles the ones the main model alone
 * gets wrong.
 *
 * Pure logic: probabilities in, probabilities out.
 */

import { MODEL } from './model';

export const DIGIT_CLASSES = 10;
/** Keeps a helper's confident zero from vetoing a digit outright. */
const FLOOR = 1e-6;

export interface DigitOpinion {
  /** Ten scores, one per digit, in any positive scale; they are normalised here. */
  digits: ArrayLike<number>;
  /**
   * How much this opinion counts against the main model's weight of 1. Chosen on the
   * handwriting of 30 writers and checked on 14 others; see ARCHITECTURE.md.
   */
  weight: number;
}

/** Total probability the main model gives to the symbol being a digit at all. */
export function digitMass(probabilities: ArrayLike<number>, offset = 0): number {
  let mass = 0;
  for (let c = 0; c < DIGIT_CLASSES; c++) mass += probabilities[offset + c];
  return mass;
}

/**
 * Redistributes the probability the main model gave to digits, among the digits, by the
 * weighted product of every opinion. Rewrites the {@link MODEL.classes} values at `offset`.
 *
 * Only the digit block changes, and its total stays what it was. The helpers have no
 * say in whether a symbol is a digit or an operator, since they do not know operators.
 */
export function voteOnDigits(
  probabilities: Float32Array,
  offset: number,
  opinions: readonly DigitOpinion[],
): void {
  const mass = digitMass(probabilities, offset);
  if (mass <= 0) return;

  const logScore = new Float64Array(DIGIT_CLASSES);
  const add = (digits: ArrayLike<number>, from: number, weight: number): void => {
    let total = 0;
    for (let c = 0; c < DIGIT_CLASSES; c++) total += Math.max(digits[from + c], 0) + FLOOR;
    for (let c = 0; c < DIGIT_CLASSES; c++) {
      logScore[c] += weight * Math.log((Math.max(digits[from + c], 0) + FLOOR) / total);
    }
  };
  add(probabilities, offset, 1);
  for (const { digits, weight } of opinions) add(digits, 0, weight);

  let highest = -Infinity;
  for (const value of logScore) if (value > highest) highest = value;
  let total = 0;
  for (let c = 0; c < DIGIT_CLASSES; c++) {
    logScore[c] = Math.exp(logScore[c] - highest);
    total += logScore[c];
  }
  for (let c = 0; c < DIGIT_CLASSES; c++) probabilities[offset + c] = (mass * logScore[c]) / total;
}

/** Turns raw scores (logits) into probabilities, for a model that does not do it itself. */
export function softmax(scores: ArrayLike<number>, from = 0, count = scores.length): Float32Array {
  let highest = -Infinity;
  for (let i = 0; i < count; i++) if (scores[from + i] > highest) highest = scores[from + i];
  const out = new Float32Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    out[i] = Math.exp(scores[from + i] - highest);
    total += out[i];
  }
  for (let i = 0; i < count; i++) out[i] /= total;
  return out;
}

/** Whether a symbol is worth the helpers' time: the main model must allow it to be a digit. */
export function mayBeDigit(probabilities: ArrayLike<number>, index: number): boolean {
  return digitMass(probabilities, index * MODEL.classes) >= 0.02;
}
