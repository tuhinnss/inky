import type { StrokeChange, StrokeStore } from './StrokeStore';
import type { Stroke } from './types';

/**
 * Command pattern: every edit is an object that knows how to do itself and how to undo
 * itself. Undo is then just "revert the last command", with no snapshots of the page.
 */
export interface Command {
  apply(store: StrokeStore): void;
  revert(store: StrokeStore): void;
}

/**
 * The one command the app needs. Every operation is "these strokes leave, these arrive":
 *
 *   draw          removed: []          added: [stroke]
 *   stroke eraser removed: [stroke…]   added: []
 *   pixel eraser  removed: [stroke]    added: [fragment…]
 *   clear         removed: everything  added: []
 *
 * Reverting swaps the two lists. Because strokes are immutable, the command can keep
 * plain references to them and they stay valid for as long as the history does.
 */
export class StrokeEdit implements Command {
  constructor(
    private readonly removed: readonly Stroke[],
    private readonly added: readonly Stroke[],
  ) {}

  get isEmpty(): boolean {
    return this.removed.length === 0 && this.added.length === 0;
  }

  apply(store: StrokeStore): void {
    store.apply({ removed: this.removed, added: this.added });
  }

  revert(store: StrokeStore): void {
    store.apply({ removed: this.added, added: this.removed });
  }
}

/**
 * Collects the changes made during one gesture so they undo as one step.
 *
 * An eraser drag changes the page many times before the pointer lifts. Each change is
 * applied to the store straight away, for live feedback, and also recorded here. On
 * pointer-up the builder yields a single {@link StrokeEdit} covering the whole drag.
 */
export class EditBuilder {
  private readonly removed = new Map<number, Stroke>();
  private readonly added = new Map<number, Stroke>();

  record(change: StrokeChange): void {
    for (const stroke of change.removed) {
      // A fragment created earlier in this same gesture and now erased again never
      // existed as far as history is concerned.
      if (!this.added.delete(stroke.id)) this.removed.set(stroke.id, stroke);
    }
    for (const stroke of change.added) this.added.set(stroke.id, stroke);
  }

  build(): StrokeEdit {
    return new StrokeEdit([...this.removed.values()], [...this.added.values()]);
  }
}

export type HistoryListener = () => void;

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly listeners = new Set<HistoryListener>();

  /**
   * @param limit oldest commands are dropped beyond this, so a long session cannot grow
   *   the history (and the strokes it keeps alive) without bound.
   */
  constructor(
    private readonly store: StrokeStore,
    private readonly limit = 500,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Runs a command and makes it undoable. */
  execute(command: Command): void {
    command.apply(this.store);
    this.record(command);
  }

  /** Makes undoable a command whose effect is already in the store. */
  record(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    // A new edit starts a new timeline: whatever was undone can no longer be redone.
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.revert(this.store);
    this.redoStack.push(command);
    this.emit();
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.apply(this.store);
    this.undoStack.push(command);
    this.emit();
    return true;
  }

  /** Registers a listener for changes to `canUndo` / `canRedo`; returns the unsubscriber. */
  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
