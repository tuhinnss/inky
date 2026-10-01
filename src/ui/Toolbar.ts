import type { Tool } from '../canvas/InkCanvas';
import { icons } from './icons';

export interface ToolbarState {
  tool: Tool;
  penWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
}

export interface ToolbarActions {
  selectTool(tool: Tool): void;
  selectPenWidth(width: number): void;
  undo(): void;
  redo(): void;
  clear(): void;
}

export const PEN_WIDTHS = [2.5, 4, 6, 9] as const;

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

/**
 * The tools in the page margin. Purely a view: it renders the state it is given and
 * reports clicks. It owns no application state of its own.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly widthButtons = new Map<number, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly abort = new AbortController();

  constructor(actions: ToolbarActions) {
    this.element = document.createElement('nav');
    this.element.className = 'toolbar';
    this.element.setAttribute('aria-label', 'Drawing tools');

    const tools = this.group('Tool');
    for (const { tool, label, shortcut, icon } of TOOLS) {
      const button = this.button(icon, label, shortcut, () => actions.selectTool(tool));
      this.toolButtons.set(tool, button);
      tools.append(button);
    }

    const widths = this.group('Pen width');
    for (const width of PEN_WIDTHS) {
      const dot = `<span class="width-dot" style="--dot:${width}px"></span>`;
      const button = this.button(dot, `Pen width ${width}`, '', () =>
        actions.selectPenWidth(width),
      );
      button.classList.add('tool-width');
      this.widthButtons.set(width, button);
      widths.append(button);
    }

    const edits = this.group('History');
    this.undoButton = this.button(icons.undo, 'Undo', 'Ctrl+Z', () => actions.undo());
    this.redoButton = this.button(icons.redo, 'Redo', 'Ctrl+Y', () => actions.redo());
    this.clearButton = this.button(icons.clear, 'Clear the page', '', () => actions.clear());
    edits.append(this.undoButton, this.redoButton, this.clearButton);

    this.element.append(tools, widths, edits);
  }

  update(state: ToolbarState): void {
    for (const [tool, button] of this.toolButtons) {
      button.setAttribute('aria-pressed', String(tool === state.tool));
    }
    for (const [width, button] of this.widthButtons) {
      button.setAttribute('aria-pressed', String(width === state.penWidth));
    }
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.clearButton.disabled = !state.canClear;
  }

  destroy(): void {
    this.abort.abort(); // removes every click listener registered below in one call
    this.element.remove();
  }

  private group(label: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tool-group';
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool';
    button.innerHTML = content;
    button.setAttribute('aria-label', label);
    button.title = shortcut ? `${label} (${shortcut})` : label;
    button.addEventListener('click', onClick, { signal: this.abort.signal });
    return button;
  }
}
