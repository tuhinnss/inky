import type { Stroke, StrokeStore } from '../ink';
import { layoutPage } from '../layout';
import { MODEL } from '../recognition/model';
import type { ClassifyResult } from '../recognition/RecognitionClient';
import {
  EquationTracker,
  isReadable,
  readEquation,
  type Equation,
  type TrackedLine,
} from './equations';
import { IdleScheduler } from './IdleScheduler';

/** The one thing the pipeline needs from the recognition client. Easy to fake in tests. */
export interface Classifier {
  classify(symbols: ReadonlyArray<readonly Stroke[]>): Promise<ClassifyResult>;
}

export interface PipelineStats {
  /** Symbols sent to the model in the last request. */
  symbols: number;
  /** Worker time for the last request. */
  elapsedMs: number;
  /** Results dropped because their equation changed while they were being computed. */
  staleResults: number;
}

export interface PipelineOptions {
  /** How long the page must be quiet before it is read. */
  idleMs?: number;
  onUpdate(equations: readonly Equation[]): void;
  onStats?(stats: PipelineStats): void;
  onError?(error: Error): void;
}

/** Cached model outputs are kept for symbols on the page plus roughly this many more. */
const CACHE_SLACK = 256;

/**
 * Ink in, evaluated equations out.
 *
 *   store change → wait for quiet → layout → classify what is new → read → evaluate
 *
 * Two things keep this cheap and correct while the user keeps writing:
 *
 * Caching. A symbol's model output is cached against its key, which names its exact
 * strokes. Strokes are immutable, so a cached result can never be wrong. Editing one
 * symbol of a long line therefore sends one symbol to the model, not the whole line.
 *
 * Versioning. Each request is tagged with the (id, version) of every equation it is
 * for. When the reply arrives, an equation that has changed since is skipped: its
 * newer version has its own request on the way.
 */
export class RecognitionPipeline {
  private readonly scheduler: IdleScheduler;
  private readonly tracker = new EquationTracker();
  private readonly cache = new Map<string, Float32Array>();
  private readonly equations = new Map<number, Equation>();
  private readonly unsubscribe: () => void;
  private staleResults = 0;
  private disposed = false;

  constructor(
    private readonly store: StrokeStore,
    private readonly classifier: Classifier,
    private readonly options: PipelineOptions,
  ) {
    this.scheduler = new IdleScheduler(() => this.run(), options.idleMs ?? 350);
    this.unsubscribe = store.subscribe(() => this.scheduler.poke());
  }

  /** Tell the pipeline when the pen goes down and up, so it never reads mid-stroke. */
  setPenDown(down: boolean): void {
    if (down) this.scheduler.hold();
    else this.scheduler.release();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.scheduler.cancel();
    this.cache.clear();
    this.equations.clear();
  }

  private run(): void {
    const tracked = this.tracker.update(layoutPage(this.store.all()));

    // Forget equations that are no longer on the page.
    const alive = new Set(tracked.map((line) => line.id));
    for (const id of this.equations.keys()) if (!alive.has(id)) this.equations.delete(id);

    // Whatever can be read from the cache alone is published straight away.
    const waiting: TrackedLine[] = [];
    for (const line of tracked) {
      if (isReadable(line.line, this.cache))
        this.equations.set(line.id, readEquation(line, this.cache));
      else waiting.push(line);
    }
    this.publish();
    this.pruneCache(tracked);

    if (waiting.length > 0) void this.classify(waiting);
  }

  private async classify(targets: readonly TrackedLine[]): Promise<void> {
    // Each uncached symbol once, however many of the target lines contain it.
    const needed = new Map<string, readonly Stroke[]>();
    for (const { line } of targets) {
      for (const symbol of line.symbols) {
        if (symbol.kind === 'shape' && !this.cache.has(symbol.key)) {
          needed.set(symbol.key, symbol.strokes);
        }
      }
    }

    let result: ClassifyResult;
    try {
      result = await this.classifier.classify([...needed.values()]);
    } catch (error) {
      if (!this.disposed)
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (this.disposed) return;

    // The probabilities are valid whatever happened meanwhile: they describe strokes,
    // and strokes do not change. So they always go into the cache.
    [...needed.keys()].forEach((key, index) => {
      this.cache.set(
        key,
        result.probabilities.slice(index * MODEL.classes, (index + 1) * MODEL.classes),
      );
    });

    // The equations are another matter. Publish only those still at the version this
    // request was made for.
    for (const target of targets) {
      if (this.tracker.versionOf(target.id) !== target.version) {
        this.staleResults++;
        continue;
      }
      this.equations.set(target.id, readEquation(target, this.cache));
    }

    this.publish();
    this.options.onStats?.({
      symbols: needed.size,
      elapsedMs: result.elapsedMs,
      staleResults: this.staleResults,
    });
  }

  private publish(): void {
    const ordered = [...this.equations.values()].sort(
      (a, b) => a.line.bounds.minY - b.line.bounds.minY || a.line.bounds.minX - b.line.bounds.minX,
    );
    this.options.onUpdate(ordered);
  }

  /**
   * Undo can bring back a symbol erased a moment ago, so recently used results are worth
   * keeping. But not forever: once the cache outgrows the page by a margin, everything
   * not on the page goes.
   */
  private pruneCache(tracked: readonly TrackedLine[]): void {
    const onPage = new Set(tracked.flatMap(({ line }) => line.symbols.map((symbol) => symbol.key)));
    if (this.cache.size <= onPage.size + CACHE_SLACK) return;
    for (const key of this.cache.keys()) if (!onPage.has(key)) this.cache.delete(key);
  }
}
