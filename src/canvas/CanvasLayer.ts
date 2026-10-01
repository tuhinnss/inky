import { drawScale, resolveBackingSize, type Size } from './coords';

export interface LayerOptions {
  /**
   * Asks the browser to present this canvas without waiting for the compositor, which
   * removes a frame or so of latency. Worth it only for the layer under the pen tip.
   */
  lowLatency?: boolean;
}

/**
 * One canvas element, sized for the device and scaled so that drawing code can work in
 * page (CSS pixel) coordinates and never think about the device pixel ratio.
 */
export class CanvasLayer {
  readonly element: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private cssSize: Size = { width: 0, height: 0 };

  constructor(className: string, options: LayerOptions = {}) {
    this.element = document.createElement('canvas');
    this.element.className = className;

    const ctx = this.element.getContext('2d', {
      desynchronized: options.lowLatency === true,
    });
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

    const scale = drawScale(cssSize, backing);
    this.ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.cssSize.width, this.cssSize.height);
  }
}
