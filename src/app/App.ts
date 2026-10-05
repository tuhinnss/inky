import { InkCanvas, type Tool } from '../canvas/InkCanvas';
import { PageStack } from '../canvas/PageStack';
import { History, StrokeEdit, StrokeStore } from '../ink';
import { RecognitionClient } from '../recognition/RecognitionClient';
import { AnswerOverlay } from '../ui/AnswerOverlay';
import { CueTracker } from '../ui/cues';
import { Feedback } from '../ui/Feedback';
import { DEFAULT_INK, inkFor } from '../ui/inks';
import type { Eraser } from '../ui/menus';
import { SelectionBar } from '../ui/SelectionBar';
import { ERASER_SIZE, PEN_SIZE, snapSize, stepSize } from '../ui/sizes';
import { Toolbar } from '../ui/Toolbar';
import type { Equation } from './equations';
import { RecognitionPipeline, type PipelineStats } from './RecognitionPipeline';

/** Composition root: builds every part of the app and connects them. */
export class App {
  readonly store = new StrokeStore();
  readonly history = new History(this.store);
  readonly canvas: InkCanvas;
  /** What the notebook currently reads on the page. Exposed for tests and debugging. */
  equations: readonly Equation[] = [];
  stats: PipelineStats | undefined;

  readonly pages: PageStack;

  private readonly notebook: HTMLElement;
  private readonly toolbar: Toolbar;
  private readonly notice: HTMLElement;
  private readonly selectionBar: SelectionBar;
  private readonly recognition: RecognitionClient;
  private readonly pipeline: RecognitionPipeline;
  private readonly overlay: AnswerOverlay;
  private readonly feedback = new Feedback();
  private readonly cues = new CueTracker();
  private readonly cleanup: Array<() => void> = [];
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  private tool: Tool = 'pen';
  /** The eraser the eraser button picks up: the one used last. */
  private eraser: Eraser = 'stroke-eraser';
  private penWidth = PEN_SIZE.initial;
  private penColor = DEFAULT_INK;
  /** Diameter of the eraser tip, shared by both erasers. */
  private eraserSize = ERASER_SIZE.initial;

  constructor(root: HTMLElement) {
    this.notebook = document.createElement('div');
    this.notebook.className = 'notebook';

    this.toolbar = new Toolbar({
      selectTool: (tool) => this.setTool(tool),
      setPenWidth: (width) => this.setPenWidth(width),
      setPenColor: (color) => this.setPenColor(color),
      setEraserSize: (size) => this.setEraserSize(size),
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      clear: () => this.clear(),
      setVolume: (volume) => {
        this.feedback.setVolume(volume);
        this.refresh();
      },
      setVibration: (on) => {
        this.feedback.setVibration(on);
        this.refresh();
      },
      previewSound: () => this.feedback.preview(),
    });

    const wordmark = document.createElement('span');
    wordmark.className = 'wordmark';
    wordmark.textContent = 'CalcInk';
    this.toolbar.element.append(wordmark);

    const page = document.createElement('main');
    page.className = 'page';

    // Pages are whole squares of the grid the paper is ruled with.
    const grid = parseFloat(getComputedStyle(root).getPropertyValue('--grid')) || 28;
    this.pages = new PageStack(grid);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.innerHTML =
      'Write a sum, then finish it with =<small>18 + 4 × 3 =</small>' +
      '<small>For a graph, write y = 2x + 1</small>';
    this.pages.sheet(0).append(hint);
    this.notice = document.createElement('p');
    this.notice.className = 'notice';
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.selectionBar = new SelectionBar(() => this.canvas.deleteSelection());
    page.append(this.pages.element, this.notice, this.selectionBar.element);

    this.notebook.append(this.toolbar.element, page);
    root.append(this.notebook);

    this.canvas = new InkCanvas(page, this.store, this.history, {
      inkColor: this.penColor,
      penWidth: this.penWidth,
      eraserRadius: this.eraserSize / 2,
      isWritable: (at) => this.pages.isWritable(at),
      scrollBy: (dy) => this.pages.scrollBy(dy),
      onTap: (at) => this.overlay.toggleReadingsAt(at),
    });
    this.canvas.setTool(this.tool);

    this.overlay = new AnswerOverlay(this.canvas.overlay);
    this.recognition = new RecognitionClient();
    this.pipeline = new RecognitionPipeline(this.store, this.recognition, {
      onUpdate: (equations) => {
        this.equations = equations;
        this.overlay.setEquations(equations);
        const cue = this.cues.next(equations);
        if (cue) this.feedback.cue(cue);
      },
      onStats: (stats) => (this.stats = stats),
      onError: (error) => this.showNotice(`Could not read the page: ${error.message}`),
    });
    this.recognition.ready.catch((error: Error) =>
      this.showNotice(`Handwriting recognition could not start: ${error.message}`),
    );

    this.cleanup.push(
      this.store.subscribe(() => this.refresh()),
      this.history.subscribe(() => this.refresh()),
      this.canvas.onActivity((active) => {
        this.pipeline.setPenDown(active);
        if (active) this.feedback.wake();
      }),
      this.canvas.onMotion((motion) => this.feedback.move(motion)),
      this.canvas.onScratchOut(() => this.feedback.scratchedOut()),
      this.canvas.onViewChanged(() => {
        this.overlay.redraw();
        this.placeSelectionBar();
      }),
      this.canvas.onSelectionChanged(() => this.placeSelectionBar()),
      this.canvas.onDrag((drag) => this.overlay.setDrag(drag)),
      this.pages.onScroll((top) => {
        this.canvas.setScroll(top);
        // The margin is ruled too. Moving its ruling with the pages keeps the lines
        // running on across the margin rule.
        this.toolbar.element.style.backgroundPositionY = `${-top}px`;
      }),
    );

    // Canvas text does not wait for web fonts. Answers drawn before Kalam has loaded
    // would use the fallback face, so redraw once it arrives.
    void document.fonts.load('300 32px Kalam').then(() => this.overlay.redraw());

    const onKeyDown = (event: KeyboardEvent): void => this.onKeyDown(event);
    window.addEventListener('keydown', onKeyDown);
    this.cleanup.push(() => window.removeEventListener('keydown', onKeyDown));

    this.refresh();
  }

