import type { Stroke } from '../ink';
import { MODEL_FILES } from './model';
import { packSymbols, transferables, type WorkerRequest, type WorkerResponse } from './protocol';

export interface ClassifyResult {
  /** `MODEL.classes` probabilities per symbol, back to back, in request order. */
  probabilities: Float32Array;
  /** Worker time for this batch: rasterising plus inference. */
  elapsedMs: number;
}

interface Pending {
  resolve(result: ClassifyResult): void;
  reject(error: Error): void;
}

/**
 * The main thread's handle on the recognition worker: turns its message passing into
 * promises.
 */
export class RecognitionClient {
  /** Resolves with the models' load time once they are ready; rejects if they cannot load. */
  readonly ready: Promise<number>;

  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;

  constructor() {
    // Vite recognises this exact form and bundles the worker as its own chunk.
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    this.ready = new Promise<number>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'ready') {
          resolve(message.loadMs);
        } else if (message.type === 'result') {
          this.settle(message.id)?.resolve(message);
        } else if (message.id === undefined) {
          reject(new Error(message.message));
        } else {
          this.settle(message.id)?.reject(new Error(message.message));
        }
      };
      this.worker.onerror = (event) => {
        const error = new Error(event.message || 'The recognition worker failed to start');
        reject(error);
        this.rejectAll(error);
      };
    });
    // Callers await `ready` when they care; an unobserved failure must not crash the page.
    this.ready.catch(() => {});

    const url = (file: string): string => new URL(file, document.baseURI).href;
    this.post({
      type: 'init',
      modelUrls: {
        main: url(MODEL_FILES.main),
        mathex: url(MODEL_FILES.mathex),
        mnist: url(MODEL_FILES.mnist),
      },
    });
  }

  /** Classifies symbols, each given as its strokes. Resolves in request order. */
  async classify(symbols: ReadonlyArray<readonly Stroke[]>): Promise<ClassifyResult> {
    if (this.disposed) throw new Error('The recognition client was disposed');
    await this.ready;

    const id = this.nextId++;
    const packed = packSymbols(symbols);
    return new Promise<ClassifyResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'classify', id, ...packed }, transferables(packed));
    });
  }

  /** Stops the worker, which frees the WASM heap and the model with it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.rejectAll(new Error('The recognition client was disposed'));
  }

  private settle(id: number): Pending | undefined {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    return pending;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}
