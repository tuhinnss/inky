import {
  EditBuilder,
  StrokeEdit,
  createStroke,
  eraseFromStroke,
  inBox,
  inkBounds,
  moveStrokes,
  selectWithLasso,
  selectionBounds,
  strokeIsHit,
  type Bounds,
  type History,
  type Point,
  type Stroke,
  type StrokeChange,
  type StrokeStore,
} from '../ink';
import { CanvasLayer } from './CanvasLayer';
import { clientToPage, sanitizeDpr, type Position, type Size } from './coords';
import { isPalm, type PenState } from './palm';
import { livePath, strokePath } from './strokePath';

export type Tool = 'pen' | 'stroke-eraser' | 'pixel-eraser' | 'lasso';

/** Strokes being dragged with the lasso, and how far they have gone. */
export interface Drag {
  /** Ids of the strokes as they were when picked up. */
  ids: ReadonlySet<number>;
  dx: number;
  dy: number;
  /** Set on the last report: the strokes were put down there. */
  dropped: boolean;
}

function isEraser(tool: Tool): boolean {
  return tool === 'stroke-eraser' || tool === 'pixel-eraser';
}

export interface InkCanvasOptions {
  inkColor: string;
  penWidth: number;
  /** Radius of the eraser tip in CSS pixels. */
  eraserRadius: number;
  /** Whether the pen may start a stroke here. Everywhere, if not given. */
  isWritable?: (at: Position) => boolean;
  /** Scrolls the pages by this many pixels, for a drag with two fingers. */
  scrollBy?: (dy: number) => void;
  /**
   * Offered every tap made with the pen or the lasso: a press that barely moved and was
   * soon lifted. Returning true takes the tap, and it leaves nothing on the page.
   */
  onTap?: (at: Position) => boolean;
}

/** What the pointer that is currently down is doing. */
interface Gesture {
  pointerId: number;
  /** `mouse`, `touch` or `pen`, as the browser reported it. */
  pointerType: string;
  tool: Tool;
  /** Pen: the samples so far. Lasso: the loop so far. */
  points: Point[];
  simulatePressure: boolean;
  /**
   * Erasers: where the tip was at the previous sample, and what it has removed.
   * Lasso, when dragging the selection: where the pointer is now.
   */
  last: Position;
  edits: EditBuilder;
  /** Lasso: where a drag of the selection began. Absent while a loop is being drawn. */
  grab?: Position;
  /** Where and when the pointer went down, and the farthest it has gone from there. */
  start: Position;
  startedAt: number;
  travel: number;
  /** Where the pointer is on the screen, in case a second finger turns this into a scroll. */
  clientY: number;
}

/** Samples closer together than this add nothing but work. */
const MIN_SAMPLE_DISTANCE = 0.3;
/** The lasso's loop needs far fewer points than ink does. */
const MIN_LOOP_DISTANCE = 3;
/** Space between the selected ink and the dashed box drawn round it. */
export const SELECTION_PAD = 6;
/** A press this close outside the box still takes hold of the selection. */
const GRAB_PAD = SELECTION_PAD + 8;
const HIGHLIGHTER = 'rgba(255, 229, 102, 0.8)';
/** A press that moves less than this and lifts sooner than this is a tap. */
const TAP_TRAVEL = 6;
const TAP_MS = 350;
const LASSO_LINE = 'rgba(28, 43, 110, 0.65)';

