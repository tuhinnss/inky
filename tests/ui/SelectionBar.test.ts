import { describe, expect, it } from 'vitest';
import { SELECTION_PAD } from '../../src/canvas/InkCanvas';
import { placeSelectionBar } from '../../src/ui/SelectionBar';

describe('placing the Delete button beside a selection', () => {
  const bar = { width: 110, height: 48 };
  const view = { width: 1000, height: 700 };
  const box = { minX: 300, minY: 200, maxX: 500, maxY: 260 };

  it('goes above the selection, its right end over the right end of the box', () => {
    const at = placeSelectionBar(box, 0, bar, view);
    expect(at.top + bar.height).toBeLessThan(box.minY - SELECTION_PAD);
    expect(at.left + bar.width).toBe(box.maxX + SELECTION_PAD);
  });

  it('follows the selection as the pages scroll', () => {
    const still = placeSelectionBar(box, 0, bar, view);
    const scrolled = placeSelectionBar(box, 120, bar, view);
    expect(scrolled.top).toBe(still.top - 120);
    expect(scrolled.left).toBe(still.left);
  });

  it('goes below the selection when there is no room above it', () => {
    const high = { ...box, minY: 20, maxY: 80 };
    const at = placeSelectionBar(high, 0, bar, view);
    expect(at.top).toBeGreaterThan(high.maxY + SELECTION_PAD);
  });

  it('stays on screen beside a selection at the left edge', () => {
    const at = placeSelectionBar({ ...box, minX: 0, maxX: 40 }, 0, bar, view);
    expect(at.left).toBeGreaterThanOrEqual(0);
  });

  it('stays on screen for a selection taller than the window', () => {
    const at = placeSelectionBar({ ...box, minY: -500, maxY: 1500 }, 0, bar, view);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.top + bar.height).toBeLessThanOrEqual(view.height);
  });
});
