/**
 * Tool sizes and where their slider goes. Pure functions, no DOM.
 */

export interface SizeRange {
  min: number;
  max: number;
  step: number;
  initial: number;
}

/** Pen width in CSS pixels. */
export const PEN_SIZE: SizeRange = { min: 1.5, max: 12, step: 0.5, initial: 4 };
/** Diameter of the eraser tip in CSS pixels. Both erasers share it. */
export const ERASER_SIZE: SizeRange = { min: 8, max: 80, step: 2, initial: 22 };

/** The nearest size the range allows. Anything that is not a number gives the initial size. */
export function snapSize(range: SizeRange, value: number): number {
  if (!Number.isFinite(value)) return range.initial;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  // Rounding removes the noise of adding binary fractions: 1.5 + 3 × 0.1 is not 1.8.
  return Number(Math.min(range.max, snapped).toFixed(4));
}

/** `value` moved by a number of steps, staying inside the range. */
export function stepSize(range: SizeRange, value: number, steps: number): number {
  return snapSize(range, snapSize(range, value) + steps * range.step);
}

export function sizeLabel(value: number): string {
  return `${value} px`;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Space left between the panel and its button, and between the panel and the screen edge. */
const GAP = 10;
const EDGE = 8;

/**
 * Where to put the size panel: beside its button, on the page side of the toolbar.
 *
 * The toolbar runs down the left margin on a wide screen and along the bottom on a narrow
 * one, so the panel opens to the right in the first case and upwards in the second. Either
 * way it is then pushed back inside the viewport if it would cross an edge.
 */
export function placePanel(
  button: Box,
  toolbar: Box,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const alongBottom = toolbar.width > toolbar.height;
  const left = alongBottom
    ? button.left + button.width / 2 - panel.width / 2
    : toolbar.left + toolbar.width + GAP;
  const top = alongBottom
    ? toolbar.top - GAP - panel.height
    : button.top + button.height / 2 - panel.height / 2;

  const within = (value: number, room: number): number =>
    Math.max(EDGE, Math.min(value, room - EDGE));
  return {
    left: within(left, viewport.width - panel.width),
    top: within(top, viewport.height - panel.height),
  };
}
