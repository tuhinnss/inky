import { SELECTION_PAD } from '../canvas/InkCanvas';
import type { Size } from '../canvas/coords';
import type { Bounds } from '../ink';
import { icons } from './icons';

/** Space between the selection's dashed box and the bar, and between the bar and the edge. */
const GAP = 10;
const EDGE = 8;

/**
 * Where the bar goes, in the coordinates of the visible part of the page: above the right
 * end of the selection, or below it when there is no room above. Pure, for testing.
 *
 * @param box the selected ink, in page coordinates.
 * @param scrollTop how far the pages are scrolled.
 */
export function placeSelectionBar(
  box: Bounds,
  scrollTop: number,
  bar: Size,
  view: Size,
): { left: number; top: number } {
  const above = box.minY - SELECTION_PAD - scrollTop - GAP - bar.height;
  const below = box.maxY + SELECTION_PAD - scrollTop + GAP;
  const top = above >= EDGE ? above : below;
  const left = box.maxX + SELECTION_PAD - bar.width;
  const within = (value: number, room: number): number =>
    Math.max(EDGE, Math.min(value, room - EDGE));
  return { left: within(left, view.width - bar.width), top: within(top, view.height - bar.height) };
}

/** What can be done to the strokes the lasso holds, on a slip of paper beside them. */
export class SelectionBar {
  readonly element: HTMLElement;
  private readonly abort = new AbortController();

  constructor(onDelete: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'selection-bar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Selection');
    this.element.hidden = true;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Delete the selection (Delete)';
    remove.innerHTML = `${icons.trash}<span>Delete</span>`;
    remove.addEventListener('click', onDelete, { signal: this.abort.signal });
    this.element.append(remove);
  }

  /** Shows the bar beside the selection, or hides it when there is none to show. */
  show(box: Bounds | null, scrollTop: number, view: Size): void {
    this.element.hidden = box === null;
    if (!box) return;
    const bar = { width: this.element.offsetWidth, height: this.element.offsetHeight };
    const at = placeSelectionBar(box, scrollTop, bar, view);
    this.element.style.transform = `translate(${at.left}px, ${at.top}px)`;
  }

  destroy(): void {
    this.abort.abort();
    this.element.remove();
  }
}
