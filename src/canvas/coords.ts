/**
 * Coordinate spaces, and the conversions between them.
 *
 *   client  CSS pixels from the top-left of the viewport. What pointer events report.
 *   page    CSS pixels from the top-left of the canvas. What strokes are stored in.
 *   device  Physical pixels of the canvas backing store. What the 2D context fills.
 *
 * Strokes live in page space so that a stroke means the same thing on every screen. Only
 * the last step, drawing, multiplies by the device pixel ratio. On a 2× display a canvas
 * that is 800 CSS pixels wide gets a 1600-pixel backing store, and without that every
 * line would be drawn at half resolution and then stretched: blurry ink.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

/** `window.devicePixelRatio`, guarded against the 0 / NaN / undefined some hosts report. */
export function sanitizeDpr(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Backing-store size, in whole device pixels, for a canvas of the given CSS size.
 *
 * Rounded because a canvas cannot have fractional pixels. At fractional ratios such as
 * 1.25 this means the real scale differs very slightly from the nominal ratio, which is
 * why drawing uses {@link drawScale} rather than the ratio itself.
 */
export function backingStoreSize(cssSize: Size, dpr: number): Size {
  const ratio = sanitizeDpr(dpr);
  return {
    width: Math.max(1, Math.round(cssSize.width * ratio)),
    height: Math.max(1, Math.round(cssSize.height * ratio)),
  };
}

/**
 * Picks the backing-store size when the browser has also measured one for us.
 *
 * `ResizeObserver` can report an element's size in true device pixels. That is the only
 * way to know whether 1001.25 should become 1001 or 1002, because it depends on where
 * the element sits on the pixel grid. But the measurement is only a refinement: under
 * device emulation (DevTools' device toolbar, automated tests) it ignores the emulated
 * ratio and reports unscaled pixels. So it is used when it agrees with the computed size
 * to within a pixel, and ignored otherwise.
 */
export function resolveBackingSize(cssSize: Size, dpr: number, measured?: Size): Size {
  const computed = backingStoreSize(cssSize, dpr);
  if (
    measured &&
    Math.abs(measured.width - computed.width) <= 1 &&
    Math.abs(measured.height - computed.height) <= 1
  ) {
    return { width: Math.max(1, measured.width), height: Math.max(1, measured.height) };
  }
  return computed;
}

/** The exact page-to-device scale on each axis, after backing-store rounding. */
export function drawScale(cssSize: Size, backingSize: Size): Position {
  return {
    x: cssSize.width > 0 ? backingSize.width / cssSize.width : 1,
    y: cssSize.height > 0 ? backingSize.height / cssSize.height : 1,
  };
}

/** Pointer event coordinates to page space. `origin` is the canvas's bounding rect. */
export function clientToPage(
  clientX: number,
  clientY: number,
  origin: { left: number; top: number },
): Position {
  return { x: clientX - origin.left, y: clientY - origin.top };
}

export function pageToClient(page: Position, origin: { left: number; top: number }): Position {
  return { x: page.x + origin.left, y: page.y + origin.top };
}

export function pageToDevice(page: Position, scale: Position): Position {
  return { x: page.x * scale.x, y: page.y * scale.y };
}

export function deviceToPage(device: Position, scale: Position): Position {
  return { x: device.x / scale.x, y: device.y / scale.y };
}
