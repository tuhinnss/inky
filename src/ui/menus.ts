/**
 * How the tool buttons and their menus behave. Pure functions, no DOM.
 */

import type { Tool } from '../canvas/InkCanvas';

/** The tool buttons in the margin. Both erasers share one. */
export type ToolButton = 'pen' | 'eraser' | 'lasso';
/** The buttons with a menu. The lasso has nothing to set, so it has none. */
export type MenuName = 'pen' | 'eraser';
export type Eraser = 'stroke-eraser' | 'pixel-eraser';

/** The button that holds a tool. */
export function buttonFor(tool: Tool): ToolButton {
  return tool === 'pen' || tool === 'lasso' ? tool : 'eraser';
}

/** Either a tool to pick up, or the menu to show afterwards (`null` for none). */
export type Press = { select: Tool } | { menu: MenuName | null };

/**
 * What a press on a tool button does.
 *
 * The first press picks the tool up. Once it is in hand, a press opens its menu and the
 * next one closes it, as in most drawing apps. Sizes and colours are changed less often
 * than tools, so they cost the extra press, not the tools.
 *
 * @param tool the tool in hand.
 * @param eraser the eraser that the eraser button picks up: the one used last.
 * @param open the menu that is open now, if any.
 */
export function press(
  button: ToolButton,
  tool: Tool,
  eraser: Eraser,
  open: MenuName | null,
): Press {
  if (buttonFor(tool) !== button) return { select: button === 'eraser' ? eraser : button };
  if (button === 'lasso') return { menu: null };
  return { menu: open === button ? null : button };
}
