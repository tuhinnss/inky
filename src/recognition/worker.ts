/**
 * The recognition worker. Everything expensive happens here, off the main thread:
 * rasterising strokes into images and running the neural network. The main thread only
 * posts stroke coordinates and receives probabilities, so writing stays at full frame
 * rate however long inference takes.
 */

import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { MODEL, PIXELS_PER_SYMBOL } from './model';
import {
  unpackSymbols,
  type PackedSymbols,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';
import { rasterizeSymbol } from './rasterize';

/** The parts of the worker global this file uses, typed without pulling in the DOM lib clash. */
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}
const scope = self as unknown as WorkerScope;

// One thread. Multi-threaded WASM needs cross-origin isolation headers that static hosts
// such as GitHub Pages cannot send, and this model is fast enough without it.
ort.env.wasm.numThreads = 1;
// Load the runtime binary from our own bundle, never from a CDN: the app must work offline.
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

let session: ort.InferenceSession | undefined;

async function init(modelUrl: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error(`Could not load the model (${response.status})`);

  session = await ort.InferenceSession.create(await response.arrayBuffer(), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  // The first run allocates buffers and is several times slower than later ones.
  // Spend that cost now, on a blank image, instead of on the user's first equation.
  await run(new Float32Array(PIXELS_PER_SYMBOL), 1);
  return performance.now() - started;
}

async function run(input: Float32Array, count: number): Promise<Float32Array> {
  if (!session) throw new Error('The model is not loaded yet');

  const tensor = new ort.Tensor('float32', input, [count, 1, MODEL.size, MODEL.size]);
  const outputs = await session.run({ [MODEL.inputName]: tensor });
  const output = outputs[MODEL.outputName];
  try {
    // Copy out before disposing: the copy's buffer is what gets transferred back.
    return (output.data as Float32Array).slice();
  } finally {
    // Tensors can own memory outside the JavaScript heap, where the garbage collector
    // cannot see it. Releasing them explicitly is what keeps a long session flat.
    tensor.dispose();
    output.dispose();
  }
}

async function classify(packed: PackedSymbols): Promise<Float32Array> {
  const symbols = unpackSymbols(packed);
  const input = new Float32Array(symbols.length * PIXELS_PER_SYMBOL);
  symbols.forEach((strokes, i) => rasterizeSymbol(strokes, input, i * PIXELS_PER_SYMBOL));
  return run(input, symbols.length);
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      scope.postMessage({ type: 'ready', loadMs: await init(request.modelUrl) });
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
