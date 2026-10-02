/**
 * The recognition worker. Everything expensive happens here, off the main thread:
 * rasterising strokes into images and running the neural networks. The main thread only
 * posts stroke coordinates and receives probabilities, so writing stays at full frame
 * rate however long inference takes.
 */

import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { ModelName } from './model';
import {
  unpackSymbols,
  type PackedSymbols,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';
import { recognise, warmUp, type Sessions } from './recognise';

/** The parts of the worker global this file uses, typed without pulling in the DOM lib clash. */
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}
const scope = self as unknown as WorkerScope;

// One thread. Multi-threaded WASM needs cross-origin isolation headers that static hosts
// such as GitHub Pages cannot send, and these models are fast enough without it.
ort.env.wasm.numThreads = 1;
// Load the runtime binary from our own bundle, never from a CDN: the app must work offline.
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

let sessions: Sessions | undefined;

async function load(url: string): Promise<ort.InferenceSession> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load a model (${response.status})`);
  return ort.InferenceSession.create(await response.arrayBuffer(), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
}

async function init(urls: Readonly<Record<ModelName, string>>): Promise<number> {
  const started = performance.now();
  // The files download side by side; the sessions are then created one after another,
  // since the single-threaded runtime would not do them any faster together.
  const [main, mathex, mnist] = await Promise.all([
    load(urls.main),
    load(urls.mathex),
    load(urls.mnist),
  ]);
  sessions = { main, mathex, mnist };

  // The first run allocates buffers and is several times slower than later ones.
  // Spend that cost now, on blank images, instead of on the user's first equation.
  await warmUp(ort, sessions);
  return performance.now() - started;
}

async function classify(packed: PackedSymbols): Promise<Float32Array> {
  if (!sessions) throw new Error('The models are not loaded yet');
  return recognise(ort, sessions, unpackSymbols(packed));
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      scope.postMessage({ type: 'ready', loadMs: await init(request.modelUrls) });
      return;
    }
    const started = performance.now();
    const probabilities = await classify(request);
    scope.postMessage(
      { type: 'result', id: request.id, probabilities, elapsedMs: performance.now() - started },
      [probabilities.buffer],
    );
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: request.type === 'classify' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// A session runs one inference at a time, so requests are chained rather than raced.
let queue: Promise<void> = Promise.resolve();
scope.addEventListener('message', (event) => {
  queue = queue.then(() => handle(event.data));
});
