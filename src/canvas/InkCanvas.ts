import {
  EditBuilder,
  StrokeEdit,
  createStroke,
  eraseFromStroke,
  strokeIsHit,
  type History,
  type Point,
  type Stroke,
  type StrokeChange,
  type StrokeStore,
} from '../ink';
import { CanvasLayer } from './CanvasLayer';
import { clientToPage, sanitizeDpr, type Position, type Size } from './coords';
import { livePath, strokePath } from './strokePath';

export type Tool = 'pen' | 'stroke-eraser' | 'pixel-eraser';

export interface InkCanvasOptions {
  inkColor: string;
  penWidth: number;
  /** Radius of the eraser tip in CSS pixels. */
  eraserRadius: number;
}

/** What the pointer that is currently down is doing. */
interface Gesture {
  pointerId: number;
  tool: Tool;
  /** Pen: the samples so far. */
  points: Point[];
  simulatePressure: boolean;
  /** Erasers: where the tip was at the previous sample, and what it has removed. */
  last: Position;
  edits: EditBuilder;
}

/** Samples closer together than this add nothing but work. */
const MIN_SAMPLE_DISTANCE = 0.3;
/** After a pen lifts, touches are ignored for this long: it is nearly always a palm. */
const PALM_REJECTION_MS = 400;

/**
 * The drawing surface: three stacked canvases and the pointer handling that feeds them.
 *
 *   ink      finished strokes. Redrawn only when the page changes.
 *   live     the stroke under the pen and the eraser tip. Redrawn every frame while a
 *            pointer is down, and empty otherwise.
 *   overlay  answers and highlights. Drawn by the app, never by this class.
 *
 * Splitting them means the per-frame work while writing is clearing and filling one
 * small path, no matter how much ink is already on the page.
 */
export class InkCanvas {
  readonly overlay: CanvasLayer;
  private readonly ink: CanvasLayer;
  private readonly live: CanvasLayer;

  private tool: Tool = 'pen';
  private penWidth: number;
  private readonly inkColor: string;
  private readonly eraserRadius: number;

  private gesture: Gesture | null = null;
  private hover: Position | null = null;
  private origin = { left: 0, top: 0 };
  private lastPenTime = -Infinity;

  private frame = 0;
  private inkDirty = false;
  private liveDirty = false;

  private readonly resizeObserver: ResizeObserver;
  private stopWatchingPixelRatio: () => void = () => {};
  private readonly removeListeners: Array<() => void> = [];
  private readonly activityListeners = new Set<(active: boolean) => void>();
  private readonly resizeListeners = new Set<() => void>();

  constructor(
    private readonly host: HTMLElement,
    private readonly store: StrokeStore,
    private readonly history: History,
    options: InkCanvasOptions,
  ) {
    this.inkColor = options.inkColor;
    this.penWidth = options.penWidth;
    this.eraserRadius = options.eraserRadius;

    this.ink = new CanvasLayer('layer layer-ink');
    this.live = new CanvasLayer('layer layer-live', { lowLatency: true });
    this.overlay = new CanvasLayer('layer layer-overlay');
    host.append(this.ink.element, this.overlay.element, this.live.element);

    this.listen(host, 'pointerdown', this.onPointerDown);
    this.listen(host, 'pointermove', this.onPointerMove);
    this.listen(host, 'pointerup', this.onPointerUp);
    this.listen(host, 'pointercancel', this.onPointerCancel);
    this.listen(host, 'pointerleave', this.onPointerLeave);
    // Long-press and right-click menus have no place on a writing surface.
    this.listen(host, 'contextmenu', (event) => event.preventDefault());
    // Scrolling moves the canvas under a stationary pointer.
    this.listen(window, 'scroll', this.measureOrigin, { passive: true });

    this.removeListeners.push(this.store.subscribe(this.onStoreChange));

    this.resizeObserver = new ResizeObserver((entries) => this.onResize(entries[0]));
    try {
      // Also reports the size in real device pixels, which settles sub-pixel rounding.
      this.resizeObserver.observe(host, { box: 'device-pixel-content-box' });
    } catch {
      this.resizeObserver.observe(host);
    }
    this.watchPixelRatio();
  }

