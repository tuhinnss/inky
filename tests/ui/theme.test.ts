import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INK, INKS, inkFor, inkOnPaper } from '../../src/ui/inks';
import {
  applyTheme,
  loadThemeChoice,
  PALETTES,
  saveThemeChoice,
  THEME_SETTING,
  themeFor,
  type Theme,
} from '../../src/ui/theme';

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Relative luminance of a `#rrggbb` colour, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `r, g, b` as `#rrggbb`. */
const hex = (rgb: string): string =>
  '#' +
  rgb
    .split(',')
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('');

describe('which theme is shown', () => {
  it('follows the device until one is chosen', () => {
    expect(themeFor(null, false)).toBe('light');
    expect(themeFor(null, true)).toBe('dark');
  });

  it('keeps the one chosen, whatever the device says', () => {
    expect(themeFor('light', true)).toBe('light');
    expect(themeFor('dark', false)).toBe('dark');
  });

  it('remembers the choice on this device', () => {
    expect(loadThemeChoice()).toBeNull();
    saveThemeChoice('dark');
    expect(stored.get(THEME_SETTING)).toBe('dark');
    expect(loadThemeChoice()).toBe('dark');
  });

  it('ignores anything stored that is not a theme', () => {
    stored.set(THEME_SETTING, 'sepia');
    expect(loadThemeChoice()).toBeNull();
  });

  it('works when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadThemeChoice()).toBeNull();
    expect(() => saveThemeChoice('dark')).not.toThrow();
  });

  it('marks the page with it and colours the browser bar like the paper', () => {
    const meta = { setAttribute: vi.fn() };
    const root = {
      dataset: {} as DOMStringMap,
      ownerDocument: { querySelector: () => meta },
    } as unknown as HTMLElement;
    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    expect(meta.setAttribute).toHaveBeenCalledWith('content', PALETTES.dark.paper);
  });
});

describe('the colours of each theme', () => {
  /** The custom properties set in one block of base.css. */
  function properties(selector: string): Map<string, string> {
    const css = readFileSync('src/styles/base.css', 'utf8');
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  }
  const css: Record<Theme, Map<string, string>> = {
    light: properties(':root'),
    dark: properties(":root[data-theme='dark']"),
  };

  it.each(['light', 'dark'] as const)('agree between the page and the canvases: %s', (theme) => {
    expect(css[theme].get('--paper')).toBe(PALETTES[theme].paper);
    expect(css[theme].get('--graphite')).toBe(hex(PALETTES[theme].graphite));
  });

  it('give the page the colour of the default ink', () => {
    expect(css.light.get('--ink')).toBe(DEFAULT_INK);
    expect(css.dark.get('--ink')).toBe(inkFor(DEFAULT_INK).dark);
  });

  it.each(['light', 'dark'] as const)('keep the pencil readable on the paper: %s', (theme) => {
    const { paper, graphite } = PALETTES[theme];
    expect(contrast(paper, hex(graphite))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ink on dark paper', () => {
  it('is drawn in each ink’s light partner, and on light paper as it was written', () => {
    expect(inkOnPaper('#c2272d', 'light')).toBe('#c2272d');
    expect(inkOnPaper('#c2272d', 'dark')).toBe(inkFor('#c2272d').dark);
  });

  it('draws a colour that is not one of the inks in the default ink’s partner', () => {
    expect(inkOnPaper('#123456', 'dark')).toBe(inkFor(DEFAULT_INK).dark);
  });

  it('keeps every ink readable on dark paper (contrast of 4.5 or more)', () => {
    for (const ink of INKS) {
      expect(contrast(PALETTES.dark.paper, ink.dark), ink.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the inks apart, and apart from the pencil', () => {
    const darks = INKS.map((ink) => ink.dark);
    expect(new Set(darks).size).toBe(INKS.length);
    expect(darks).not.toContain(hex(PALETTES.dark.graphite));
  });
});
