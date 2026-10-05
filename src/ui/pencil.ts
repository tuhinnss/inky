/**
 * The machine's pencil: everything the notebook writes back onto the page, answers,
 * notes and graphs, is drawn in this graphite and this hand.
 */

/** Pencil graphite, as `r, g, b` for use with varying opacity. */
export const GRAPHITE = '74, 78, 87';

/** Kalam's light weight: nearer to a pencil line than the regular weight is. */
const FONT = '300 {size}px Kalam, "Segoe Print", "Bradley Hand", cursive';

export const font = (size: number): string => FONT.replace('{size}', String(size));
