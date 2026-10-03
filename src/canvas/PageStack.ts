import { strokeBounds, type Stroke } from '../ink';
import type { Position } from './coords';
import {
  PAGE_GAP,
  PULL_TO_ADD,
  pageAt,
  pageHeightFor,
  pageTop,
  pagesFor,
  pullProgress,
  wheelPixels,
  type Pages,
} from './pageGeometry';

/** After this long with no pulling, the ring around the "+" empties again. */
const PULL_RELEASE_MS = 450;

/** The top of a stroke, which decides the page it is on. Strokes never change, so it is kept. */
const tops = new WeakMap<Stroke, number>();
function topOf(stroke: Stroke): number {
  let top = tops.get(stroke);
  if (top === undefined) {
    top = strokeBounds(stroke).minY;
    tops.set(stroke, top);
  }
  return top;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  return created;
}

/**
 * The pages of the notebook: sheets of paper stacked down a scrolling desk, and below the
 * last one a "+" for another.
 *
 * Only the paper is here. The ink is drawn on canvases the size of the window, laid over
 * this, which redraw for each scroll position: canvases as tall as every page together
 * would need hundreds of megabytes on a tablet.
 *
 * A page is added by pressing the "+", or by carrying on scrolling once it is in view: the
 * ring around it fills as you pull, and the page arrives when it is full. A page is only
 * added after one that has writing on it, so a fast spin of the wheel cannot stack up
 * blank pages.
 */
export class PageStack {
  /** The scrolling element. Strokes are in the coordinates of its content. */
  readonly element: HTMLElement;
  private readonly stack: HTMLElement;
  private readonly sheets: HTMLElement[] = [];
  private readonly end: HTMLElement;
  private readonly addButton: HTMLButtonElement;

  private pages: Pages = { height: 0, count: 1 };
  private strokes: readonly Stroke[] = [];
  private lastBlank = true;
  private pull = 0;
  private pullTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly scrollListeners = new Set<(scrollTop: number) => void>();
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private readonly reducedMotion: boolean;