  destroy(): void {
    for (const dispose of this.cleanup) dispose();
    this.cleanup.length = 0;
    clearTimeout(this.noticeTimer);
    this.pipeline.dispose();
    this.recognition.dispose();
    this.feedback.destroy();
    this.overlay.destroy();
    this.canvas.destroy();
    this.selectionBar.destroy();
    this.pages.destroy();
    this.toolbar.destroy();
    this.notebook.remove();
  }

  /**
   * Pencils a line at the foot of the page.
   * @param forMs if given, the note is rubbed out again after this long.
   */
  showNotice(message: string, forMs?: number): void {
    clearTimeout(this.noticeTimer);
    this.notice.textContent = message;
    this.notice.hidden = false;
    if (forMs !== undefined) {
      this.noticeTimer = setTimeout(() => (this.notice.hidden = true), forMs);
    }
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    if (tool === 'stroke-eraser' || tool === 'pixel-eraser') this.eraser = tool;
    this.canvas.setTool(tool);
    this.refresh();
  }

  /** Puts the Delete button beside what the lasso holds, or hides it. */
  private placeSelectionBar(): void {
    this.selectionBar.show(this.canvas.selectedBox, this.pages.scrollTop, this.canvas.size);
  }

  private setPenWidth(width: number): void {
    this.penWidth = snapSize(PEN_SIZE, width);
    this.canvas.setPenWidth(this.penWidth);
    this.refresh();
  }

  /** Changes the colour of the strokes still to be written. Those on the page keep theirs. */
  private setPenColor(color: string): void {
    this.penColor = inkFor(color).value;
    this.canvas.setInkColor(this.penColor);
    this.refresh();
  }

  private setEraserSize(size: number): void {
    this.eraserSize = snapSize(ERASER_SIZE, size);
    this.canvas.setEraserRadius(this.eraserSize / 2);
    this.refresh();
  }

  /** Makes the tool in hand a number of steps thicker or thinner. The lasso has no size. */
  private nudgeSize(steps: number): void {
    if (this.tool === 'pen') this.setPenWidth(stepSize(PEN_SIZE, this.penWidth, steps));
    else if (this.tool !== 'lasso') {
      this.setEraserSize(stepSize(ERASER_SIZE, this.eraserSize, steps));
    }
  }

  /**
   * Clearing is an ordinary undoable edit, so it needs no "are you sure?" dialog. The
   * pages go with the writing; undoing brings back as many as the writing needs.
   */
  private clear(): void {
    if (this.store.size > 0) this.history.execute(new StrokeEdit([...this.store.all()], []));
    this.pages.trim();
  }

  private refresh(): void {
    this.notebook.dataset.empty = String(this.store.size === 0);
    this.pages.setInk(this.store.all());
    this.toolbar.update({
      tool: this.tool,
      eraser: this.eraser,
      penWidth: this.penWidth,
      penColor: this.penColor,
      eraserSize: this.eraserSize,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      canClear: this.store.size > 0,
      volume: this.feedback.volume,
      vibration: this.feedback.vibration,
      canVibrate: this.feedback.canVibrate,
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
    else if (key === 'l') this.setTool('lasso');
    else if (key === '[') this.nudgeSize(-1);
    else if (key === ']') this.nudgeSize(1);
    else if (key === 'delete' || key === 'backspace') {
      if (this.canvas.deleteSelection()) event.preventDefault();
    } else if (key === 'escape') this.canvas.clearSelection();
  }
}
