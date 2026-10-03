import { describe, expect, it } from 'vitest';
import type { Tool } from '../../src/canvas/InkCanvas';
import { DEFAULT_INK, INKS, inkFor } from '../../src/ui/inks';
import { buttonFor, press } from '../../src/ui/menus';

describe('which button holds a tool', () => {
  it('gives the pen and the lasso a button each and both erasers one between them', () => {
    expect(buttonFor('pen')).toBe('pen');
    expect(buttonFor('lasso')).toBe('lasso');
    expect(buttonFor('stroke-eraser')).toBe('eraser');
    expect(buttonFor('pixel-eraser')).toBe('eraser');
  });
});

describe('pressing the lasso', () => {
  it('picks it up from any other tool', () => {
    expect(press('lasso', 'pen', 'stroke-eraser', null)).toEqual({ select: 'lasso' });
    expect(press('lasso', 'pixel-eraser', 'pixel-eraser', null)).toEqual({ select: 'lasso' });
  });

  it('opens no menu when it is already in hand: it has nothing to set', () => {
    expect(press('lasso', 'lasso', 'stroke-eraser', null)).toEqual({ menu: null });
  });

  it('closes another menu on the way to picking it up', () => {
    expect(press('lasso', 'pen', 'stroke-eraser', 'pen')).toEqual({ select: 'lasso' });
  });

  it('is left for the eraser used before it', () => {
    expect(press('eraser', 'lasso', 'pixel-eraser', null)).toEqual({ select: 'pixel-eraser' });
  });
});

describe('pressing a tool button', () => {
  it('picks the pen up the first time, without opening its menu', () => {
    expect(press('pen', 'stroke-eraser', 'stroke-eraser', null)).toEqual({ select: 'pen' });
  });

  it('opens the pen menu when the pen is already in hand', () => {
    expect(press('pen', 'pen', 'stroke-eraser', null)).toEqual({ menu: 'pen' });
  });

  it('closes the pen menu when it is pressed again', () => {
    expect(press('pen', 'pen', 'stroke-eraser', 'pen')).toEqual({ menu: null });
  });

  it.each(['stroke-eraser', 'pixel-eraser'] as const)(
    'picks up the eraser used last, here the %s',
    (eraser) => {
      expect(press('eraser', 'pen', eraser, null)).toEqual({ select: eraser });
    },
  );

  it('opens the eraser menu with either eraser in hand', () => {
    expect(press('eraser', 'stroke-eraser', 'stroke-eraser', null)).toEqual({ menu: 'eraser' });
    expect(press('eraser', 'pixel-eraser', 'pixel-eraser', null)).toEqual({ menu: 'eraser' });
  });

  it('closes the eraser menu when it is pressed again', () => {
    expect(press('eraser', 'pixel-eraser', 'pixel-eraser', 'eraser')).toEqual({ menu: null });
  });

  it('changes tool, not menu, when the other tool is pressed while a menu is open', () => {
    expect(press('eraser', 'pen', 'stroke-eraser', 'pen')).toEqual({ select: 'stroke-eraser' });
    expect(press('pen', 'pixel-eraser', 'pixel-eraser', 'eraser')).toEqual({ select: 'pen' });
  });

  it('takes three presses from another tool to the menu and back: pick up, open, close', () => {
    let tool: Tool = 'stroke-eraser';
    let open: 'pen' | 'eraser' | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = press('pen', tool, 'stroke-eraser', open);
      if ('select' in result) {
        tool = result.select;
        seen.push(`select ${tool}`);
      } else {
        open = result.menu;
        seen.push(`menu ${String(open)}`);
      }
    }
    expect(seen).toEqual(['select pen', 'menu pen', 'menu null']);
  });
});

describe('ink colours', () => {
  it('starts with the blue-black the notebook always used', () => {
    expect(DEFAULT_INK).toBe('#1c2b6e');
  });

  it('has a name and a distinct colour for every ink', () => {
    expect(new Set(INKS.map((ink) => ink.value)).size).toBe(INKS.length);
    expect(new Set(INKS.map((ink) => ink.name)).size).toBe(INKS.length);
  });

  it('never uses the pencil grey the answers are written in', () => {
    expect(INKS.map((ink) => ink.value)).not.toContain('#4a4e57');
  });

  it('keeps every ink dark enough to read on the paper (contrast of 4.5 or more)', () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const paper = luminance('#fafbf7');
    for (const ink of INKS) {
      expect((paper + 0.05) / (luminance(ink.value) + 0.05), ink.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('finds an ink by its value, whatever the case', () => {
    expect(inkFor('#C2272D').name).toBe('Red');
  });

  it('falls back to the default for a colour that is not one of the inks', () => {
    expect(inkFor('#ffffff').value).toBe(DEFAULT_INK);
    expect(inkFor('').value).toBe(DEFAULT_INK);
  });
});
