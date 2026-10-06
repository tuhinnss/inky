/**
 * Draws a graph the way it would be pencilled onto squared paper: a faint frame, the axes
 * where zero is in view, numbered ticks, and the curve, drawn in from left to right.
 */

import { formatNumber } from '../math';
import { GRAPHITE, PAPER, font } from './pencil';
import type { Frame, KeyPoint, Plot, Point } from './plot';

/** How far a tick mark reaches either side of its axis, in CSS pixels. */
const TICK = 4;
/** The size of an arrowhead at the end of an axis. */
const ARROW = 6;

/**
 * @param progress from 0 to 1: how much of the curve has been drawn in so far.
 * @param opacity how firmly to draw it: fainter when the notebook was unsure of its line.
 * @param trace a point read off the curve where the graph was tapped, if any: its x, and its
 *   y or null where the curve has no value.
 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  plot: Plot,
  progress: number,
  opacity = 1,
  trace?: { x: number; y: number | null },
): void {
  const { left, top, width, height } = frame;
  const right = left + width;
  const bottom = top + height;
  const { x, y } = plot;
  const px = (value: number): number => left + ((value - x.min) / (x.max - x.min)) * width;
  const py = (value: number): number => top + ((y.max - value) / (y.max - y.min)) * height;
  const xAxis = y.min <= 0 && y.max >= 0;
  const yAxis = x.min <= 0 && x.max >= 0;
  // Ticks go along the axes, or along the frame's bottom and left edges when an axis is
  // out of view: y = x + 50 never comes near zero.
  const xLine = xAxis ? py(0) : bottom;
  const yLine = yAxis ? px(0) : left;
  const size = Math.max(13, Math.min(17, width / 24));

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = `rgba(${GRAPHITE}, 0.25)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.stroke();

  ctx.strokeStyle = `rgba(${GRAPHITE}, 0.75)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (xAxis) {
    ctx.moveTo(left, xLine);
    ctx.lineTo(right, xLine);
    ctx.moveTo(right - ARROW, xLine - ARROW / 1.6);
    ctx.lineTo(right, xLine);
    ctx.lineTo(right - ARROW, xLine + ARROW / 1.6);
  }
  if (yAxis) {
    ctx.moveTo(yLine, bottom);
    ctx.lineTo(yLine, top);
    ctx.moveTo(yLine - ARROW / 1.6, top + ARROW);
    ctx.lineTo(yLine, top);
    ctx.lineTo(yLine + ARROW / 1.6, top + ARROW);
  }
  for (const tick of plot.xTicks) {
    ctx.moveTo(px(tick), xLine - TICK);
    ctx.lineTo(px(tick), xLine + TICK);
  }
  for (const tick of plot.yTicks) {
    ctx.moveTo(yLine - TICK, py(tick));
    ctx.lineTo(yLine + TICK, py(tick));
  }
  ctx.stroke();

  ctx.font = font(size);
  /** The numbers along the axes, written once the key points have had their pick of room. */
  const numbers: Written[] = [];
  const number = (
    text: string,
    at: number,
    baseline: number,
    align: 'left' | 'center' | 'right',
    mode: 'top' | 'middle',
  ): void => {
    const w = ctx.measureText(text).width;
    const textLeft = align === 'center' ? at - w / 2 : align === 'right' ? at - w : at;
    const textTop = mode === 'middle' ? baseline - size / 2 : baseline;
    numbers.push({
      text,
      x: at,
      y: baseline,
      align,
      baseline: mode,
      box: { left: textLeft, top: textTop, right: textLeft + w, bottom: textTop + size },
    });
  };
  // Zero is where the axes cross: numbered once, at the corner, not on both.
  const origin = xAxis && yAxis;
  for (const tick of plot.xTicks) {
    if (tick === 0 && origin) continue;
    // The last number would sit on the arrowhead.
    if (xAxis && px(tick) > right - size) continue;
    number(formatNumber(tick), px(tick), xLine + TICK + 2, 'center', 'top');
  }
  // Numbers left of the y axis; with no axis in view, just inside the frame.
  const numberX = yAxis ? yLine - TICK - 3 : left + TICK + 3;
  for (const tick of plot.yTicks) {
    if (tick === 0 && origin) continue;
    if (yAxis && py(tick) < top + size) continue;
    number(formatNumber(tick), numberX, py(tick), yAxis ? 'right' : 'left', 'middle');
  }
  if (origin) number('0', yLine - TICK, xLine + TICK, 'right', 'top');

  // Where the curve crosses the axes and where it turns, each marked as the pencil reaches
  // it. Turns first, then roots, then the crossing of the y axis: a label that would cover
  // one already placed goes on the other side, and is left out if there is no room. A label
  // may take the place of a number on an axis, which is then left out: the axes are numbered
  // evenly and a missing number is easily read off its neighbours; a key point is not.
  const eased = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
  const until = x.min + (x.max - x.min) * eased;
  const labelSize = Math.round(size * 0.9);
  ctx.font = font(labelSize);
  const reached = plot.keyPoints.filter((point) => point.x <= until);
  const order = (point: KeyPoint): number =>
    point.bend !== 0 ? 0 : point.kinds.includes('root') ? 1 : 2;
  const labels: Written[] = [];
  for (const point of [...reached].sort((a, b) => order(a) - order(b))) {
    const label = placeLabel(ctx, point, px(point.x), py(point.y), frame, labelSize, {
      labels: labels.map((l) => l.box),
      numbers: numbers.map((n) => n.box),
    });
    if (label) labels.push(label);
  }

  ctx.font = font(size);
  ctx.fillStyle = `rgba(${GRAPHITE}, 0.8)`;
  for (const written of numbers) {
    if (labels.some((label) => overlap(label.box, written.box))) continue;
    ctx.textAlign = written.align;
    ctx.textBaseline = written.baseline;
    ctx.fillText(written.text, written.x, written.y);
  }
  ctx.textBaseline = 'middle';
  if (xAxis) {
    ctx.textAlign = 'right';
    ctx.fillText('x', right - 2, xLine - size * 0.9);
  }
  if (yAxis) {
    ctx.textAlign = 'left';
    ctx.fillText('y', yLine + size * 0.6, top + size * 0.5);
  }

  // The curve, pencilled in from left to right as it appears, and kept inside the frame.
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.strokeStyle = `rgba(${GRAPHITE}, 0.92)`;
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  for (const run of plot.runs) traceRun(ctx, run, until, px, py);
  ctx.stroke();

  ctx.fillStyle = `rgba(${GRAPHITE}, 0.95)`;
  for (const point of reached) {
    ctx.beginPath();
    ctx.arc(px(point.x), py(point.y), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Each label on a patch of paper, so that no line runs through it: an axis through
  // "(0, 1)" reads as "(0;-1)".
  ctx.font = font(labelSize);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const label of labels) {
    const { box } = label;
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.85 * opacity;
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.fill();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = `rgba(${GRAPHITE}, 0.9)`;
    ctx.fillText(label.text, label.x, label.y);
  }

  if (trace && progress >= 1) {
    markReading(ctx, trace, frame, { px, py, xLine, yLine }, labelSize, opacity);
  }
  ctx.restore();
}

