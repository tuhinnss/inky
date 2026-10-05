/**
 * Draws a graph the way it would be pencilled onto squared paper: a faint frame, the axes
 * where zero is in view, numbered ticks, and the curve, drawn in from left to right.
 */

import { formatNumber } from '../math';
import { GRAPHITE, font } from './pencil';
import type { Frame, Plot, Point } from './plot';

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
  // Zero is where the axes cross: numbered once, at the corner, not on both.
  const origin = xAxis && yAxis;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of plot.xTicks) {
    if (tick === 0 && origin) continue;
    // The last number would sit on the arrowhead.
    if (xAxis && px(tick) > right - size) continue;
    ctx.fillText(formatNumber(tick), px(tick), xLine + TICK + 2);
  }
  // Numbers left of the y axis; with no axis in view, just inside the frame.
  ctx.textAlign = yAxis ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  const numberX = yAxis ? yLine - TICK - 3 : left + TICK + 3;
  for (const tick of plot.yTicks) {
    if (tick === 0 && origin) continue;
    if (yAxis && py(tick) < top + size) continue;
    ctx.fillText(formatNumber(tick), numberX, py(tick));
  }
  if (origin) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0', yLine - TICK, xLine + TICK);
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
  ctx.restore();
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
