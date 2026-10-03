import { drawScale, resolveBackingSize, type Position, type Size } from './coords';

/**
 * One canvas element, sized for the device and scaled so that drawing code can work in
 * page (CSS pixel) coordinates and never think about the device pixel ratio.
 *
 * The canvas is the size of the window, not of the pages, and shows whatever part of the
 * pages is scrolled into view. The scroll is part of its transform, so drawing code never
 * thinks about that either.
 */
export class CanvasLayer {
  readonly element: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private cssSize: Size = { width: 0, height: 0 };
  private scale: Position = { x: 1, y: 1 };
  private scrollTop = 0;

  constructor(className: string) {
    this.element = document.createElement('canvas');
    this.element.className = className;

    // A plain context, deliberately. The `desynchronized` hint would shave a frame of
    // latency off the layer under the pen, but on many Android tablets a canvas in that
    // mode cannot be transparent: it is composited as an opaque black sheet, and these
    // layers are stacked on top of the page.
    const ctx = this.element.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available in this browser');
    this.ctx = ctx;
  }

  get width(): number {
    return this.cssSize.width;
  }

  get height(): number {
    return this.cssSize.height;
  }

  /**
   * Sets the backing store for a CSS size and device pixel ratio.
   * Assigning `canvas.width` clears the canvas and resets its transform, so callers
   * must redraw afterwards.
   *
   * @param measured backing-store size as measured by the browser, when available.
   */
  resize(cssSize: Size, dpr: number, measured?: Size): void {
    const backing = resolveBackingSize(cssSize, dpr, measured);
    this.cssSize = cssSize;
    this.element.width = backing.width;
    this.element.height = backing.height;

    this.scale = drawScale(cssSize, backing);
    this.applyTransform();
  }

  /** The page coordinate at the top of the canvas. Callers must redraw afterwards. */
  get top(): number {
    return this.scrollTop;
  }

  setTop(scrollTop: number): void {
    this.scrollTop = scrollTop;
    this.applyTransform();
  }

  /** Clears everything on the canvas, wherever the transform currently points. */
  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.element.width, this.element.height);
    this.ctx.restore();
  }

  private applyTransform(): void {
    const { x, y } = this.scale;
    this.ctx.setTransform(x, 0, 0, y, 0, -this.scrollTop * y);
  }
}
