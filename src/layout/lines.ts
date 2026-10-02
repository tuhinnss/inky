import { unionBounds, type Bounds, type Stroke } from '../ink';
import { lineHeight, measure, type StrokeMetrics } from './metrics';

/** Strokes this small (in CSS px) still get a usable vertical band and reach. */
const MIN_REACH = 20;
/** Two strokes further apart than this many digit-heights belong to different equations. */
const MAX_GAP = 1.5;
/** How far outside a stroke's vertical band a neighbour's centre may sit. */
const BAND_TOLERANCE = 0.2;

/**
 * The vertical band a stroke claims. For a digit it is simply its height. A flat stroke
 * has almost no height of its own, so it claims a band proportional to its width; that
 * is what lets the two bars of an "=" find each other.
 */
function halfBand(m: StrokeMetrics): number {
  return Math.max(m.height / 2, 0.3 * m.width, MIN_REACH * 0.3);
}

/**
 * Do two strokes belong to the same line of writing?
 *
 * Yes if the smaller one's centre lies inside the larger one's vertical band, and they
 * are not too far apart horizontally. Comparing the *centre* of the smaller with the
 * *band* of the larger is what keeps stacked lines apart: digits on adjacent lines may
 * overlap by a few pixels, but the centre of one is never inside the other.
 */
function sameLine(a: StrokeMetrics, b: StrokeMetrics): boolean {
  const [large, small] = halfBand(a) >= halfBand(b) ? [a, b] : [b, a];
  const reach = Math.max(a.height, b.height, 0.6 * a.width, 0.6 * b.width, MIN_REACH);

  const gap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  if (gap > MAX_GAP * reach) return false;

  const band = halfBand(large) + BAND_TOLERANCE * reach;
  return Math.abs(small.centreY - large.centreY) <= band;
}

/**
 * Groups strokes into lines of writing. Each group is one equation.
 *
 * Strokes are nodes of a graph, with an edge between any two that {@link sameLine}
 * accepts; the lines are its connected components. Working with pairs of neighbours,
 * rather than fitting each stroke to a fixed row, means a line may drift up or down the
 * page as handwriting does and still hold together, link by link.
 *
 * The result does not depend on the order the strokes were drawn in.
 *
 * @returns groups ordered top to bottom, then left to right.
 */
export function groupIntoLines(strokes: readonly Stroke[]): Stroke[][] {
  const metrics = strokes.map(measure);
  const count = metrics.length;

  // Union-find: parent[i] points towards the representative of i's group.
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving keeps the trees shallow
      i = parent[i];
    }
    return i;
  };

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (sameLine(metrics[i], metrics[j])) parent[find(i)] = find(j);
    }
  }

  const groups = new Map<number, StrokeMetrics[]>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(metrics[i]);
    else groups.set(root, [metrics[i]]);
  }

  return joinFragments([...groups.values()].map(toCluster))
    .sort((a, b) => a.minY - b.minY || a.minX - b.minX)
    .map((cluster) => cluster.members.map((m) => m.stroke));
}

/** A group of strokes together with the measurements the second pass needs. */
interface Cluster extends Bounds {
  members: StrokeMetrics[];
  /** Height of a typical digit in the group. */
  height: number;
}

function toCluster(members: StrokeMetrics[]): Cluster {
  return {
    members,
    height: lineHeight(members),
    ...members.map((m): Bounds => m).reduce(unionBounds),
  };
}

/**
 * Second pass: rejoins pieces of a line that the stroke-by-stroke pass left apart.
 *
 * The first pass judges the gap between two strokes by those strokes' own size. That
 * fails for two short symbols with a wide gap between them, which is exactly what is
 * left when a digit is erased from "4 × 3 =": the "×" and the "=" are both small, and
 * the hole where the 3 was is wider than either. Here the gap is judged against the
 * height of the line instead, which the first pass has by now established.
 */
function joinFragments(clusters: Cluster[]): Cluster[] {
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (!sameRow(clusters[i], clusters[j])) continue;
        clusters[i] = toCluster([...clusters[i].members, ...clusters[j].members]);
        clusters.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return clusters;
}

function sameRow(a: Cluster, b: Cluster): boolean {
  const [large, small] = a.height >= b.height ? [a, b] : [b, a];

  const gap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  if (gap > MAX_GAP * large.height) return false;

  const centre = (small.minY + small.maxY) / 2;
  const tolerance = BAND_TOLERANCE * large.height;
  return centre >= large.minY - tolerance && centre <= large.maxY + tolerance;
}