/**
 * A point read off the curve, as by hand: a dot on the curve, dashed lines across to the
 * axes, and its coordinates beside it. Where the curve has no value, or runs out of the
 * window, the coordinates say so at the top of the frame.
 */
function markReading(
  ctx: CanvasRenderingContext2D,
  trace: { x: number; y: number | null },
  frame: Frame,
  at: {
    px: (value: number) => number;
    py: (value: number) => number;
    xLine: number;
    yLine: number;
  },
  size: number,
  opacity: number,
): void {
  const x = at.px(trace.x);
  const y = trace.y === null ? null : at.py(trace.y);
  const inside = y !== null && y >= frame.top && y <= frame.top + frame.height;
  const text =
    trace.y === null ? `no y at x = ${short(trace.x)}` : `(${short(trace.x)}, ${short(trace.y)})`;
  ctx.strokeStyle = `rgba(${GRAPHITE}, 0.6)`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  if (inside) {
    ctx.moveTo(x, y);
    ctx.lineTo(x, at.xLine);
    ctx.moveTo(x, y);
    ctx.lineTo(at.yLine, y);
  } else {
    ctx.moveTo(x, frame.top);
    ctx.lineTo(x, frame.top + frame.height);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (inside) {
    ctx.fillStyle = `rgba(${GRAPHITE}, 1)`;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = font(size);
  const width = ctx.measureText(text).width;
  const textTop = inside ? y - 8 - size : frame.top + 4;
  const left = Math.max(frame.left + 2, Math.min(x + 8, frame.left + frame.width - width - 2));
  const top = Math.max(frame.top + 2, Math.min(textTop, frame.top + frame.height - size - 2));
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = 0.9 * opacity;
  ctx.beginPath();
  ctx.rect(left - 2, top - 1, width + 4, size + 2);
  ctx.fill();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = `rgba(${GRAPHITE}, 1)`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, left, top);
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Something to write, where, and the room it takes. */
interface Written {
  text: string;
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  baseline: 'top' | 'middle';
  box: Box;
}

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** A number as a key point is labelled: to two decimal places at most. */
function short(value: number): string {
  return formatNumber(Math.round(value * 100) / 100);
}

/**
 * Where to write a key point's coordinates: on the side the curve leaves empty, under a
 * lowest point, over a highest, and off to the side of a crossing, away from the way the
 * curve runs through it and from the numbers along the axes. The first spot clear of other
 * labels and of the numbers is taken; failing that, the first clear of other labels.
 *
 * @returns where to write it, or null when there is no room for it.
 */
function placeLabel(
  ctx: CanvasRenderingContext2D,
  point: KeyPoint,
  x: number,
  y: number,
  frame: Frame,
  size: number,
  taken: { labels: readonly Box[]; numbers: readonly Box[] },
): Written | null {
  const text = `(${short(point.x)}, ${short(point.y)})`;
  const width = ctx.measureText(text).width;
  const gap = 6;
  const centred = x - width / 2;
  const toLeft = x - gap - width;
  const toRight = x + gap;
  const above = y - gap - size;
  const below = y + gap;
  const rising = point.slope >= 0;
  // Where to try, best first.
  const spots: Array<[number, number]> =
    point.bend > 0
      ? [
          [centred, below],
          [toRight, below],
          [toLeft, below],
        ]
      : point.bend < 0
        ? [
            [centred, above],
            [toRight, above],
            [toLeft, above],
          ]
        : point.kinds.includes('root')
          ? rising
            ? [
                [toLeft, above],
                [toRight, below],
                [toLeft, below],
              ]
            : [
                [toRight, above],
                [toLeft, below],
                [toRight, below],
              ]
          : rising
            ? [
                [toRight, below],
                [toLeft, above],
              ]
            : [
                [toRight, above],
                [toLeft, below],
              ];
  const options = spots.map(([spotLeft, spotTop]): Written => {
    const left = Math.max(frame.left + 2, Math.min(spotLeft, frame.left + frame.width - width - 2));
    const top = Math.max(frame.top + 2, Math.min(spotTop, frame.top + frame.height - size - 2));
    const box = { left: left - 2, top: top - 1, right: left + width + 2, bottom: top + size + 1 };
    return { text, x: left, y: top, align: 'left', baseline: 'top', box };
  });
  const clear = (written: Written, of: readonly Box[]): boolean =>
    !of.some((other) => overlap(written.box, other));
  return (
    options.find((w) => clear(w, taken.labels) && clear(w, taken.numbers)) ??
    options.find((w) => clear(w, taken.labels)) ??
    null
  );
}

/** Adds a run of the curve to the path, as far as x = `until`. */
function traceRun(
  ctx: CanvasRenderingContext2D,
  run: readonly Point[],
  until: number,
  px: (value: number) => number,
  py: (value: number) => number,
): void {
  if (run.length === 0 || run[0].x > until) return;
  ctx.moveTo(px(run[0].x), py(run[0].y));
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1];
    const b = run[i];
    if (b.x <= until) {
      ctx.lineTo(px(b.x), py(b.y));
      continue;
    }
    // Part of the way to the next point: where the pencil is now.
    const t = (until - a.x) / (b.x - a.x);
    ctx.lineTo(px(until), py(a.y + (b.y - a.y) * t));
    return;
  }
}
