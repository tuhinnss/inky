import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web';
import type { Stroke } from '../../src/ink';
import { MODEL, MODEL_FILES, MODEL_SYMBOLS, PIXELS_PER_SYMBOL } from '../../src/recognition/model';
import { rasterizeSymbol, type RasterStroke } from '../../src/recognition/rasterize';
import { recognise, type Sessions } from '../../src/recognition/recognise';

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

let sessions: Promise<Sessions> | undefined;

/** The bundled models, loaded once, under the same WASM runtime the browser uses. */
export function loadModels(): Promise<Sessions> {
  sessions ??= (async () => {
    ort.env.wasm.numThreads = 1;
    const load = async (file: string): Promise<ort.InferenceSession> =>
      ort.InferenceSession.create(
        await readFile(new URL(`../../public/${file}`, import.meta.url)),
        { executionProviders: ['wasm'] },
      );
    return {
      main: await load(MODEL_FILES.main),
      mathex: await load(MODEL_FILES.mathex),
      mnist: await load(MODEL_FILES.mnist),
    };
  })();
  return sessions;
}

export interface Prediction {
  symbol: string;
  confidence: number;
  probabilities: Float32Array;
}

function toPredictions(data: Float32Array, count: number): Prediction[] {
  return Array.from({ length: count }, (_, i) => {
    const probabilities = data.slice(i * MODEL.classes, (i + 1) * MODEL.classes);
    let best = 0;
    for (let c = 1; c < MODEL.classes; c++) if (probabilities[c] > probabilities[best]) best = c;
    return { symbol: MODEL_SYMBOLS[best], confidence: probabilities[best], probabilities };
  });
}

/** Classifies a batch of symbols exactly as the app's worker does: the same function. */
export async function classify(symbols: ReadonlyArray<readonly Stroke[]>): Promise<Prediction[]> {
  const data = await recognise(ort, await loadModels(), symbols.map(toRaster));
  return toPredictions(data, symbols.length);
}

/** The main model by itself, without the digit helpers. For measuring what they add. */
export async function classifyAlone(
  symbols: ReadonlyArray<readonly Stroke[]>,
): Promise<Prediction[]> {
  const { main } = await loadModels();
  const input = new Float32Array(symbols.length * PIXELS_PER_SYMBOL);
  symbols.forEach((strokes, i) => rasterizeSymbol(toRaster(strokes), input, i * PIXELS_PER_SYMBOL));

  const tensor = new ort.Tensor('float32', input, [symbols.length, 1, MODEL.size, MODEL.size]);
  const output = (await main.run({ [MODEL.inputName]: tensor }))[MODEL.outputName];
  return toPredictions(output.data as Float32Array, symbols.length);
}
