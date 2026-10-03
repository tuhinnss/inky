/**
 * Strokes in, probabilities out: the whole of recognition, with nothing in it that
 * knows whether it is running in the browser's worker or in a test.
 *
 * The caller supplies loaded model sessions. The worker supplies them from
 * onnxruntime-web's WASM build; the tests and the evaluation scripts supply them from
 * the same runtime under Node. Both therefore exercise this exact code.
 */

import type * as Ort from 'onnxruntime-web';
import { mayBeDigit, softmax, voteOnDigits, type DigitOpinion } from './ensemble';
import {
  CANVAS,
  drawCanvas,
  HELPER_PIXELS,
  HELPER_SIZE,
  mathexImage,
  mnistImage,
} from './helperImages';
import { DIGIT_HELPERS, MODEL, PIXELS_PER_SYMBOL, type ModelName } from './model';
import { rasterizeSymbol, type RasterStroke } from './rasterize';

export type Sessions = Readonly<Record<ModelName, Ort.InferenceSession>>;
type OrtModule = Pick<typeof Ort, 'Tensor'>;

interface Shape {
  inputName: string;
  outputName: string;
  size: number;
  classes: number;
  batched: boolean;
}

const SHAPES: Readonly<Record<ModelName, Shape>> = {
  main: { ...MODEL, batched: true },
  mathex: { ...DIGIT_HELPERS.mathex, size: HELPER_SIZE },
  mnist: { ...DIGIT_HELPERS.mnist, size: HELPER_SIZE },
};

/** Runs one model on `count` images laid back to back in `input`. */
async function run(
  ort: OrtModule,
  session: Ort.InferenceSession,
  shape: Shape,
  input: Float32Array,
  count: number,
): Promise<Float32Array> {
  const pixels = shape.size * shape.size;
  const out = new Float32Array(count * shape.classes);
  // A model exported with a fixed batch of one is simply run once per image.
  const step = shape.batched ? count : 1;

  for (let done = 0; done < count; done += step) {
    const tensor = new ort.Tensor(
      'float32',
      input.subarray(done * pixels, (done + step) * pixels),
      [step, 1, shape.size, shape.size],
    );
    const output = (await session.run({ [shape.inputName]: tensor }))[shape.outputName];
    try {
      out.set(output.data as Float32Array, done * shape.classes);
    } finally {
      // Tensors can own memory outside the JavaScript heap, where the garbage collector
      // cannot see it. Releasing them explicitly is what keeps a long session flat.
      tensor.dispose();
      output.dispose();
    }
  }
  return out;
}

/**
 * Classifies symbols. Returns {@link MODEL.classes} probabilities per symbol, back to
 * back, in the order given.
 */
export async function recognise(
  ort: OrtModule,
  sessions: Sessions,
  symbols: ReadonlyArray<readonly RasterStroke[]>,
): Promise<Float32Array> {
  const input = new Float32Array(symbols.length * PIXELS_PER_SYMBOL);
  symbols.forEach((strokes, i) => rasterizeSymbol(strokes, input, i * PIXELS_PER_SYMBOL));
  const probabilities = await run(ort, sessions.main, SHAPES.main, input, symbols.length);

  // The helpers know only digits, so only what may be a digit is shown to them.
  const digits = symbols.flatMap((_, i) => (mayBeDigit(probabilities, i) ? [i] : []));
  if (digits.length === 0) return probabilities;

  const canvas = new Float32Array(CANVAS * CANVAS);
  const forMathex = new Float32Array(digits.length * HELPER_PIXELS);
  const forMnist = new Float32Array(digits.length * HELPER_PIXELS);
  digits.forEach((symbol, i) => {
    drawCanvas(symbols[symbol], DIGIT_HELPERS.mathex.pen, canvas);
    mathexImage(canvas, forMathex, i * HELPER_PIXELS);
    drawCanvas(symbols[symbol], DIGIT_HELPERS.mnist.pen, canvas);
    mnistImage(canvas, forMnist, i * HELPER_PIXELS);
  });

  const mathex = await run(ort, sessions.mathex, SHAPES.mathex, forMathex, digits.length);
  const mnist = await run(ort, sessions.mnist, SHAPES.mnist, forMnist, digits.length);

  digits.forEach((symbol, i) => {
    const opinions: DigitOpinion[] = [
      {
        digits: mathex.subarray(i * SHAPES.mathex.classes, (i + 1) * SHAPES.mathex.classes),
        weight: DIGIT_HELPERS.mathex.weight,
      },
      {
        digits: softmax(mnist, i * SHAPES.mnist.classes, SHAPES.mnist.classes),
        weight: DIGIT_HELPERS.mnist.weight,
      },
    ];
    voteOnDigits(probabilities, symbol * MODEL.classes, opinions);
  });
  return probabilities;
}

/** A blank image through every model: the first run is slow, so it is spent before any real one. */
export async function warmUp(ort: OrtModule, sessions: Sessions): Promise<void> {
  await run(ort, sessions.main, SHAPES.main, new Float32Array(PIXELS_PER_SYMBOL), 1);
  await run(ort, sessions.mathex, SHAPES.mathex, new Float32Array(HELPER_PIXELS), 1);
  await run(ort, sessions.mnist, SHAPES.mnist, new Float32Array(HELPER_PIXELS), 1);
}
