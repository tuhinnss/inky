/**
 * Runs a task once things have been quiet for a while.
 *
 * Recognition should not run after every stroke: a "4" is two strokes, and reading the
 * page between them would flash a wrong answer and waste work. Instead each change
 * restarts a short timer, and the task runs when the timer finally expires. While the
 * pen is down the timer is held, however long the stroke takes.
 *
 * This is debouncing, with one addition (the hold) that a plain debounce lacks.
 */
export class IdleScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private held = false;
  private pending = false;

  /**
   * @param task what to run once idle
   * @param idleMs how long things must be quiet first
   */
  constructor(
    private readonly task: () => void,
    private readonly idleMs: number,
  ) {}

  /** Something changed: run the task once things settle. */
  poke(): void {
    this.pending = true;
    this.restart();
  }

  /** The pen went down. Nothing runs until {@link release}. */
  hold(): void {
    this.held = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The pen lifted. If a change is waiting, the quiet period starts now. */
  release(): void {
    this.held = false;
    if (this.pending) this.restart();
  }

  /** Runs the task now if a change is waiting, without waiting out the timer. */
  flush(): void {
    if (!this.pending) return;
    clearTimeout(this.timer);
    this.fire();
  }

  /** Cancels anything waiting. The scheduler can still be used afterwards. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  private restart(): void {
    clearTimeout(this.timer);
    this.timer = this.held ? undefined : setTimeout(() => this.fire(), this.idleMs);
  }

  private fire(): void {
    this.timer = undefined;
    this.pending = false;
    this.task();
  }
}
