/**
 * Everything the rest of the app needs to know about the bundled model.
 *
 * This is the adapter: input size, framing, label order and file name live here and
 * nowhere else. Swapping the model means changing this file and the `.onnx` it names.
 * The numbers come from measuring the model's own training images; see
 * docs/ARCHITECTURE.md, "What the model expects".
 */

/** The model's output classes, in output order. */
export const MODEL_SYMBOLS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '+', // add
  '÷', // div
  '=', // eq
  '×', // mul
  '-', // sub
] as const;

export type ModelSymbol = (typeof MODEL_SYMBOLS)[number];

/**
 * Every symbol the app can read. The decimal point comes from geometry, not the model,
 * and x is a "×" standing where a number belongs (see app/variables.ts).
 */
export type RecognisedSymbol = ModelSymbol | '.' | 'x' | 'y';

export const MODEL = {
  /** Relative to the app's base URL. */
  file: 'models/symbol-classifier.onnx',
  inputName: 'input',
  outputName: 'probabilities',
  /** The input is a square greyscale image this many pixels on a side. */
  size: 64,
  classes: MODEL_SYMBOLS.length,
  /**
   * How much of the frame the ink spans along its longer side. Upstream pads the ink's
   * bounding box by 15% on each side, so the ink fills 1 / 1.3 of the frame.
   */
  inkExtent: 64 / 1.3,
  /** Stroke widths the model saw in training, in input pixels (5th to 95th percentile). */
  minStrokeWidth: 2,
  maxStrokeWidth: 5.5,
} as const;

export const PIXELS_PER_SYMBOL = MODEL.size * MODEL.size;

/**
 * Two small digit-only models that vote alongside the main model on which digit a digit
 * is (see ensemble.ts). Their first ten outputs are the digits 0 to 9, in order.
 */
export const DIGIT_HELPERS = {
  /** devansh9837/mathex `mathex_v1.h5`, converted to ONNX. 14 outputs, already probabilities. */
  mathex: {
    file: 'models/digit-helper-mathex.onnx',
    inputName: 'input',
    outputName: 'probabilities',
    classes: 14,
    /** Pen width, in canvas pixels, of the drawing its image is made from. */
    pen: 6,
    weight: 0.5,
    logits: false,
    /** False for a model whose graph only accepts one image per run. */
    batched: true,
  },
  /** ONNX Model Zoo `mnist-12`, unchanged. 10 outputs, raw scores. */
  mnist: {
    file: 'models/digit-helper-mnist.onnx',
    inputName: 'Input3',
    outputName: 'Plus214_Output_0',
    classes: 10,
    pen: 16,
    weight: 0.25,
    logits: true,
    batched: false,
  },
} as const;

export type ModelName = 'main' | keyof typeof DIGIT_HELPERS;

/** The file each model is loaded from, relative to the app's base URL. */
export const MODEL_FILES: Readonly<Record<ModelName, string>> = {
  main: MODEL.file,
  mathex: DIGIT_HELPERS.mathex.file,
  mnist: DIGIT_HELPERS.mnist.file,
};
