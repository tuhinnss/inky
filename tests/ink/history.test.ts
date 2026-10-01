import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditBuilder, History, StrokeEdit, StrokeStore, type Stroke } from '../../src/ink';
import { ids, line } from './fixtures';

const stroke = (): Stroke => line([0, 0], [10, 0]);
const draw = (s: Stroke) => new StrokeEdit([], [s]);
const erase = (...strokes: Stroke[]) => new StrokeEdit(strokes, []);

describe('History', () => {
  let store: StrokeStore;
  let history: History;

  beforeEach(() => {
    store = new StrokeStore();
    history = new History(store);
  });

  it('starts with nothing to undo or redo', () => {
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('applies a command when executing it', () => {
    const a = stroke();
    history.execute(draw(a));
    expect(store.all()).toEqual([a]);
    expect(history.canUndo).toBe(true);
  });

  it('undoes and redoes a drawn stroke', () => {
    const a = stroke();
    history.execute(draw(a));

    expect(history.undo()).toBe(true);
    expect(store.size).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    expect(history.redo()).toBe(true);
    expect(store.all()).toEqual([a]);
    expect(history.canRedo).toBe(false);
  });

  it('undoes in reverse order and redoes in original order', () => {
    const [a, b, c] = [stroke(), stroke(), stroke()];
    for (const s of [a, b, c]) history.execute(draw(s));

    history.undo();
    expect(ids(store.all())).toEqual(ids([a, b]));
    history.undo();
    expect(ids(store.all())).toEqual(ids([a]));

    history.redo();
    expect(ids(store.all())).toEqual(ids([a, b]));
    history.redo();
    expect(ids(store.all())).toEqual(ids([a, b, c]));
  });

  it('discards the redo stack when a new edit is made', () => {
    const [a, b, c] = [stroke(), stroke(), stroke()];
    history.execute(draw(a));
    history.execute(draw(b));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.execute(draw(c));
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBe(false);
    expect(ids(store.all())).toEqual(ids([a, c]));
  });

  it('undoes an erase by bringing the stroke back', () => {
    const a = stroke();
    history.execute(draw(a));
    history.execute(erase(a));
    expect(store.size).toBe(0);

    history.undo();
    expect(store.all()).toEqual([a]);
  });

  it('restores an erased stroke underneath later ink, not on top of it', () => {
    const [a, b, c] = [stroke(), stroke(), stroke()];
    for (const s of [a, b, c]) history.execute(draw(s));
    history.execute(erase(a));
    expect(ids(store.all())).toEqual(ids([b, c]));

    history.undo();
    expect(ids(store.all())).toEqual(ids([a, b, c]));
  });

  it('undoes a pixel erase by swapping the fragments for the original', () => {
    const original = stroke();
    const [left, right] = [stroke(), stroke()];
    history.execute(draw(original));
    history.execute(new StrokeEdit([original], [left, right]));
    expect(ids(store.all())).toEqual(ids([left, right]));

    history.undo();
    expect(store.all()).toEqual([original]);

    history.redo();
    expect(ids(store.all())).toEqual(ids([left, right]));
  });

  it('undoes clear-all in one step', () => {
    const strokes = [stroke(), stroke(), stroke()];
    for (const s of strokes) history.execute(draw(s));

    history.execute(erase(...store.all()));
    expect(store.size).toBe(0);

    history.undo();
    expect(ids(store.all())).toEqual(ids(strokes));
  });

  it('survives a full undo then full redo round trip', () => {
    const strokes = Array.from({ length: 20 }, stroke);
    for (const s of strokes) history.execute(draw(s));
    while (history.undo());
    expect(store.size).toBe(0);
    while (history.redo());
    expect(ids(store.all())).toEqual(ids(strokes));
  });

  it('records a command whose effect is already applied, without applying it twice', () => {
    const a = stroke();
    const listener = vi.fn();
    store.add(a);
    store.subscribe(listener);

    history.record(draw(a));
    expect(listener).not.toHaveBeenCalled();
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(store.size).toBe(0);
  });

  it('forgets the oldest commands beyond its limit', () => {
    const limited = new History(store, 3);
    const strokes = Array.from({ length: 5 }, stroke);
    for (const s of strokes) limited.execute(draw(s));

    let undone = 0;
    while (limited.undo()) undone++;
    expect(undone).toBe(3);
    expect(ids(store.all())).toEqual(ids(strokes.slice(0, 2)));
  });

  it('notifies listeners on every change of state and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = history.subscribe(listener);

    history.execute(draw(stroke()));
    history.undo();
    history.redo();
    expect(listener).toHaveBeenCalledTimes(3);

    history.undo(); // 4
    history.undo(); // nothing left: no state change, no notification
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    history.redo();
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe('EditBuilder', () => {
  it('folds a whole gesture into one undo step', () => {
    const store = new StrokeStore();
    const history = new History(store);
    const [a, b, c] = [stroke(), stroke(), stroke()];
    for (const s of [a, b, c]) history.execute(draw(s));

    // One eraser drag that removes two strokes at different moments.
    const gesture = new EditBuilder();
    for (const victim of [a, c]) {
      const change = { removed: [victim], added: [] };
      store.apply(change);
      gesture.record(change);
    }
    history.record(gesture.build());
    expect(ids(store.all())).toEqual(ids([b]));

    history.undo();
    expect(ids(store.all())).toEqual(ids([a, b, c]));
  });

  it('cancels out a fragment that is created and erased within the same gesture', () => {
    const store = new StrokeStore();
    const history = new History(store);
    const original = stroke();
    const [left, right, rightTail] = [stroke(), stroke(), stroke()];
    history.execute(draw(original));

    const gesture = new EditBuilder();
    const steps = [
      { removed: [original], added: [left, right] },
      { removed: [right], added: [rightTail] },
    ];
    for (const change of steps) {
      store.apply(change);
      gesture.record(change);
    }
    history.record(gesture.build());
    expect(ids(store.all())).toEqual(ids([left, rightTail]));

    // `right` existed only mid-gesture, so undo must not resurrect it.
    history.undo();
    expect(store.all()).toEqual([original]);

    history.redo();
    expect(ids(store.all())).toEqual(ids([left, rightTail]));
  });

  it('reports an empty edit when nothing changed', () => {
    expect(new EditBuilder().build().isEmpty).toBe(true);
  });
});

describe('StrokeStore', () => {
  it('notifies once per change with exactly what changed', () => {
    const store = new StrokeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const [a, b] = [stroke(), stroke()];

    store.apply({ removed: [], added: [a, b] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ added: [a, b], removed: [] });

    store.apply({ removed: [a], added: [] });
    expect(listener).toHaveBeenLastCalledWith({ added: [], removed: [a] });
  });

  it('ignores adding a stroke twice and removing one that is absent', () => {
    const store = new StrokeStore();
    const listener = vi.fn();
    const a = stroke();
    store.add(a);
    store.subscribe(listener);

    store.add(a);
    store.remove(stroke());
    expect(listener).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });

  it('looks strokes up by id', () => {
    const store = new StrokeStore();
    const a = stroke();
    store.add(a);
    expect(store.get(a.id)).toBe(a);
    expect(store.has(a.id)).toBe(true);
    store.remove(a);
    expect(store.get(a.id)).toBeUndefined();
  });
});
