import { InkCanvas, type Tool } from '../canvas/InkCanvas';
import { History, StrokeEdit, StrokeStore } from '../ink';
import { PEN_WIDTHS, Toolbar } from '../ui/Toolbar';

const INK_COLOR = '#1c2b6e';
const ERASER_RADIUS = 11;

/** Composition root: builds every part of the app and connects them. */
export class App {
  readonly store = new StrokeStore();
  readonly history = new History(this.store);
  readonly canvas: InkCanvas;

  private readonly notebook: HTMLElement;
  private readonly toolbar: Toolbar;
  private readonly cleanup: Array<() => void> = [];

  private tool: Tool = 'pen';
  private penWidth: number = PEN_WIDTHS[1];

  constructor(root: HTMLElement) {
    this.notebook = document.createElement('div');
    this.notebook.className = 'notebook';

    this.toolbar = new Toolbar({
      selectTool: (tool) => this.setTool(tool),
      selectPenWidth: (width) => this.setPenWidth(width),
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      clear: () => this.clear(),
    });

    const wordmark = document.createElement('span');
    wordmark.className = 'wordmark';
    wordmark.textContent = 'CalcInk';
    this.toolbar.element.append(wordmark);

    const page = document.createElement('main');
    page.className = 'page';

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.innerHTML = 'Write a sum, then finish it with =<small>18 + 4 × 3 =</small>';
    page.append(hint);

    this.notebook.append(this.toolbar.element, page);
    root.append(this.notebook);

    this.canvas = new InkCanvas(page, this.store, this.history, {
      inkColor: INK_COLOR,
      penWidth: this.penWidth,
      eraserRadius: ERASER_RADIUS,
    });
    this.canvas.setTool(this.tool);

    this.cleanup.push(
      this.store.subscribe(() => this.refresh()),
      this.history.subscribe(() => this.refresh()),
    );

    const onKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
    window.addEventListener('keydown', onKeyDown);
    this.cleanup.push(() => window.removeEventListener('keydown', onKeyDown));

    this.refresh();
  }

  destroy(): void {
    for (const dispose of this.cleanup) dispose();
    this.cleanup.length = 0;
    this.canvas.destroy();
    this.toolbar.destroy();
    this.notebook.remove();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.canvas.setTool(tool);
    this.refresh();
  }

  private setPenWidth(width: number): void {
    this.penWidth = width;
    this.canvas.setPenWidth(width);
    // Choosing a width means you are about to write.
    this.setTool('pen');
  }

  /** Clearing is an ordinary undoable edit, so it needs no "are you sure?" dialog. */
  private clear(): void {
    if (this.store.size > 0) this.history.execute(new StrokeEdit([...this.store.all()], []));
  }

  private refresh(): void {
    this.notebook.dataset.empty = String(this.store.size === 0);
    this.toolbar.update({
      tool: this.tool,
      penWidth: this.penWidth,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      canClear: this.store.size > 0,
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.canvas.isDrawing) return;
    const key = event.key.toLowerCase();

    if (event.ctrlKey || event.metaKey) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.history.redo();
        else this.history.undo();
      } else if (key === 'y') {
        event.preventDefault();
        this.history.redo();
      }
      return;
    }

    if (event.altKey) return;
    if (key === 'p') this.setTool('pen');
    else if (key === 'e') this.setTool('stroke-eraser');
    else if (key === 'r') this.setTool('pixel-eraser');
  }
}
