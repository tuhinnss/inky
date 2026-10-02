import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';
import type { Stroke } from '../../src/ink';
import { MODEL, MODEL_SYMBOLS, PIXELS_PER_SYMBOL } from '../../src/recognition/model';
import { rasterizeSymbol, type RasterStroke } from '../../src/recognition/rasterize';

export function toRaster(strokes: readonly Stroke[]): RasterStroke[] {
  return strokes.map((stroke) => ({
    coords: stroke.points.flatMap((point) => [point.x, point.y]),
    width: stroke.width,
  }));
}

export function rasterize(strokes: readonly Stroke[]): Float32Array {
  const out = new Float32Array(PIXELS_PER_SYMBOL);
  rasterizeSymbol(toRaster(strokes), out);
  return out;
}

/** The image as text, for reading a failure. */
export function ascii(image: Float32Array): string {
  const shades = ' .:-=+*#%@';
  let out = '';
  for (let y = 0; y < MODEL.size; y += 2) {
    for (let x = 0; x < MODEL.size; x++) {
      const value = (image[y * MODEL.size + x] + image[(y + 1) * MODEL.size + x]) / 2;
      out += shades[Math.min(shades.length - 1, Math.floor(value * shades.length))];
    }
    out += '\n';
  }
  return out;
}

/** Bounding box of the ink in an image, in pixels. */
export function inkBox(image: Float32Array, threshold = 0.25) {
  let minX: number = MODEL.size;
  let minY: number = MODEL.size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < MODEL.size; y++) {
    for (let x = 0; x < MODEL.size; x++) {
      if (image[y * MODEL.size + x] <= threshold) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

let session: Promise<ort.InferenceSession> | undefined;

/** The bundled model, loaded once, under the same WASM runtime the browser uses. */
export function loadModel(): Promise<ort.InferenceSession> {
  session ??= (async () => {
    ort.env.wasm.numThreads = 1;
    const bytes = await readFile(new URL(`../../public/${MODEL.file}`, import.meta.url));
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  })();
  return session;
}

export interface Prediction {
  symbol: string;
  confidence: number;
  probabilities: Float32Array;
}

/** Classifies a batch of symbols with the real model. */
export async function classify(symbols: ReadonlyArray<readonly Stroke[]>): Promise<Prediction[]> {
  const model = await loadModel();
  const input = new Float32Array(symbols.length * PIXELS_PER_SYMBOL);
  symbols.forEach((strokes, i) => rasterizeSymbol(toRaster(strokes), input, i * PIXELS_PER_SYMBOL));

  const tensor = new ort.Tensor('float32', input, [symbols.length, 1, MODEL.size, MODEL.size]);
  const output = (await model.run({ [MODEL.inputName]: tensor }))[MODEL.outputName];
  const data = output.data as Float32Array;

  return symbols.map((_, i) => {
    const probabilities = data.slice(i * MODEL.classes, (i + 1) * MODEL.classes);
    let best = 0;
    for (let c = 1; c < MODEL.classes; c++) if (probabilities[c] > probabilities[best]) best = c;
    return { symbol: MODEL_SYMBOLS[best], confidence: probabilities[best], probabilities };
  });
}
