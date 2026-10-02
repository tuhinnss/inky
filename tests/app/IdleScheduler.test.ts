import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleScheduler } from '../../src/app/IdleScheduler';

describe('IdleScheduler', () => {
  let task: ReturnType<typeof vi.fn<() => void>>;
  let scheduler: IdleScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    task = vi.fn<() => void>();
    scheduler = new IdleScheduler(task, 350);
  });
  afterEach(() => vi.useRealTimers());

  it('runs the task once things have been quiet for the idle period', () => {
    scheduler.poke();
    vi.advanceTimersByTime(349);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does nothing if nothing changed', () => {
    vi.advanceTimersByTime(5000);
    expect(task).not.toHaveBeenCalled();
  });

  it('restarts the wait on every change, and runs once for a burst', () => {
    for (let i = 0; i < 5; i++) {
      scheduler.poke();
      vi.advanceTimersByTime(300);
    }
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('never runs while the pen is down, however long the stroke takes', () => {
    scheduler.poke();
    scheduler.hold();
    vi.advanceTimersByTime(10_000);
    expect(task).not.toHaveBeenCalled();
  });

  it('starts the quiet period when the pen lifts', () => {
    scheduler.hold();
    scheduler.poke();
    vi.advanceTimersByTime(1000);
    scheduler.release();
    vi.advanceTimersByTime(349);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('waits again if the pen goes back down before the period ends', () => {
    // Writing "4": first stroke, a short pause, second stroke.
    scheduler.poke();
    vi.advanceTimersByTime(200);
    scheduler.hold();
    vi.advanceTimersByTime(500);
    scheduler.poke();
    scheduler.release();
    vi.advanceTimersByTime(349);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not run on release if nothing changed during the hold', () => {
    scheduler.hold();
    scheduler.release();
    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();
  });

  it('can be flushed to run immediately', () => {
    scheduler.poke();
    scheduler.flush();
    expect(task).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1); // and not a second time
  });

  it('flush does nothing when no change is waiting', () => {
    scheduler.flush();
    expect(task).not.toHaveBeenCalled();
  });

  it('can be cancelled, and used again afterwards', () => {
    scheduler.poke();
    scheduler.cancel();
    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();

    scheduler.poke();
    vi.advanceTimersByTime(350);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind after cancel', () => {
    scheduler.poke();
    scheduler.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
