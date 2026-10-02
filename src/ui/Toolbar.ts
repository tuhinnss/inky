import type { Tool } from '../canvas/InkCanvas';
import { icons, penSample } from './icons';
import { ERASER_SIZE, PEN_SIZE, placePanel, sizeLabel } from './sizes';

export interface ToolbarState {
  tool: Tool;
  penWidth: number;
  /** Diameter of the eraser tip. */
  eraserSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
}

export interface ToolbarActions {
  selectTool(tool: Tool): void;
  setPenWidth(width: number): void;
  setEraserSize(size: number): void;
  undo(): void;
  redo(): void;
  clear(): void;
}

const TOOLS: ReadonlyArray<{ tool: Tool; label: string; shortcut: string; icon: string }> = [
  { tool: 'pen', label: 'Pen', shortcut: 'P', icon: icons.pen },
  { tool: 'stroke-eraser', label: 'Erase whole strokes', shortcut: 'E', icon: icons.strokeEraser },
  {
    tool: 'pixel-eraser',
    label: 'Rub out part of a stroke',
    shortcut: 'R',
    icon: icons.pixelEraser,
  },
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  return created;
}

/**
 * The tools in the page margin. Purely a view: it renders the state it is given and
 * reports what the user asked for. The only thing it keeps to itself is whether its size
 * panel is open.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly sizeButton: HTMLButtonElement;
  private readonly sizePanel: HTMLElement;
  private readonly sizeName: HTMLElement;
  private readonly sizeValue: HTMLElement;
  private readonly sizeSlider: HTMLInputElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly abort = new AbortController();

  /** Which size the slider is setting. It follows the selected tool. */
  private sizing: 'pen' | 'eraser' = 'pen';

  constructor(private readonly actions: ToolbarActions) {
    const signal = this.abort.signal;

    this.element = element('nav', 'toolbar');
    this.element.setAttribute('aria-label', 'Drawing tools');

    const tools = this.group('Tool');
    for (const { tool, label, shortcut, icon } of TOOLS) {
      const button = this.button(icon, label, shortcut, () => actions.selectTool(tool));
      this.toolButtons.set(tool, button);
      tools.append(button);
    }

    // One size control for whichever tool is selected. The button shows the size as a
    // dot; the slider lives in a panel so that it has room to be dragged precisely.
    const size = this.group('Size');
    this.sizeButton = this.button('<span class="size-dot"></span>', 'Size', '', () =>
      this.togglePanel(),
    );
    this.sizeButton.classList.add('tool-size');
    this.sizeButton.setAttribute('aria-haspopup', 'true');
    this.sizeButton.setAttribute('aria-expanded', 'false');

    this.sizeName = element('span', 'size-name');
    this.sizeValue = element('span', 'size-value');
    const head = element('p', 'size-head');
    head.append(this.sizeName, this.sizeValue);

    // Both samples are drawn at the real size, so the panel shows exactly what you get:
    // a line of ink for the pen, the tip itself for the eraser. The stylesheet picks one.
    const preview = element('div', 'size-preview');
    preview.innerHTML = penSample;
    preview.append(element('span', 'size-dot'));

    this.sizeSlider = element('input', 'size-slider');
    this.sizeSlider.type = 'range';
    this.sizeSlider.addEventListener('input', () => this.onSlide(), { signal });

    this.sizePanel = element('div', 'size-panel');
    this.sizePanel.setAttribute('role', 'group');
    this.sizePanel.hidden = true;
    this.sizePanel.append(head, preview, this.sizeSlider);
    size.append(this.sizeButton, this.sizePanel);

    const edits = this.group('History');
    this.undoButton = this.button(icons.undo, 'Undo', 'Ctrl+Z', () => actions.undo());
    this.redoButton = this.button(icons.redo, 'Redo', 'Ctrl+Y', () => actions.redo());
    this.clearButton = this.button(icons.clear, 'Clear the page', '', () => actions.clear());
    edits.append(this.undoButton, this.redoButton, this.clearButton);

    this.element.append(tools, size, edits);

    // The panel closes the way a menu does: press anywhere else, press Escape, or change
    // the layout under it. Capturing means the page still gets the press, so reaching
    // for the paper both closes the panel and starts the stroke.
    document.addEventListener('pointerdown', (event) => this.onOutsidePress(event), {
      signal,
      capture: true,
    });
    document.addEventListener('keydown', (event) => this.onKeyDown(event), { signal });
    window.addEventListener('resize', () => this.closePanel(), { signal });
  }

  update(state: ToolbarState): void {
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute('aria-pressed', String(tool === state.tool));
    }
    this.showSize(state);
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.clearButton.disabled = !state.canClear;
  }

  destroy(): void {
    this.abort.abort(); // removes every listener registered above and below in one call
    this.element.remove();
  }

  private showSize(state: ToolbarState): void {
    this.sizing = state.tool === 'pen' ? 'pen' : 'eraser';
    const erasing = this.sizing === 'eraser';
    const range = erasing ? ERASER_SIZE : PEN_SIZE;
    const size = erasing ? state.eraserSize : state.penWidth;
    const name = erasing ? 'Eraser size' : 'Pen size';
    const label = sizeLabel(size);

    this.sizeSlider.min = String(range.min);
    this.sizeSlider.max = String(range.max);
    this.sizeSlider.step = String(range.step);
    this.sizeSlider.value = String(size);
    this.sizeSlider.setAttribute('aria-label', name);
    this.sizeSlider.setAttribute('aria-valuetext', label);

    this.sizeName.textContent = name;
    this.sizeValue.textContent = label;
    this.sizePanel.setAttribute('aria-label', name);
    this.sizeButton.setAttribute('aria-label', `${name}: ${label}`);
    this.sizeButton.title = `${name} ([ and ])`;

    // Both dots, the one on the button and the true-size one in the panel, read these.
    this.element.dataset.sizing = this.sizing;
    this.element.style.setProperty('--size', `${size}px`);
  }

  private onSlide(): void {
    const size = Number(this.sizeSlider.value);
    if (this.sizing === 'pen') this.actions.setPenWidth(size);
    else this.actions.setEraserSize(size);
  }

  private get panelOpen(): boolean {
    return !this.sizePanel.hidden;
  }

  private togglePanel(): void {
    if (this.panelOpen) this.closePanel();
    else this.openPanel();
  }

  private openPanel(): void {
    this.sizePanel.hidden = false;
    this.sizeButton.setAttribute('aria-expanded', 'true');

    // Measured and placed in the same task as it is shown, so it never paints elsewhere.
    const at = placePanel(
      this.sizeButton.getBoundingClientRect(),
      this.element.getBoundingClientRect(),
      this.sizePanel.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.sizePanel.style.left = `${at.left}px`;
    this.sizePanel.style.top = `${at.top}px`;
    this.sizeSlider.focus({ preventScroll: true }); // arrow keys adjust it straight away
  }

  private closePanel(): void {
    if (!this.panelOpen) return;
    this.sizePanel.hidden = true;
    this.sizeButton.setAttribute('aria-expanded', 'false');
  }

  private onOutsidePress(event: PointerEvent): void {
    if (!this.panelOpen || !(event.target instanceof Node)) return;
    // A press on the button is left to its click handler, which closes the panel itself.
    if (this.sizePanel.contains(event.target) || this.sizeButton.contains(event.target)) return;
    this.closePanel();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.panelOpen) return;
    this.closePanel();
    this.sizeButton.focus({ preventScroll: true });
  }

  private group(label: string): HTMLElement {
    const group = element('div', 'tool-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    return group;
  }

  private button(
    content: string,
    label: string,
    shortcut: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = element('button', 'tool');
    button.type = 'button';
    button.innerHTML = content;
    button.setAttribute('aria-label', label);
    button.title = shortcut ? `${label} (${shortcut})` : label;
    button.addEventListener('click', onClick, { signal: this.abort.signal });
    return button;
  }
}
