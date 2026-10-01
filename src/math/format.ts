/** Digits kept when displaying a result. Doubles carry about 15 to 17. */
const SIGNIFICANT_DIGITS = 10;

/** Typographic minus, so a negative answer does not look like a hyphenated one. */
export const MINUS_SIGN = '−';

/**
 * Formats a result for display.
 *
 * Binary floating point cannot represent most decimal fractions, so `0.1 + 0.2` is
 * really 0.30000000000000004. Rounding to 10 significant digits removes that noise
 * while keeping far more precision than anyone writes by hand. Converting back through
 * `Number` then drops the trailing zeros that `toPrecision` pads with.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Undefined';

  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  if (rounded === 0) return '0'; // also catches -0, which would print as "-0"

  const magnitude = Math.abs(rounded);
  const sign = rounded < 0 ? MINUS_SIGN : '';

  if (magnitude >= 1e15 || magnitude < 1e-6) {
    const [mantissa, exponent] = magnitude.toExponential().split('e') as [string, string];
    const power = Number(exponent);
    return `${sign}${mantissa}×10^${power < 0 ? MINUS_SIGN : ''}${Math.abs(power)}`;
  }

  // Past 1e21 JavaScript switches to exponent notation by itself; below that, and above
  // 1e-7, `toString` is plain decimal with the shortest digits that round-trip.
  return sign + magnitude.toString();
}
