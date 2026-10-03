/**
 * Reader for the original, unnormalised files of the UCI "Pen-Based Recognition of
 * Handwritten Digits" data set (E. Alpaydin and F. Alimoglu, 1998; CC BY 4.0):
 * 10,992 digits written with a stylus on a tablet by 44 people, stored as pen
 * trajectories. It is real handwriting in the same form the app captures it, strokes
 * rather than images, which makes it a fair test of the whole recognition path.
 *
 * The data is not part of this repository. See scripts/eval/README.md.
 */

export interface PenPoint {
  x: number;
  y: number;
}

export interface PenSample {
  /** The digit the writer was asked for. */
  label: string;
  /** One list of points per pen-down, in writing order, y pointing down. */
  strokes: PenPoint[][];
}

/** The tablet reports y upwards from the bottom of a 500-unit box; screens count down. */
const BOX = 500;

/**
 * Parses the UNIPEN-style text of `pendigits-orig.tra` / `.tes`.
 *
 *   .SEGMENT DIGIT 0 ? "8"     a new sample and its label
 *   .PEN_DOWN                  a stroke begins
 *    273  323                  one point per line
 *   .PEN_UP                    the stroke ends
 *
 * Every other directive is ignored. Samples with no points are dropped.
 */
export function parsePendigits(text: string): PenSample[] {
  const samples: PenSample[] = [];
  let sample: PenSample | undefined;
  let stroke: PenPoint[] | undefined;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('.SEGMENT')) {
      const label = /"(\d)"\s*$/.exec(line)?.[1];
      sample = label === undefined ? undefined : { label, strokes: [] };
      if (sample) samples.push(sample);
      stroke = undefined;
    } else if (line === '.PEN_DOWN') {
      stroke = [];
      sample?.strokes.push(stroke);
    } else if (line === '.PEN_UP') {
      stroke = undefined;
    } else if (stroke && line !== '' && !line.startsWith('.')) {
      const [x, y] = line.split(/\s+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) stroke.push({ x, y: BOX - y });
    }
  }

  for (const each of samples) each.strokes = each.strokes.filter((points) => points.length > 0);
  return samples.filter((each) => each.strokes.length > 0);
}

/**
 * The sample moved to the origin and scaled so that its longer side is `size` pixels:
 * the size it would have if written on the page at that height.
 */
export function scaleToSize(sample: PenSample, size: number): PenPoint[][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const points of sample.strokes) {
    for (const { x, y } of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  const scale = extent > 0 ? size / extent : 1;
  return sample.strokes.map((points) =>
    points.map(({ x, y }) => ({ x: (x - minX) * scale, y: (y - minY) * scale })),
  );
}
