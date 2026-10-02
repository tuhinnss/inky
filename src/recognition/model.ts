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

/** Every symbol the app can read. The decimal point comes from geometry, not the model. */
export type RecognisedSymbol = ModelSymbol | '.';

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
