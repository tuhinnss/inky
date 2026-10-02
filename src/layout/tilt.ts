/**
 * Lines of writing that are not horizontal.
 *
 * There are two ways a line can slope, and they need opposite treatment.
 *
 * It can climb: the symbols stay upright and each sits a little higher than the last, as
 * handwriting drifts on unruled paper. Everything downstream copes with that as it is.
 *
 * Or it can be turned: the whole line, symbols and all, is written at an angle, as when
 * the tablet lies askew. Then every symbol is rotated, and beyond about 15° that changes
 * what it is: a "+" turned 45° is a "×", and the bars of "=" and "−" are no longer flat.
 * Such a line has to be turned back level before it is read.
 *
 * The two are told apart by the "=" at the end. Its bars are drawn along the writer's own
 * horizontal: level on a climbing line, sloped with the line on a turned one.
 *
 * Pure geometry, no DOM.
 */

import type { Stroke } from '../ink';
import { lineHeight, measure, type StrokeMetrics } from './metrics';

/** A line sloping less than this is read as it is: the model takes that much in its stride. */
const MIN_TILT = (15 * Math.PI) / 180;
/** Beyond this the grouping into lines is no longer dependable, so nothing is assumed. */
const MAX_TILT = (50 * Math.PI) / 180;
/** The bars of the "=" must run within this of the line's own direction. */
const BAR_AGREEMENT = (15 * Math.PI) / 180;
/** A stroke counts as a straight bar when its ends are this far apart, relative to its length. */
const STRAIGHT = 0.9;
/** A line has a direction only if it is at least this long, in digit heights. */
const MIN_LENGTH = 1.5;

export interface Tilt {
  /**
   * How far the line is turned from level, in radians, in page coordinates (y downwards):
   * negative for writing that rises to the right.
   */
  angle: number;
  /** The same in whole degrees, which is what the turn is rounded to. */
  degrees: number;
  /** The point the line is turned about. */
  pivotX: number;
  pivotY: number;
}

const wrap = (angle: number): number => {
  // Directions are the same either way along them, so keep within a quarter turn of level.
  let a = angle;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
};

/** The direction a stroke runs in, if it is a straight bar; otherwise null. */
function barDirection(stroke: Stroke, minLength: number): number | null {
  const { points } = stroke;
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  if (chord < minLength) return null;

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (chord < STRAIGHT * length) return null;
  return wrap(Math.atan2(last.y - first.y, last.x - first.x));
}

/**
 * Works out whether a line of writing is turned, and by how much.
 *
 * The direction of the line is the principal axis of its strokes' centres: the line
 * through them that they stray from least. That is only trusted for a line long enough to
 * have a direction, sloping enough to matter, and ending in two straight bars that run
 * the same way, which is what an "=" on a turned line looks like.
 *
 * @returns null for a line that is level, merely climbing, or not finished yet.
 */
export function estimateTilt(strokes: readonly Stroke[]): Tilt | null {
  const all = strokes.map(measure);
  if (all.length < 3) return null;
  const height = lineHeight(all);
  // Dots sit on the baseline or above and below a bar, off the line the rest follow.
  const marks = all.filter((m) => Math.max(m.width, m.height) > 0.25 * height);
  if (marks.length < 3) return null;

  const meanX = marks.reduce((sum, m) => sum + m.centreX, 0) / marks.length;
  const meanY = marks.reduce((sum, m) => sum + m.centreY, 0) / marks.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const m of marks) {
    sxx += (m.centreX - meanX) ** 2;
    syy += (m.centreY - meanY) ** 2;
    sxy += (m.centreX - meanX) * (m.centreY - meanY);
  }
  const angle = wrap(0.5 * Math.atan2(2 * sxy, sxx - syy));
  if (Math.abs(angle) < MIN_TILT || Math.abs(angle) > MAX_TILT) return null;

  // How far each stroke is along the line, and how long the line is.
  const along = (m: StrokeMetrics): number =>
    (m.centreX - meanX) * Math.cos(angle) + (m.centreY - meanY) * Math.sin(angle);
  const ordered = [...marks].sort((a, b) => along(a) - along(b));
  const span = along(ordered[ordered.length - 1]) - along(ordered[0]);
  if (span < MIN_LENGTH * height) return null;

  // The last two strokes must be the bars of an "=", running the way the line does.
  const bars = ordered.slice(-2).map((m) => barDirection(m.stroke, 0.2 * height));
  if (bars.some((bar) => bar === null || Math.abs(wrap(bar - angle)) > BAR_AGREEMENT)) return null;

  const degrees = Math.round((angle * 180) / Math.PI);
  return { angle: (degrees * Math.PI) / 180, degrees, pivotX: meanX, pivotY: meanY };
}

/** Level copies of strokes, kept so that the same stroke turned the same way is one object. */
const levelled = new WeakMap<Stroke, Map<string, Stroke>>();

/**
 * The stroke as it would be if its line were level: turned back about the line's pivot.
 *
 * The copy keeps the stroke's id, because it is the same stroke seen from the line's own
 * point of view, and it is remembered, so that measuring and caching by stroke still
 * work. The entry goes when the original stroke is collected.
 */
export function levelStroke(stroke: Stroke, tilt: Tilt): Stroke {
  const key = `${tilt.degrees}:${tilt.pivotX.toFixed(1)}:${tilt.pivotY.toFixed(1)}`;
  let copies = levelled.get(stroke);
  if (!copies) {
    copies = new Map<string, Stroke>();
    levelled.set(stroke, copies);
  }
  let copy = copies.get(key);
  if (!copy) {
    // One copy per stroke is all a line needs. Dropping the others keeps a line that is
    // edited again and again, its pivot moving each time, from piling up copies.
    copies.clear();
    const cos = Math.cos(tilt.angle);
    const sin = Math.sin(tilt.angle);
    copy = {
      ...stroke,
      points: stroke.points.map((p) => ({
        x: tilt.pivotX + (p.x - tilt.pivotX) * cos + (p.y - tilt.pivotY) * sin,
        y: tilt.pivotY - (p.x - tilt.pivotX) * sin + (p.y - tilt.pivotY) * cos,
        pressure: p.pressure,
      })),
    };
    copies.set(key, copy);
  }
  return copy;
}
