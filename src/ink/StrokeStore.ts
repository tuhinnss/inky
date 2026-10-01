import type { Stroke } from './types';

export interface StrokeChange {
  added: readonly Stroke[];
  removed: readonly Stroke[];
}

export type StrokeListener = (change: StrokeChange) => void;

/**
 * The single source of truth for what is on the page.
 *
 * Strokes are immutable, so "editing" one means removing it and adding its replacement.
 * That keeps change detection trivial for every consumer: a stroke id either still
 * refers to exactly the same ink or is gone.
 */
export class StrokeStore {
  /** Kept sorted by id, which is also drawing order. */
  private strokes: Stroke[] = [];
  private readonly byId = new Map<number, Stroke>();
  private readonly listeners = new Set<StrokeListener>();

  get size(): number {
    return this.strokes.length;
  }

  /** All strokes in drawing order. Treat the array as read-only. */
  all(): readonly Stroke[] {
    return this.strokes;
  }

  get(id: number): Stroke | undefined {
    return this.byId.get(id);
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  /**
   * Applies removals and additions as one change, so listeners are notified once and
   * never see the half-way state of a replacement.
   */
  apply(change: StrokeChange): void {
    const removed: Stroke[] = [];
    for (const stroke of change.removed) {
      if (this.byId.delete(stroke.id)) removed.push(stroke);
    }
    if (removed.length > 0) {
      this.strokes = this.strokes.filter((stroke) => this.byId.has(stroke.id));
    }

    const added: Stroke[] = [];
    for (const stroke of change.added) {
      if (this.byId.has(stroke.id)) continue;
      this.byId.set(stroke.id, stroke);
      this.insertSorted(stroke);
      added.push(stroke);
    }

    if (added.length > 0 || removed.length > 0) this.emit({ added, removed });
  }

  add(stroke: Stroke): void {
    this.apply({ added: [stroke], removed: [] });
  }

  remove(stroke: Stroke): void {
    this.apply({ added: [], removed: [stroke] });
  }

  /** Registers a listener and returns the function that removes it again. */
  subscribe(listener: StrokeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A new stroke nearly always belongs at the end. Undoing an erase is the exception:
   * the restored stroke has an old id and must go back underneath later ink.
   */
  private insertSorted(stroke: Stroke): void {
    const strokes = this.strokes;
    if (strokes.length === 0 || strokes[strokes.length - 1].id < stroke.id) {
      strokes.push(stroke);
      return;
    }
    let low = 0;
    let high = strokes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (strokes[middle].id < stroke.id) low = middle + 1;
      else high = middle;
    }
    strokes.splice(low, 0, stroke);
  }

  private emit(change: StrokeChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
