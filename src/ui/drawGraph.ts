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
 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  plot: Plot,
  progress: number,
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
  ctx.fillStyle = `rgba(${GRAPHITE}, 0.8)`;
  /** Where the axes are numbered: key point labels keep clear of these. */
  const numbers: Box[] = [];
  const number = (text: string, at: number, baseline: number): void => {
    ctx.fillText(text, at, baseline);
    const w = ctx.measureText(text).width;
    const textLeft =
      ctx.textAlign === 'center' ? at - w / 2 : ctx.textAlign === 'right' ? at - w : at;
    const textTop = ctx.textBaseline === 'middle' ? baseline - size / 2 : baseline;
    numbers.push({ left: textLeft, top: textTop, right: textLeft + w, bottom: textTop + size });
  };
  // Zero is where the axes cross: numbered once, at the corner, not on both.
  const origin = xAxis && yAxis;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of plot.xTicks) {
    if (tick === 0 && origin) continue;
    // The last number would sit on the arrowhead.
    if (xAxis && px(tick) > right - size) continue;
    number(formatNumber(tick), px(tick), xLine + TICK + 2);
  }
  // Numbers left of the y axis; with no axis in view, just inside the frame.
  ctx.textAlign = yAxis ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const numberX = yAxis ? yLine - TICK - 3 : left + TICK + 3;
  for (const tick of plot.yTicks) {
    if (tick === 0 && origin) continue;
    if (yAxis && py(tick) < top + size) continue;
    number(formatNumber(tick), numberX, py(tick));
  }
  if (origin) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    number('0', yLine - TICK, xLine + TICK);
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
  const eased = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
  const until = x.min + (x.max - x.min) * eased;
  ctx.strokeStyle = `rgba(${GRAPHITE}, 0.92)`;
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  for (const run of plot.runs) traceRun(ctx, run, until, px, py);
  ctx.stroke();

  // Where it crosses the axes and where it turns, each marked as the pencil reaches it.
  const labelSize = Math.round(size * 0.9);
  ctx.font = font(labelSize);
  const reached = plot.keyPoints.filter((point) => point.x <= until);
  ctx.fillStyle = `rgba(${GRAPHITE}, 0.95)`;
  for (const point of reached) {
    ctx.beginPath();
    ctx.arc(px(point.x), py(point.y), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Turns first, then roots, then the crossing of the y axis: a label that would cover one
  // already written goes on the other side, and is left out if that is taken too.
  const order = (point: KeyPoint): number =>
    point.bend !== 0 ? 0 : point.kinds.includes('root') ? 1 : 2;
  const taken: Box[] = [...numbers];
  for (const point of [...reached].sort((a, b) => order(a) - order(b))) {
    const box = placeLabel(ctx, point, px(point.x), py(point.y), frame, labelSize, taken);
    if (box) taken.push(box);
  }
  ctx.restore();
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** A number as a key point is labelled: to two decimal places at most. */
function short(value: number): string {
  return formatNumber(Math.round(value * 100) / 100);
}

/**
 * Writes a key point's coordinates on the side the curve leaves empty: under a lowest
 * point, over a highest, and off to the side of a crossing, away from the way the curve
 * runs through it and from the numbers along the axes. Each label is set on a patch of
 * paper, so that no line runs through it: an axis through "(0, 1)" reads as "(0;−1)".
 *
 * @param taken boxes already written in: numbers and other labels.
 * @returns the box written in, or null when there was no room for it.
 */
function placeLabel(
  ctx: CanvasRenderingContext2D,
  point: KeyPoint,
  x: number,
  y: number,
  frame: Frame,
  size: number,
  taken: readonly Box[],
): Box | null {
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
              ]
            : [
                [toRight, above],
                [toLeft, below],
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
  for (const [spotLeft, spotTop] of spots) {
    const left = Math.max(frame.left + 2, Math.min(spotLeft, frame.left + frame.width - width - 2));
    const top = Math.max(frame.top + 2, Math.min(spotTop, frame.top + frame.height - size - 2));
    const box = { left: left - 2, top: top - 1, right: left + width + 2, bottom: top + size + 1 };
    if (taken.some((other) => overlap(box, other))) continue;
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(${GRAPHITE}, 0.9)`;
    ctx.fillText(text, left, top);
    return box;
  }
  return null;
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