  /**
   * The device pixel ratio changes when the user zooms the browser or drags the window
   * to a different monitor, often without the CSS size changing at all. A media query
   * for the current ratio stops matching at that moment; it has to be re-created each
   * time because the ratio it tests for is baked into the query.
   */
  private watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      this.applySize(this.size);
      this.watchPixelRatio();
    };
    query.addEventListener('change', onChange, { once: true });
    this.stopWatchingPixelRatio = () => query.removeEventListener('change', onChange);
  }

  get isDrawing(): boolean {
    return this.gesture !== null;
  }

  get size(): Size {
    return { width: this.ink.width, height: this.ink.height };
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.host.dataset.tool = tool;
    this.requestFrame('live');
  }

  setPenWidth(width: number): void {
    this.penWidth = width;
  }

  /** Called with `true` when a pointer goes down on the page and `false` when it lifts. */
  onActivity(listener: (active: boolean) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  /** Called after the canvases were resized and cleared, so the overlay can be redrawn. */
  onResized(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  /** Releases every listener, observer and pending frame. The instance is dead after this. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.stopWatchingPixelRatio();
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
    this.activityListeners.clear();
    this.resizeListeners.clear();
    this.ink.element.remove();
    this.live.element.remove();
    this.overlay.element.remove();
  }

  // ---------------------------------------------------------------- pointer input

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.gesture) return; // one pointer at a time; a second finger is ignored
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && event.timeStamp - this.lastPenTime < PALM_REJECTION_MS) {
      return;
    }

    // Keep receiving this pointer's events even if it leaves the canvas mid-stroke.
    this.host.setPointerCapture(event.pointerId);
    this.measureOrigin();

    const position = this.toPage(event);
    // Button 5 / bit 32 is the eraser end of a stylus.
    const penEraser =
      event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
    const tool = penEraser ? 'stroke-eraser' : this.tool;

    this.gesture = {
      pointerId: event.pointerId,
      tool,
      points: [],
      simulatePressure: event.pointerType !== 'pen',
      last: position,
      edits: new EditBuilder(),
    };
    this.hover = position;

    if (tool === 'pen') this.addSample(event);
    else this.erase(position);

    for (const listener of this.activityListeners) listener(true);
    this.requestFrame('live');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture) {
      // Nothing is down: just track the pointer so the eraser tip can follow the mouse.
      if (event.pointerType !== 'touch' && this.tool !== 'pen') {
        this.measureOrigin();
        this.hover = this.toPage(event);
        this.requestFrame('live');
      }
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;

    // A display refreshes at 60 Hz but a pen can report at 240 Hz. The browser batches
    // the extra samples into one event; asking for them gives a smoother curve.
    const samples = event.getCoalescedEvents?.() ?? [];
    if (samples.length === 0) samples.push(event);

    for (const sample of samples) {
      if (gesture.tool === 'pen') this.addSample(sample);
      else this.erase(this.toPage(sample));
    }
    this.hover = this.toPage(event);
    this.requestFrame('live');
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.gesture?.pointerId) this.finishGesture(event, true);
  };

  /** The system took the pointer away (palm detected, app switch): keep nothing. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.gesture?.pointerId) this.finishGesture(event, false);
  };

  private readonly onPointerLeave = (): void => {
    if (this.gesture) return;
    this.hover = null;
    this.requestFrame('live');
  };

  private finishGesture(event: PointerEvent, commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (event.pointerType === 'pen') this.lastPenTime = event.timeStamp;
    if (event.pointerType === 'touch') this.hover = null;

    if (gesture.tool === 'pen') {
      if (commit && gesture.points.length > 0) {
        const stroke = createStroke(
          gesture.points,
          this.penWidth,
          this.inkColor,
          gesture.simulatePressure,
        );
        // The store notifies synchronously, so the stroke is on the ink layer before
        // the live layer is cleared below. There is no frame where it is on neither.
        this.history.execute(new StrokeEdit([], [stroke]));
      }
    } else {
      const edit = gesture.edits.build();
      if (!edit.isEmpty) {
        if (commit) this.history.record(edit);
        else edit.revert(this.store);
      }
    }

    this.drawLive();
    for (const listener of this.activityListeners) listener(false);
  }

  private addSample(event: PointerEvent): void {
    const gesture = this.gesture!;
    const { x, y } = this.toPage(event);
    const previous = gesture.points[gesture.points.length - 1];
    if (previous && Math.hypot(x - previous.x, y - previous.y) < MIN_SAMPLE_DISTANCE) return;
    gesture.points.push({ x, y, pressure: gesture.simulatePressure ? 0.5 : event.pressure });
  }

  private erase(position: Position): void {
    const gesture = this.gesture!;
    const from = gesture.last;
    gesture.last = position;

    const removed: Stroke[] = [];
    const added: Stroke[] = [];
    for (const stroke of this.store.all()) {
      if (gesture.tool === 'stroke-eraser') {
        if (strokeIsHit(stroke, from, position, this.eraserRadius)) removed.push(stroke);
      } else {
        const fragments = eraseFromStroke(stroke, from, position, this.eraserRadius);
        if (fragments) {
          removed.push(stroke);
          added.push(...fragments);
        }
      }
    }
    if (removed.length === 0) return;

    const change: StrokeChange = { removed, added };
    this.store.apply(change);
    gesture.edits.record(change);
  }

  private toPage(event: PointerEvent): Position {
    return clientToPage(event.clientX, event.clientY, this.origin);
  }

  private readonly measureOrigin = (): void => {
    const rect = this.host.getBoundingClientRect();
    this.origin = { left: rect.left, top: rect.top };
  };

  // -------------------------------------------------------------------- rendering

  private readonly onStoreChange = (change: StrokeChange): void => {
    const strokes = this.store.all();
    const appendedOnTop =
      change.removed.length === 0 &&
      change.added.every(
        (stroke, i) => strokes[strokes.length - change.added.length + i] === stroke,
      );

    if (appendedOnTop && !this.inkDirty) {
      // The common case, a newly drawn stroke: paint just that stroke, right now.
      for (const stroke of change.added) this.fillStroke(stroke);
    } else {
      this.requestFrame('ink');
    }
  };

  private requestFrame(layer: 'ink' | 'live'): void {
    if (layer === 'ink') this.inkDirty = true;
    else this.liveDirty = true;
    // At most one callback per display frame, however many pointer events arrive.
    this.frame ||= requestAnimationFrame(this.render);
  }

  private readonly render = (): void => {
    this.frame = 0;
    if (this.inkDirty) this.drawInk();
    if (this.liveDirty) this.drawLive();
  };

  private drawInk(): void {
    this.inkDirty = false;
    this.ink.clear();
    for (const stroke of this.store.all()) this.fillStroke(stroke);
  }

  private fillStroke(stroke: Stroke): void {
    this.ink.ctx.fillStyle = stroke.color;
    this.ink.ctx.fill(strokePath(stroke));
  }

  private drawLive(): void {
    this.liveDirty = false;
    this.live.clear();
    const ctx = this.live.ctx;
    const gesture = this.gesture;

    if (gesture?.tool === 'pen' && gesture.points.length > 0) {
      ctx.fillStyle = this.inkColor;
      ctx.fill(livePath(gesture.points, this.penWidth, gesture.simulatePressure));
      return;
    }

    const erasing = gesture ? gesture.tool !== 'pen' : this.tool !== 'pen';
    if (erasing && this.hover) {
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, this.eraserRadius, 0, Math.PI * 2);
      ctx.fillStyle = gesture ? 'rgba(232, 121, 140, 0.25)' : 'rgba(232, 121, 140, 0.12)';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(200, 80, 105, 0.9)';
      ctx.stroke();
    }
  }

  private onResize(entry: ResizeObserverEntry | undefined): void {
    if (!entry) return;
    const box = entry.devicePixelContentBoxSize?.[0];
    this.applySize(
      { width: entry.contentRect.width, height: entry.contentRect.height },
      box ? { width: box.inlineSize, height: box.blockSize } : undefined,
    );
  }

  private applySize(cssSize: Size, measured?: Size): void {
    const dpr = sanitizeDpr(window.devicePixelRatio);
    for (const layer of [this.ink, this.live, this.overlay]) layer.resize(cssSize, dpr, measured);
    this.measureOrigin();

    // Resizing cleared all three canvases. Redraw in this same task, before the browser
    // paints, so the ink never flashes away.
    this.drawInk();
    this.drawLive();
    for (const listener of this.resizeListeners) listener();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.removeListeners.push(() =>
      target.removeEventListener(type, handler as EventListener, options),
    );
  }
}
