import { describe, expect, it } from 'vitest';
import {
  ERASER_SIZE,
  PEN_SIZE,
  placePanel,
  sizeLabel,
  snapSize,
  stepSize,
  type SizeRange,
} from '../../src/ui/sizes';

describe('tool size ranges', () => {
  it.each([
    ['pen', PEN_SIZE],
    ['eraser', ERASER_SIZE],
  ])('the %s starts at a size its own range allows', (_name, range) => {
    expect(snapSize(range, range.initial)).toBe(range.initial);
    expect(range.min).toBeLessThan(range.max);
  });

  it('lets every step of the slider be reached exactly', () => {
    for (const range of [PEN_SIZE, ERASER_SIZE]) {
      const steps = (range.max - range.min) / range.step;
      expect(Number.isInteger(steps)).toBe(true);
    }
  });
});

describe('snapping a size to its range', () => {
  const range: SizeRange = { min: 1.5, max: 12, step: 0.5, initial: 4 };

  it('keeps a size that is already on a step', () => {
    expect(snapSize(range, 6.5)).toBe(6.5);
  });

  it('moves a size between steps to the nearest one', () => {
    expect(snapSize(range, 6.3)).toBe(6.5);
    expect(snapSize(range, 6.2)).toBe(6);
  });

  it('holds a size inside the range', () => {
    expect(snapSize(range, 0)).toBe(1.5);
    expect(snapSize(range, -3)).toBe(1.5);
    expect(snapSize(range, 99)).toBe(12);
  });

  it('falls back to the initial size for something that is not a number', () => {
    expect(snapSize(range, Number.NaN)).toBe(4);
    expect(snapSize(range, Number.POSITIVE_INFINITY)).toBe(4);
  });

  it('gives clean numbers for steps that binary fractions cannot hold', () => {
    const tenths: SizeRange = { min: 1.5, max: 3, step: 0.1, initial: 2 };
    expect(snapSize(tenths, 1.8)).toBe(1.8);
    expect(snapSize(tenths, 2.3000001)).toBe(2.3);
  });
});

describe('stepping a size', () => {
  it('moves one step up or down', () => {
    expect(stepSize(PEN_SIZE, 4, 1)).toBe(4.5);
    expect(stepSize(PEN_SIZE, 4, -1)).toBe(3.5);
    expect(stepSize(ERASER_SIZE, 22, 1)).toBe(24);
  });

  it('stops at the ends of the range', () => {
    expect(stepSize(PEN_SIZE, PEN_SIZE.max, 1)).toBe(PEN_SIZE.max);
    expect(stepSize(PEN_SIZE, PEN_SIZE.min, -1)).toBe(PEN_SIZE.min);
  });

  it('walks the whole range and back without drifting', () => {
    let size = PEN_SIZE.min;
    const count = (PEN_SIZE.max - PEN_SIZE.min) / PEN_SIZE.step;
    for (let i = 0; i < count; i++) size = stepSize(PEN_SIZE, size, 1);
    expect(size).toBe(PEN_SIZE.max);
    for (let i = 0; i < count; i++) size = stepSize(PEN_SIZE, size, -1);
    expect(size).toBe(PEN_SIZE.min);
  });
});

describe('naming a size', () => {
  it('shows pixels, with a half where there is one', () => {
    expect(sizeLabel(4)).toBe('4 px');
    expect(sizeLabel(2.5)).toBe('2.5 px');
  });
});

describe('placing the size panel', () => {
  const panel = { width: 200, height: 170 };

  describe('with the toolbar down the left margin', () => {
    const viewport = { width: 1200, height: 800 };
    const toolbar = { left: 0, top: 0, width: 64, height: 800 };
    const button = { left: 10, top: 180, width: 44, height: 44 };

    it('opens to the right of the toolbar, level with the button', () => {
      const at = placePanel(button, toolbar, panel, viewport);
      expect(at.left).toBeGreaterThan(toolbar.width);
      expect(at.top + panel.height / 2).toBe(button.top + button.height / 2);
    });

    it('stays on screen when the button is near the top', () => {
      const at = placePanel({ ...button, top: 4 }, toolbar, panel, viewport);
      expect(at.top).toBeGreaterThanOrEqual(0);
    });

    it('stays on screen when the button is near the bottom', () => {
      const at = placePanel({ ...button, top: 750 }, toolbar, panel, viewport);
      expect(at.top + panel.height).toBeLessThanOrEqual(viewport.height);
    });
  });

  describe('with the toolbar along the bottom', () => {
    const viewport = { width: 390, height: 780 };
    const toolbar = { left: 0, top: 728, width: 390, height: 52 };
    const button = { left: 150, top: 732, width: 40, height: 44 };

    it('opens above the toolbar, centred on the button', () => {
      const at = placePanel(button, toolbar, panel, viewport);
      expect(at.top + panel.height).toBeLessThan(toolbar.top);
      expect(at.left + panel.width / 2).toBe(button.left + button.width / 2);
    });

    it('stays on screen when the button is at the left end', () => {
      const at = placePanel({ ...button, left: 6 }, toolbar, panel, viewport);
      expect(at.left).toBeGreaterThanOrEqual(0);
    });

    it('stays on screen when the button is at the right end', () => {
      const at = placePanel({ ...button, left: 345 }, toolbar, panel, viewport);
      expect(at.left + panel.width).toBeLessThanOrEqual(viewport.width);
    });
  });
});
