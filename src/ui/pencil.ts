/**
 * The machine's pencil: everything the notebook writes back onto the page, answers,
 * notes and graphs, is drawn in this hand, in the graphite of the paper's palette
 * (theme.ts).
 */

/** Kalam's light weight: nearer to a pencil line than the regular weight is. */
const FONT = '300 {size}px Kalam, "Segoe Print", "Bradley Hand", cursive';

export const font = (size: number): string => FONT.replace('{size}', String(size));
