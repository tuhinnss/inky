/**
 * The pen's colours. Pure data, no DOM.
 *
 * All are dark enough to read on the paper and none is the pencil grey the notebook
 * writes its answers in, so what you wrote and what it worked out never look alike.
 */

export interface Ink {
  name: string;
  /** A CSS colour, as stored on each stroke. */
  value: string;
}

export const INKS: readonly Ink[] = [
  { name: 'Blue-black', value: '#1c2b6e' },
  { name: 'Black', value: '#1f2023' },
  { name: 'Blue', value: '#1f5fc4' },
  { name: 'Red', value: '#c2272d' },
  { name: 'Green', value: '#1d7a46' },
  { name: 'Purple', value: '#6b2fa3' },
];

/** Blue-black, the colour of the ink before there was a choice. */
export const DEFAULT_INK = INKS[0].value;

/** One of the inks, by value. Anything else gives the default, so a stroke is never invisible. */
export function inkFor(value: string): Ink {
  return INKS.find((ink) => ink.value === value.toLowerCase()) ?? INKS[0];
}
