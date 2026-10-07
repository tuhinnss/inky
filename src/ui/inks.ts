/**
 * The pen's colours. Pure data, no DOM.
 *
 * All are dark enough to read on the paper and none is the pencil grey the notebook
 * writes its answers in, so what you wrote and what it worked out never look alike.
 *
 * On dark paper each is drawn in a light partner instead, as a notes app turns black ink
 * white at night. A stroke keeps the colour it was written in, whatever the theme, so
 * switching back and forth changes nothing that is stored.
 */

import type { Theme } from './theme';

export interface Ink {
  name: string;
  /** A CSS colour, as stored on each stroke. */
  value: string;
  /** The colour it is drawn in on dark paper. */
  dark: string;
}

export const INKS: readonly Ink[] = [
  { name: 'Blue-black', value: '#1c2b6e', dark: '#aebdff' },
  { name: 'Black', value: '#1f2023', dark: '#eceef2' },
  { name: 'Blue', value: '#1f5fc4', dark: '#74a9ff' },
  { name: 'Red', value: '#c2272d', dark: '#ff8a8e' },
  { name: 'Green', value: '#1d7a46', dark: '#6fd49a' },
  { name: 'Purple', value: '#6b2fa3', dark: '#c9a2ff' },
];

/** Blue-black, the colour of the ink before there was a choice. */
export const DEFAULT_INK = INKS[0].value;

/** One of the inks, by value. Anything else gives the default, so a stroke is never invisible. */
export function inkFor(value: string): Ink {
  return INKS.find((ink) => ink.value === value.toLowerCase()) ?? INKS[0];
}

/** The colour a stroke stored as `value` is drawn in on the paper of `theme`. */
export function inkOnPaper(value: string, theme: Theme): string {
  return theme === 'light' ? value : inkFor(value).dark;
}