  constructor(private readonly grid: number) {
    const signal = this.abort.signal;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.element = element('div', 'pages');
    this.stack = element('div', 'page-stack');
    this.element.style.setProperty('--page-gap', `${PAGE_GAP}px`);

    // The ring fills as you pull past the end. 157 is its circumference: 2π × 25.
    this.addButton = element('button', 'add-page');
    this.addButton.type = 'button';
    this.addButton.setAttribute('aria-label', 'Add a page');
    this.addButton.innerHTML =
      '<svg viewBox="0 0 56 56" width="56" height="56" fill="none" stroke-linecap="round" aria-hidden="true">' +
      '<circle class="add-ring" cx="28" cy="28" r="25"/>' +
      '<circle class="add-ring-fill" cx="28" cy="28" r="25" stroke-dasharray="157.08" transform="rotate(-90 28 28)"/>' +
      '<path class="add-plus" d="M28 18v20M18 28h20"/></svg>';
    this.addButton.addEventListener('click', () => this.addPage(), { signal });

    const note = element('span', 'add-page-note');
    this.end = element('div', 'page-end');
    this.end.append(this.addButton, note);

    this.stack.append(this.end);
    this.element.append(this.stack);
    this.render();

    this.element.addEventListener('scroll', this.onScrolled, { signal, passive: true });
    this.element.addEventListener('wheel', this.onWheel, { signal, passive: true });
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.element);
  }

  get scrollTop(): number {
    return this.element.scrollTop;
  }

  get count(): number {
    return this.pages.count;
  }

  /** The sheet of paper for page `index`, counted from 0. */
  sheet(index: number): HTMLElement {
    return this.sheets[index];
  }

  /** Whether a stroke may begin here: on a page, not in a gap or past the last one. */
  isWritable(at: Position): boolean {
    return pageAt(this.pages, at.y) !== null;
  }

  /** Called with the new scroll position whenever it changes. */
  onScroll(listener: (scrollTop: number) => void): () => void {
    this.scrollListeners.add(listener);
    return () => this.scrollListeners.delete(listener);
  }

  /**
   * Scrolls by `dy` pixels, as a two-finger drag does. Dragging on past the end pulls on
   * the "+" instead, the same as the wheel.
   */
  scrollBy(dy: number): void {
    const room = this.element.scrollHeight - this.element.clientHeight - this.element.scrollTop;
    if (dy > room) {
      this.element.scrollTop += room;
      this.pullBy(dy - Math.max(0, room));
    } else {
      this.element.scrollTop += dy;
    }
  }

  /**
   * Tells the stack what is written. There are always enough pages for the ink, and the
   * "+" is offered only below a page with writing on it.
   */
  setInk(strokes: readonly Stroke[]): void {
    this.strokes = strokes;
    if (this.pages.height === 0) return; // not measured yet; `fit` comes back here
    let needed = 1;
    for (const stroke of strokes) needed = Math.max(needed, pagesFor(this.pages, topOf(stroke)));
    if (needed > this.pages.count) {
      this.pages = { ...this.pages, count: needed };
      this.render();
    }
    this.lastBlank = !strokes.some((s) => pagesFor(this.pages, topOf(s)) === this.pages.count);
    this.showEnd();
  }

  /** Drops the pages after the last one with writing on it. For clearing the notebook. */
  trim(): void {
    let needed = 1;
    for (const stroke of this.strokes) {
      needed = Math.max(needed, pagesFor(this.pages, topOf(stroke)));
    }
    if (needed === this.pages.count) return;
    this.pages = { ...this.pages, count: needed };
    this.render();
    this.setInk(this.strokes);
  }

  /** Adds a page after the last and scrolls to it. Does nothing below a blank page. */
  addPage(): boolean {
    this.releasePull();
    if (this.lastBlank) return false;
    this.pages = { ...this.pages, count: this.pages.count + 1 };
    this.render();
    this.lastBlank = true;
    this.showEnd();
    this.element.scrollTo({
      top: pageTop(this.pages, this.pages.count - 1),
      behavior: this.reducedMotion ? 'auto' : 'smooth',
    });
    return true;
  }

  destroy(): void {
    this.abort.abort();
    this.resizeObserver.disconnect();
    clearTimeout(this.pullTimer);
    this.scrollListeners.clear();
    this.element.remove();
  }

  // -------------------------------------------------------------------- private

  /**
   * A single page is kept as tall as the window: it grows with it and, while nothing is
   * written yet, shrinks with it too. Once there is a second page the height stays, since
   * changing it would move the break between the two under the ink.
   */
  private fit(): void {
    if (this.pages.count > 1) return;
    const fitted = pageHeightFor(this.element.clientHeight, this.grid);
    const height = this.strokes.length > 0 ? Math.max(this.pages.height, fitted) : fitted;
    if (height === this.pages.height) return;
    this.pages = { ...this.pages, height };
    this.element.style.setProperty('--page-height', `${height}px`);
    this.setInk(this.strokes);
  }

  /** Makes one sheet of paper per page, each with its number pencilled in the corner. */
  private render(): void {
    while (this.sheets.length < this.pages.count) {
      const sheet = element('section', 'sheet');
      const number = element('span', 'page-number');
      number.textContent = String(this.sheets.length + 1);
      sheet.append(number);
      sheet.setAttribute('aria-label', `Page ${this.sheets.length + 1}`);
      this.end.before(sheet);
      this.sheets.push(sheet);
    }
    while (this.sheets.length > this.pages.count) this.sheets.pop()!.remove();
  }

  private showEnd(): void {
    this.end.dataset.blank = String(this.lastBlank);
    this.addButton.disabled = this.lastBlank;
    const note = this.end.querySelector('.add-page-note')!;
    note.textContent = this.lastBlank ? 'Write on this page first' : 'New page';
  }

  private readonly onScrolled = (): void => {
    const top = this.element.scrollTop;
    if (!this.atEnd()) this.releasePull();
    for (const listener of this.scrollListeners) listener(top);
  };

  /** At the end there is nothing left to scroll, so the wheel pulls on the "+" instead. */
  private readonly onWheel = (event: WheelEvent): void => {
    if (event.deltaY <= 0 || !this.atEnd()) return;
    this.pullBy(wheelPixels(event.deltaY, event.deltaMode, this.element.clientHeight));
  };

  private atEnd(): boolean {
    const { scrollTop, scrollHeight, clientHeight } = this.element;
    return scrollTop + clientHeight >= scrollHeight - 1;
  }

  private pullBy(distance: number): void {
    if (this.lastBlank || distance <= 0) return;
    this.pull += distance;
    if (this.pull >= PULL_TO_ADD) {
      this.addPage();
      return;
    }
    this.end.style.setProperty('--pull', String(pullProgress(this.pull)));
    clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => this.releasePull(), PULL_RELEASE_MS);
  }

  private releasePull(): void {
    clearTimeout(this.pullTimer);
    if (this.pull === 0) return;
    this.pull = 0;
    this.end.style.setProperty('--pull', '0');
  }
}
