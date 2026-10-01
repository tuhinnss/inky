import { describe, expect, it } from 'vitest';
import { formatNumber } from '../../src/math';

describe('formatNumber', () => {
  it('prints integers without a decimal point', () => {
    expect(formatNumber(30)).toBe('30');
    expect(formatNumber(1234567890)).toBe('1234567890');
  });

  it('hides binary floating-point noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3'); // 0.30000000000000004
    expect(formatNumber(0.1 * 3)).toBe('0.3'); // 0.30000000000000004
    expect(formatNumber(1.1 * 1.1)).toBe('1.21'); // 1.2100000000000002
    expect(formatNumber(0.7 + 0.1)).toBe('0.8'); // 0.7999999999999999
    expect(formatNumber(4.35 * 100)).toBe('435'); // 434.99999999999994
    expect(formatNumber(1 - 0.9)).toBe('0.1'); // 0.09999999999999998
  });

  it('rounds repeating decimals to 10 significant digits', () => {
    expect(formatNumber(1 / 3)).toBe('0.3333333333');
    expect(formatNumber(2 / 3)).toBe('0.6666666667');
    expect(formatNumber(10 / 3)).toBe('3.333333333');
    expect(formatNumber(22 / 7)).toBe('3.142857143');
  });

  it('drops trailing zeros', () => {
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(2.0)).toBe('2');
    expect(formatNumber(1.5e3)).toBe('1500');
  });

  it('uses a real minus sign for negatives', () => {
    expect(formatNumber(-7)).toBe('−7');
    expect(formatNumber(-0.25)).toBe('−0.25');
  });

  it('never prints negative zero', () => {
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(-1e-30 * 1e-300)).toBe('0');
    expect(formatNumber(0)).toBe('0');
  });

  it('switches to powers of ten for very large and very small values', () => {
    expect(formatNumber(1e15)).toBe('1×10^15');
    expect(formatNumber(1.5e21)).toBe('1.5×10^21');
    expect(formatNumber(-2.5e-9)).toBe('−2.5×10^−9');
    expect(formatNumber(999999999999999)).toBe('1×10^15'); // rounds up at 10 digits
  });

  it('keeps ordinary small and large values in plain decimal', () => {
    expect(formatNumber(0.000001)).toBe('0.000001');
    expect(formatNumber(123456789012)).toBe('123456789000'); // 10 significant digits
    expect(formatNumber(99999.99999)).toBe('99999.99999');
  });

  it('falls back to Undefined for non-finite values', () => {
    expect(formatNumber(Infinity)).toBe('Undefined');
    expect(formatNumber(-Infinity)).toBe('Undefined');
    expect(formatNumber(NaN)).toBe('Undefined');
  });
});
