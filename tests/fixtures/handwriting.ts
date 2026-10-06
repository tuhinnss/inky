/**
 * Synthetic handwriting: stroke paths for every symbol CalcInk recognises.
 *
 * Tests need ink that looks like something a person wrote, in a form that is exact and
 * repeatable. Each glyph is a few hand-placed control points in a unit box (x to the
 * right, y downwards), which `write` scales, positions, perturbs slightly and smooths
 * into dense pointer-like samples.
 *
 * This file has no runtime imports so that scripts outside the test runner can load it
 * directly.
 */

export interface InkPoint {
  x: number;
  y: number;
}

type Glyph = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

const ellipse = (cx: number, cy: number, rx: number, ry: number, steps = 20): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    // Start at the top and go anticlockwise, the way most people write a zero.
    const angle = -Math.PI / 2 - (i / steps) * Math.PI * 2;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });

/** Control points per stroke. Digits fill the box; see `SHAPES` for how operators sit. */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  '0': [ellipse(0.5, 0.5, 0.36, 0.5)],
  '1': [
    [
      [0.3, 0.24],
      [0.56, 0],
      [0.56, 1],
    ],
  ],
  '2': [
    [
      [0.14, 0.26],
      [0.26, 0.07],
      [0.5, 0],
      [0.76, 0.08],
      [0.86, 0.28],
      [0.74, 0.5],
      [0.44, 0.75],
      [0.1, 1],
      [0.92, 1],
    ],
  ],
  '3': [
    [
      [0.14, 0.1],
      [0.46, 0],
      [0.8, 0.1],
      [0.8, 0.34],
      [0.44, 0.47],
      [0.8, 0.6],
      [0.86, 0.84],
      [0.5, 1],
      [0.12, 0.9],
    ],
  ],
  '4': [
    [
      [0.24, 0],
      [0.1, 0.58],
      [0.94, 0.58],
    ],
    [
      [0.68, 0.06],
      [0.68, 1],
    ],
  ],
  // Repeated control points make the spline turn a sharp corner there.
  '5': [
    [
      [0.86, 0],
      [0.26, 0],
      [0.26, 0],
      [0.2, 0.4],
      [0.2, 0.4],
      [0.5, 0.36],
      [0.8, 0.5],
      [0.86, 0.72],
      [0.7, 0.93],
      [0.42, 1],
      [0.12, 0.88],
    ],
  ],
  '6': [
    [
      [0.76, 0.04],
      [0.44, 0.2],
      [0.22, 0.5],
      [0.18, 0.78],
      [0.36, 0.98],
      [0.62, 0.98],
      [0.8, 0.8],
      [0.72, 0.6],
      [0.5, 0.52],
      [0.28, 0.62],
      [0.2, 0.78],
    ],
  ],
  '7': [
    [
      [0.1, 0.02],
      [0.9, 0.02],
      [0.4, 1],
    ],
  ],
  '8': [
    [
      [0.76, 0.15],
      [0.5, 0],
      [0.25, 0.15],
      [0.3, 0.38],
      [0.5, 0.5],
      [0.75, 0.68],
      [0.75, 0.88],
      [0.5, 1],
      [0.25, 0.88],
      [0.27, 0.68],
      [0.5, 0.5],
      [0.72, 0.36],
      [0.76, 0.15],
    ],
  ],
  '9': [
    [
      [0.8, 0.2],
      [0.6, 0.03],
      [0.36, 0.03],
      [0.2, 0.22],
      [0.28, 0.42],
      [0.5, 0.48],
      [0.74, 0.36],
      [0.8, 0.12],
      [0.8, 0.5],
      [0.72, 0.8],
      [0.55, 1],
    ],
  ],
  '+': [
    [
      [0, 0.5],
      [1, 0.5],
    ],
    [
      [0.5, 0],
      [0.5, 1],
    ],
  ],
  '-': [
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
  '×': [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [1, 0],
      [0, 1],
    ],
  ],
  '÷': [
    [
      [0, 0.5],
      [1, 0.5],
    ],
    [[0.5, 0.08]],
    [[0.5, 0.92]],
  ],
  '=': [
    [
      [0, 0.28],
      [1, 0.28],
    ],
    [
      [0, 0.72],
      [1, 0.72],
    ],
  ],
  '.': [[[0.5, 0.5]]],
  // A power, as in x²: a 2 written small and raised.
  '²': [
    [
      [0.14, 0.26],
      [0.26, 0.07],
      [0.5, 0],
      [0.76, 0.08],
      [0.86, 0.28],
      [0.74, 0.5],
      [0.44, 0.75],
      [0.1, 1],
      [0.92, 1],
    ],
  ],
  // The letter of a graph's line, as most people print it: the short arm, then the long
  // one carried on down below the line into the tail.
  y: [
    [
      [0, 0],
      [0.5, 0.5],
    ],
    [
      [1, 0],
      [0.55, 0.5],
      [0.15, 1],
    ],
  ],
};

