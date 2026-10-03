/**
 * Where the pages of the notebook are. Pure functions, no DOM.
 *
 * The pages are stacked down one long surface, all the same height, with a gap between
 * each two. Strokes are stored in the coordinates of that surface, so a stroke on the third
 * page simply has a larger `y`; a page is only a stretch of it.
 */

/** Between two pages: one square of the grid, so every page starts on a ruling line. */
export const PAGE_GAP = 28;
/** A page is at least this tall, even in a short window. */
export const MIN_PAGE_HEIGHT = 560;
/** How far to pull past the end of the last page for a new one. */
export const PULL_TO_ADD = 140;

export interface Pages {
  /** Height of every page, in CSS pixels. */
  height: number;
  count: number;
}

/** A page as tall as the window, rounded up to whole squares of the grid. */
export function pageHeightFor(viewportHeight: number, grid: number): number {
  return Math.max(MIN_PAGE_HEIGHT, Math.ceil(viewportHeight / grid) * grid);
}

/** The distance from the top of one page to the top of the next. */
function pitch(pages: Pages): number {
  return pages.height + PAGE_GAP;
}

export function pageTop(pages: Pages, index: number): number {
  return index * pitch(pages);
}

/** From the top of the first page to the bottom of the last. */
export function pagesHeight(pages: Pages): number {
  return pages.count * pages.height + Math.max(0, pages.count - 1) * PAGE_GAP;
}

/** The page at height `y`, or null in a gap between two pages and outside them all. */
export function pageAt(pages: Pages, y: number): number | null {
  if (!(y >= 0)) return null;
  const index = Math.floor(y / pitch(pages));
  if (index >= pages.count || y - pageTop(pages, index) > pages.height) return null;
  return index;
}

/**
 * How many pages it takes for ink whose top is at `y` to be on one. Ink that begins in
 * the gap after a page is counted with that page.
 */
export function pagesFor(pages: Pages, y: number): number {
  return Math.max(1, Math.floor(Math.max(0, y) / pitch(pages)) + 1);
}

/** How full the ring around the "+" is, from 0 to 1, after pulling this far past the end. */
export function pullProgress(pull: number): number {
  return Math.min(1, Math.max(0, pull / PULL_TO_ADD));
}

/**
 * A wheel event's distance in CSS pixels. Most report pixels already; some mice report
 * lines, and a few devices whole pages.
 */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}