/** The box of a stroke's ink, kept: strokes never change, and every redraw asks. */
const boxes = new WeakMap<Stroke, Bounds>();
function boxOf(stroke: Stroke): Bounds {
  let box = boxes.get(stroke);
  if (!box) {
    box = inkBounds(stroke);
    boxes.set(stroke, box);
  }
  return box;
}

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
  private inkColor: string;
  private eraserRadius: number;

  private gesture: Gesture | null = null;
  /** The fingers of a two-finger scroll, and where each was last on the screen. */
  private pan: Map<number, number> | null = null;
  private hover: Position | null = null;
  private origin = { left: 0, top: 0 };
  /** How far the pages are scrolled: the page coordinate at the top of the canvas. */
  private scrollTop = 0;
  /** When the stylus was last seen, for telling a resting hand from a finger. */
  private readonly pen: PenState = { seen: false, lastActivity: -Infinity };
  private readonly isWritable: (at: Position) => boolean;
  private readonly scrollPages: (dy: number) => void;
  private readonly onTap: (at: Position) => boolean;

  /** The strokes the lasso holds, and the box round their ink. */
  private selection: readonly Stroke[] = [];
  private selectionBox: Bounds | null = null;
  /** Strokes lifted off the ink layer while they are dragged, and drawn on the live one. */
  private lifted = new Set<Stroke>();
  private liftedIds: ReadonlySet<number> = new Set();
  private readonly selectionListeners = new Set<() => void>();
  private readonly dragListeners = new Set<(drag: Drag | null) => void>();

  private frame = 0;
  private inkDirty = false;
  private liveDirty = false;

  private readonly resizeObserver: ResizeObserver;
  private stopWatchingPixelRatio: () => void = () => {};
  private readonly removeListeners: Array<() => void> = [];
  private readonly activityListeners = new Set<(active: boolean) => void>();
  private readonly viewListeners = new Set<() => void>();

  constructor(
    private readonly host: HTMLElement,
    private readonly store: StrokeStore,
    private readonly history: History,
    options: InkCanvasOptions,
  ) {
    this.inkColor = options.inkColor;
    this.penWidth = options.penWidth;
    this.eraserRadius = options.eraserRadius;
    this.isWritable = options.isWritable ?? (() => true);
    this.scrollPages = options.scrollBy ?? (() => undefined);
    this.onTap = options.onTap ?? (() => false);

    this.ink = new CanvasLayer('layer layer-ink');
    this.live = new CanvasLayer('layer layer-live');
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
    // A selection belongs to the lasso. Putting the lasso down lets go of it.
    if (tool !== 'lasso') this.select([]);
    this.requestFrame('live');
  }

  /** The strokes the lasso holds. */
  get selected(): readonly Stroke[] {
    return this.selection;
  }

  /** The box round the selected ink, or null when nothing is selected or it is being moved. */
  get selectedBox(): Bounds | null {
    return this.gesture?.grab ? null : this.selectionBox;
  }

  /** Called when the selection changes, and when a drag of it starts or ends. */
  onSelectionChanged(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Called as the lasso drags strokes, so whatever is drawn for them can go along: with
   * the distance so far, with `dropped` set when they are put down, and with null when the
   * drag came to nothing and they stayed where they were.
   */
  onDrag(listener: (drag: Drag | null) => void): () => void {
    this.dragListeners.add(listener);
    return () => this.dragListeners.delete(listener);
  }

  clearSelection(): void {
    this.select([]);
  }

  /** Removes the selected strokes from the page, as one undoable edit. */
  deleteSelection(): boolean {
    const doomed = this.selection;
    if (doomed.length === 0 || this.gesture) return false;
    this.select([]);
    this.history.execute(new StrokeEdit(doomed, []));
    return true;
  }

  setPenWidth(width: number): void {
    this.penWidth = width;
  }

  /** Each stroke keeps the colour it was written in, so this changes only the next ones. */
  setInkColor(color: string): void {
    this.inkColor = color;
  }

  setEraserRadius(radius: number): void {
    this.eraserRadius = radius;
    // The tip under the pointer is drawn at its true size, so it has to be redrawn.
    this.requestFrame('live');
  }

  /** Called with `true` when a pointer goes down on the page and `false` when it lifts. */
  onActivity(listener: (active: boolean) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  /**
   * Called after the canvases were resized or scrolled, and the ink redrawn, so that the
   * overlay can be redrawn in the same frame.
   */
  onViewChanged(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  /**
   * Shows the pages from `scrollTop` down. Redraws at once rather than at the next frame,
   * so the ink and the answers never lag a frame behind the paper under them.
   */
  setScroll(scrollTop: number): void {
    const moved = scrollTop - this.scrollTop;
    if (moved === 0) return;
    this.scrollTop = scrollTop;
    for (const layer of [this.ink, this.live, this.overlay]) layer.setTop(scrollTop);
    // A pointer that stays still on the screen is now over a different part of the page.
    if (this.hover) this.hover = { x: this.hover.x, y: this.hover.y + moved };
    this.drawInk();
    this.drawLive();
    for (const listener of this.viewListeners) listener();
  }

  /** Releases every listener, observer and pending frame. The instance is dead after this. */
  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.stopWatchingPixelRatio();
    for (const remove of this.removeListeners) remove();
    this.removeListeners.length = 0;
    this.activityListeners.clear();
    this.viewListeners.clear();
    this.selectionListeners.clear();
    this.dragListeners.clear();
    this.ink.element.remove();
    this.live.element.remove();
    this.overlay.element.remove();
  }

  // ---------------------------------------------------------------- pointer input

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') {
      this.notePen(event);
      // The hand usually lands before the pen tip. If a touch has already started a
      // stroke when the pen arrives, that touch was the hand: drop its stroke and let
      // the pen write. The same goes for a scroll the hand has started.
      if (this.gesture?.pointerType === 'touch') this.finishGesture(false);
      this.pan = null;
    }
    if (event.pointerType === 'touch' && this.joinPan(event)) return;
    if (this.gesture) return; // one pointer at a time
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'touch' && isPalm(event, this.pen)) return;
    // A press on a control over the page, such as the "+" for a new page, is the control's.
    if (event.target instanceof Element && event.target.closest('button, a, input')) return;

    this.measureOrigin();
    const position = this.toPage(event);
    // Button 5 / bit 32 is the eraser end of a stylus.
    const penEraser =
      event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
    const tool = penEraser ? 'stroke-eraser' : this.tool;
    // Ink goes on the pages, not in the gap between two or past the last. An eraser may
    // start anywhere, since a stroke can stray off its page.
    if (tool === 'pen' && !this.isWritable(position)) return;

    // With the lasso, a press on the selection takes hold of it to move it. A press
    // anywhere else lets go of it and starts a new loop.
    const grab =
      tool === 'lasso' && this.selectionBox && inBox(position, this.selectionBox, GRAB_PAD)
        ? position
        : undefined;

    this.capture(event);
    this.gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      tool,
      points: [],
      simulatePressure: event.pointerType !== 'pen',
      last: position,
      edits: new EditBuilder(),
      clientY: event.clientY,
      grab,
      start: position,
      startedAt: performance.now(),
      travel: 0,
    };
    this.hover = position;

    if (tool === 'pen') {
      this.addSample(event);
    } else if (tool === 'lasso') {
      if (grab) this.lift();
      else this.select([]);
      this.extendLasso(position);
    } else {
      this.erase(position);
    }

    for (const listener of this.activityListeners) listener(true);
    this.requestFrame('live');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // A stylus reports while it hovers above the glass. That is how the page knows the
    // pen is near before it touches, and that a touch arriving now is the writing hand.
    if (event.pointerType === 'pen') this.notePen(event);

    const pan = this.pan;
    const before = pan?.get(event.pointerId);
    if (pan && before !== undefined) {
      pan.set(event.pointerId, event.clientY);
      // Each finger moves the pages by its share, so two fingers moving together move
      // them once. Fingers moving up bring the next part of the page into view.
      this.scrollPages((before - event.clientY) / pan.size);
      return;
    }

    const gesture = this.gesture;
    if (!gesture) {
      // Nothing is down: just track the pointer, so the eraser tip can follow the mouse
      // and the lasso can show when it is over something it can move.
      if (event.pointerType !== 'touch' && this.tool !== 'pen') {
        this.measureOrigin();
        this.hover = this.toPage(event);
        if (this.tool === 'lasso') this.showGrab(this.hover);
        else this.requestFrame('live');
      }
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    gesture.clientY = event.clientY;

    // A display refreshes at 60 Hz but a pen can report at 240 Hz. The browser batches
    // the extra samples into one event; asking for them gives a smoother curve.
    const samples = event.getCoalescedEvents?.() ?? [];
    if (samples.length === 0) samples.push(event);

    for (const sample of samples) {
      if (gesture.tool === 'pen') this.addSample(sample);
      else if (gesture.tool === 'lasso') this.extendLasso(this.toPage(sample));
      else this.erase(this.toPage(sample));
    }
    this.hover = this.toPage(event);
    gesture.travel = Math.max(
      gesture.travel,
      Math.hypot(this.hover.x - gesture.start.x, this.hover.y - gesture.start.y),
    );
    this.requestFrame('live');
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.notePen(event);
    this.leavePan(event);
    if (event.pointerId === this.gesture?.pointerId) this.finishGesture(true);
  };

  /** The system took the pointer away (palm detected, app switch): keep nothing. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType === 'pen') this.notePen(event);
    this.leavePan(event);
    if (event.pointerId === this.gesture?.pointerId) this.finishGesture(false);
  };

  /**
   * Two fingers scroll the pages. One finger writes, so a scroll begins when a second
   * finger lands while the first is writing: that stroke is dropped, as if never drawn,
   * and both fingers scroll from then on. More fingers join the scroll, and it lasts until
   * the last of them lifts.
   *
   * @returns whether the touch is now part of a scroll.
   */
  private joinPan(event: PointerEvent): boolean {
    if (isPalm(event, this.pen)) return false;
    if (this.pan) {
      this.pan.set(event.pointerId, event.clientY);
      this.capture(event);
      return true;
    }
    const first = this.gesture;
    if (first?.pointerType !== 'touch') return false;
    this.finishGesture(false);
    this.pan = new Map([
      [first.pointerId, first.clientY],
      [event.pointerId, event.clientY],
    ]);
    this.capture(event);
    return true;
  }

  private leavePan(event: PointerEvent): void {
    if (this.pan?.delete(event.pointerId) && this.pan.size === 0) this.pan = null;
  }

  /**
   * Keeps this pointer's events coming even when it leaves the canvas. Capture can be
   * refused, for a pointer that has already lifted; the stroke then simply ends at the
   * edge of the canvas, which is not worth failing over.
   */
  private capture(event: PointerEvent): void {
    try {
      this.host.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to do: see above.
    }
  }

  private readonly onPointerLeave = (): void => {
    if (this.gesture) return;
    this.hover = null;
    this.requestFrame('live');
  };

  private notePen(event: PointerEvent): void {
    this.pen.seen = true;
    this.pen.lastActivity = event.timeStamp;
  }

  /**
   * Ends the gesture in progress.
   * @param commit false throws away what it drew or erased, as if it had not happened.
   */
  private finishGesture(commit: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (gesture.pointerType === 'touch') this.hover = null;

    // A tap on something that answers to it, such as a sum asked to show what was read
    // there, is taken by it instead of leaving a dot. An eraser's tap still erases.
    const tapped =
      commit &&
      !isEraser(gesture.tool) &&
      gesture.travel < TAP_TRAVEL &&
      performance.now() - gesture.startedAt < TAP_MS;
    if (tapped && this.onTap(gesture.start)) commit = false;

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
    } else if (gesture.tool === 'lasso') {
      this.finishLasso(gesture, commit);
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

  /** Lasso: grows the loop, or, when the selection is held, moves it. */
  private extendLasso(at: Position): void {
    const gesture = this.gesture!;
    if (gesture.grab) {
      gesture.last = at;
      this.reportDrag(at.x - gesture.grab.x, at.y - gesture.grab.y, false);
      return;
    }
    const previous = gesture.points[gesture.points.length - 1];
    if (previous && Math.hypot(at.x - previous.x, at.y - previous.y) < MIN_LOOP_DISTANCE) return;
    gesture.points.push({ x: at.x, y: at.y, pressure: 0.5 });
  }

  /**
   * A loop, once closed, selects what it holds. A drag of the selection puts it down where
   * it was dropped, as one undoable edit: the strokes leave, and moved copies arrive.
   */
  private finishLasso(gesture: Gesture, commit: boolean): void {
    if (!gesture.grab) {
      if (commit) this.select(selectWithLasso(this.store.all(), gesture.points));
      return;
    }
    const held = this.selection;
    const dx = gesture.last.x - gesture.grab.x;
    const dy = gesture.last.y - gesture.grab.y;
    this.lifted = new Set();
    if (commit && (dx !== 0 || dy !== 0)) {
      const moved = moveStrokes(held, dx, dy);
      this.reportDrag(dx, dy, true);
      this.history.execute(new StrokeEdit(held, moved));
      this.select(moved);
    } else {
      // Put back where they were.
      for (const listener of this.dragListeners) listener(null);
      this.requestFrame('ink');
      for (const listener of this.selectionListeners) listener();
    }
  }

  /** Takes the selection off the ink layer, to be drawn on the live layer as it moves. */
  private lift(): void {
    this.lifted = new Set(this.selection);
    this.liftedIds = new Set(this.selection.map((stroke) => stroke.id));
    this.requestFrame('ink');
    for (const listener of this.selectionListeners) listener();
  }

  private reportDrag(dx: number, dy: number, dropped: boolean): void {
    const drag: Drag = { ids: this.liftedIds, dx, dy, dropped };
    for (const listener of this.dragListeners) listener(drag);
  }

  private select(strokes: readonly Stroke[]): void {
    if (strokes.length === 0 && this.selection.length === 0) return;
    this.selection = strokes;
    this.selectionBox = selectionBounds(strokes);
    this.requestFrame('live');
    for (const listener of this.selectionListeners) listener();
  }

  /** The lasso shows a hand ready to move when it is over the selection. */
  private showGrab(at: Position): void {
    const over = this.selectionBox !== null && inBox(at, this.selectionBox, GRAB_PAD);
    this.host.dataset.grab = String(over);
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
    const { x, y } = clientToPage(event.clientX, event.clientY, this.origin);
    return { x, y: y + this.scrollTop };
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

    // An undo can take away strokes that were selected. What is left of the selection
    // stays selected.
    if (change.removed.length > 0 && this.selection.length > 0) {
      const kept = this.selection.filter((stroke) => this.store.has(stroke.id));
      if (kept.length < this.selection.length) this.select(kept);
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
    // Only the strokes in view. Filling a path that falls off the canvas costs as much as
    // filling one on it, and most of a long notebook is out of view.
    const top = this.scrollTop;
    const bottom = top + this.ink.height;
    for (const stroke of this.store.all()) {
      const box = boxOf(stroke);
      if (box.maxY >= top && box.minY <= bottom && !this.lifted.has(stroke)) {
        this.fillStroke(stroke);
      }
    }
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

    if (gesture?.tool === 'lasso' && !gesture.grab) {
      this.drawLoop(ctx, gesture.points);
      return;
    }

    if (this.selection.length > 0) {
      const grab = gesture?.grab;
      const offset = grab ? { x: gesture.last.x - grab.x, y: gesture.last.y - grab.y } : null;
      this.drawSelection(ctx, offset ?? { x: 0, y: 0 });
    }

    if (isEraser(gesture?.tool ?? this.tool) && this.hover) {
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, this.eraserRadius, 0, Math.PI * 2);
      ctx.fillStyle = gesture ? 'rgba(232, 121, 140, 0.25)' : 'rgba(232, 121, 140, 0.12)';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = 'rgba(200, 80, 105, 0.9)';
      ctx.stroke();
    }
  }

  /** The lasso as it is drawn: a dashed line, closed back to where it began. */
  private drawLoop(ctx: CanvasRenderingContext2D, loop: readonly Point[]): void {
    if (loop.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(loop[0].x, loop[0].y);
    for (const point of loop) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 229, 102, 0.16)';
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = LASSO_LINE;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The selection: each stroke gone over with highlighter, and a dashed box round them
   * all. While it is dragged it is drawn here at its new place, and not on the ink layer.
   */
  private drawSelection(ctx: CanvasRenderingContext2D, offset: Position): void {
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = HIGHLIGHTER;
    for (const stroke of this.selection) ctx.stroke(strokePath(stroke));
    for (const stroke of this.selection) {
      ctx.fillStyle = stroke.color;
      ctx.fill(strokePath(stroke));
    }
    const box = this.selectionBox;
    if (box) {
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = LASSO_LINE;
      ctx.strokeRect(
        box.minX - SELECTION_PAD,
        box.minY - SELECTION_PAD,
        box.maxX - box.minX + 2 * SELECTION_PAD,
        box.maxY - box.minY + 2 * SELECTION_PAD,
      );
    }
    ctx.restore();
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
    for (const listener of this.viewListeners) listener();
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