interface Shape {
  /** Glyph box width as a fraction of the digit height. */
  width: number;
  /** Glyph box height as a fraction of the digit height. */
  height: number;
  /** Where the box's vertical centre sits: 0 is the top of the line, 1 the baseline. */
  centre: number;
}

const DIGIT: Shape = { width: 0.55, height: 1, centre: 0.5 };
const SHAPES: Readonly<Record<string, Shape>> = {
  '+': { width: 0.55, height: 0.55, centre: 0.5 },
  '-': { width: 0.5, height: 0, centre: 0.5 },
  '×': { width: 0.5, height: 0.5, centre: 0.5 },
  '÷': { width: 0.55, height: 0.6, centre: 0.5 },
  '=': { width: 0.55, height: 0.32, centre: 0.5 },
  '.': { width: 0.06, height: 0, centre: 0.97 },
  '1': { width: 0.3, height: 1, centre: 0.5 },
  // Raised to the top of the line and well under half a digit tall.
  '²': { width: 0.3, height: 0.42, centre: 0.1 },
  // A small letter: its arms reach halfway up the digits, its tail a third below them.
  y: { width: 0.5, height: 0.85, centre: 0.92 },
};

export interface WriteOptions {
  /** Left edge of the first symbol. */
  x?: number;
  /** Top of the line. */
  y?: number;
  /** Height of a digit in pixels. */
  size?: number;
  /** Gap between symbols as a fraction of the digit height. */
  gap?: number;
  /** Random wobble as a fraction of the digit height. 0 gives perfectly regular ink. */
  wobble?: number;
  seed?: number;
}

export interface WrittenSymbol {
  char: string;
  strokes: InkPoint[][];
}

/** Small deterministic generator, so "random" wobble is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Catmull-Rom spline through the control points, sampled like pointer events. */
function smooth(control: InkPoint[], spacing: number): InkPoint[] {
  if (control.length < 3) {
    if (control.length < 2) return control;
    const [a, b] = control;
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
    return Array.from({ length: steps + 1 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / steps,
      y: a.y + ((b.y - a.y) * i) / steps,
    }));
  }

  const out: InkPoint[] = [];
  for (let i = 0; i + 1 < control.length; i++) {
    const p0 = control[Math.max(0, i - 1)];
    const p1 = control[i];
    const p2 = control[i + 1];
    const p3 = control[Math.min(control.length - 1, i + 2)];
    const steps = Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(control[control.length - 1]);
  return out;
}

/**
 * Writes `text` left to right on one line and returns the strokes of each symbol.
 * Spaces add a wider gap. `*` and `/` are accepted as `×` and `÷`.
 */
export function write(text: string, options: WriteOptions = {}): WrittenSymbol[] {
  const { x = 0, y = 0, size = 80, gap = 0.22, wobble = 0.02, seed = 1 } = options;
  const next = random(seed);
  const jitter = () => (next() - 0.5) * 2 * wobble * size;

  const symbols: WrittenSymbol[] = [];
  let cursor = x;

  for (const raw of text) {
    if (raw === ' ') {
      cursor += gap * size * 1.5;
      continue;
    }
    const char = raw === '*' ? '×' : raw === '/' ? '÷' : raw;
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`No glyph for "${char}"`);

    const shape = SHAPES[char] ?? DIGIT;
    const width = shape.width * size;
    const height = shape.height * size;
    const top = y + shape.centre * size - height / 2 + jitter();

    const strokes = glyph.map((stroke) => {
      const control = stroke.map(([u, v]) => ({
        x: cursor + u * width + jitter(),
        y: top + v * height + jitter(),
      }));
      return smooth(control, 4);
    });

    symbols.push({ char, strokes });
    cursor += width + gap * size;
  }
  return symbols;
}

/** All strokes of `write(text)` as one flat list, in writing order. */
export function writeStrokes(text: string, options?: WriteOptions): InkPoint[][] {
  return write(text, options).flatMap((symbol) => symbol.strokes);
}
