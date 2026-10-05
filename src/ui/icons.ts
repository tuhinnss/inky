/**
 * Toolbar icons as inline SVG, so they need no network request and inherit the text
 * colour. All share one 24×24 grid and one stroke weight.
 */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  pen: svg(
    '<path d="M4 20l1.2-4.6L16.4 4.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8 4 20z"/><path d="M14.5 6.1l3.4 3.4"/>',
  ),
  /** A block eraser, tilted as if in use, rubbing along a line. On the eraser button. */
  eraser: svg(
    '<path d="M9 20.5h11"/><path d="M4.9 14.8l8.6-8.6a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8l-7.4 7.4a2 2 0 0 1-1.4.6H8.3a2 2 0 0 1-1.4-.6l-2-2a1.5 1.5 0 0 1 0-2.1z"/><path d="M9.6 10.1l5.3 5.3"/><path d="M5.6 15.5l3.4 3.4" stroke-width="3" opacity="0.35"/>',
  ),
  /** Removes a whole stroke at once: a pen stroke, struck through. */
  strokeEraser: svg('<path d="M3 14.5c3-7 6-7 9 0s6 7 9 0"/><path d="M5.5 4.5l13 15"/>'),
  /** Eraser rubbing out part of a line: the line has a gap. */
  pixelEraser: svg(
    '<path d="M3 20h4"/><path d="M17 20h4"/><path d="M9.2 16.8l-3-3a1.5 1.5 0 0 1 0-2.1l6.5-6.5a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1l-5.5 5.5H9.2z"/><path d="M9.5 8.9l5.6 5.6"/>',
  ),
  /** A lasso: a dashed loop with its rope trailing off. */
  lasso: svg(
    '<path d="M6.2 15.4C4.2 14.3 3 12.6 3 10.7 3 7 7 4 12 4s9 3 9 6.7-4 6.6-9 6.6c-1.2 0-2.3-.1-3.3-.4" stroke-dasharray="2.6 2.4"/><path d="M8.6 15.5c-1.6.4-2.4 1.6-1.9 2.8.6 1.4 2.6 1.4 3.2 0 .4-1-.3-2.4-1.3-2.8zM7.4 19.6c-.6 1-1.2 1.7-2.2 2.2"/>',
  ),
  /** A waste-paper basket, for deleting what the lasso holds. */
  trash: svg(
    '<path d="M4 7h16"/><path d="M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7"/><path d="M6 7l1 12.2a1 1 0 0 0 1 .8h8a1 1 0 0 0 1-.8L18 7"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
  ),
  undo: svg('<path d="M8 6L4 10l4 4"/><path d="M4 10h9.5a5.5 5.5 0 0 1 0 11H10"/>'),
  redo: svg('<path d="M16 6l4 4-4 4"/><path d="M20 10h-9.5a5.5 5.5 0 0 0 0 11H14"/>'),
  /** A speaker giving out sound: sound and vibration on. */
  sound: svg(
    '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.5a8 8 0 0 1 0 11"/>',
  ),
  /** The same speaker, silent: sound and vibration off. */
  muted: svg(
    '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/>',
  ),
  /** A fresh sheet: the page with its corner turned. */
  clear: svg(
    '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
  ),
} as const;

/**
 * A short flourish for the pen-size panel. Unlike the icons it is drawn at one SVG unit
 * per CSS pixel and takes its stroke width from the stylesheet, so its line is exactly as
 * thick as the pen will write.
 */
export const penSample =
  '<svg class="size-stroke" viewBox="0 0 150 60" width="150" height="60" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 38c20-26 36-26 56-8s38 18 62-10"/></svg>';
