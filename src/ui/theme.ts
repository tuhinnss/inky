/**
 * Light paper and dark paper. The notebook follows the device's own setting until a theme
 * is chosen with the switch in the margin; the choice is then remembered on this device.
 *
 * The page's own colours live in base.css, as custom properties that `data-theme` on the
 * root element switches. The canvases cannot read CSS cheaply while they draw, so what
 * they paint with is listed here as well; a test checks that the two lists agree.
 */

export type Theme = 'light' | 'dark';

/** The colours the canvases draw with: answers, notes, graphs, the lasso and the eraser. */
export interface Palette {
  /** The paper, for the halo that keeps small writing clear of the ruling under it. */
  paper: string;
  /** Pencil graphite, as `r, g, b` for use with varying opacity. */
  graphite: string;
  /** Highlighter, as `r, g, b`: under what the lasso holds and behind a symbol's reading. */
  highlighter: string;
  /** The lasso's dashed line, as `r, g, b`. */
  lasso: string;
  /** The eraser tip under the pointer: its edge and its fill, as `r, g, b`. */
  eraserEdge: string;
  eraserFill: string;
}

export const PALETTES: Readonly<Record<Theme, Palette>> = {
  // Cool white paper with pale blue squares, written on in blue-black ink.
  light: {
    paper: '#fafbf7',
    graphite: '74, 78, 87',
    highlighter: '255, 229, 102',
    lasso: '28, 43, 110',
    eraserEdge: '200, 80, 105',
    eraserFill: '232, 121, 140',
  },
  // Slate-grey paper with faint blue squares, written on in light gel ink. The highlighter
  // is dulled to an olive: a bright yellow under light ink would wash it out.
  dark: {
    paper: '#1c1f26',
    graphite: '178, 183, 194',
    highlighter: '128, 106, 24',
    lasso: '174, 189, 255',
    eraserEdge: '244, 150, 170',
    eraserFill: '240, 140, 160',
  },
};

/** Where the choice of theme is kept on this device. */
export const THEME_SETTING = 'calcink.theme';

/** The theme to show: the one chosen on this device, or else the device's own. */
export function themeFor(chosen: Theme | null, deviceIsDark: boolean): Theme {
  return chosen ?? (deviceIsDark ? 'dark' : 'light');
}

/** The theme chosen on this device, or null if none has been, or storage is blocked. */
export function loadThemeChoice(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_SETTING);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function saveThemeChoice(theme: Theme): void {
  try {
    localStorage.setItem(THEME_SETTING, theme);
  } catch {
    // Private browsing or storage turned off: the choice lasts until the page is closed.
  }
}

/**
 * Shows `theme` on the page: the custom properties in base.css follow `data-theme`, and
 * the browser's own bars, where it has them, take the colour of the paper.
 */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.dataset.theme = theme;
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', PALETTES[theme].paper);
}
