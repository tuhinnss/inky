import type { Tool } from '../canvas/InkCanvas';
import { VOLUME, volumeLabel } from './cues';
import { icons, penSample } from './icons';
import { INKS } from './inks';
import { buttonFor, press, type Eraser, type MenuName, type ToolButton } from './menus';
import { ERASER_SIZE, PEN_SIZE, placePanel, sizeLabel, type SizeRange } from './sizes';

export interface ToolbarState {
  tool: Tool;
  /** The eraser the eraser button picks up: the one used last. */
  eraser: Eraser;
  penWidth: number;
  penColor: string;
  /** Diameter of the eraser tip. */
  eraserSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  /** In percent; 0 is silent. */
  volume: number;
  vibration: boolean;
  /** Whether the device can vibrate for a web page at all. The switch is hidden if not. */
  canVibrate: boolean;
}

export interface ToolbarActions {
  selectTool(tool: Tool): void;
  setPenWidth(width: number): void;
  setPenColor(color: string): void;
  setEraserSize(size: number): void;
  undo(): void;
  redo(): void;
  clear(): void;
  setVolume(volume: number): void;
  setVibration(on: boolean): void;
  /** Plays a sound at the volume set, when the slider is let go. */
  previewSound(): void;
}

const ERASERS: ReadonlyArray<{ tool: Eraser; label: string; shortcut: string; icon: string }> = [
  { tool: 'stroke-eraser', label: 'Whole strokes', shortcut: 'E', icon: icons.strokeEraser },
  { tool: 'pixel-eraser', label: 'Part of a stroke', shortcut: 'R', icon: icons.pixelEraser },
];

/** A tool button and the menu it opens once its tool is in hand. */
interface Menu {
  button: HTMLButtonElement;
  panel: HTMLElement;
  /** Focused when the menu opens, so the arrow keys change the size straight away. */
  slider: HTMLInputElement;
  sizeValue: HTMLElement;
}

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
 * reports what the user asked for. The only thing it keeps to itself is which menu is open.
 *
 * The pen and the eraser each have a menu. The first press on either picks the tool up;
 * pressing it again while it is in hand opens the menu, with the size and the colour of the
 * pen, or the size of the eraser and what it rubs out.
 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly menus: Record<MenuName, Menu>;
  private readonly lassoButton: HTMLButtonElement;
  private readonly swatches = new Map<string, HTMLInputElement>();
  private readonly eraserModes = new Map<Eraser, HTMLInputElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly vibrationSwitch: HTMLInputElement;
  private readonly abort = new AbortController();

  /** The state last shown. What a press on a tool button does depends on what is in hand. */
  private state: ToolbarState | undefined;
  private open: MenuName | null = null;

  constructor(private readonly actions: ToolbarActions) {
    const signal = this.abort.signal;

    this.element = element('nav', 'toolbar');
    this.element.setAttribute('aria-label', 'Drawing tools');

    const tools = this.group('Tool');
    const sound = this.soundMenu();
    this.vibrationSwitch = sound.vibration;
    this.menus = { pen: this.penMenu(), eraser: this.eraserMenu(), sound: sound.menu };
    tools.append(this.menus.pen.button, this.menus.pen.panel);
    tools.append(this.menus.eraser.button, this.menus.eraser.panel);
    this.lassoButton = this.button(icons.lasso, 'Lasso: select to move or delete', 'L', () =>
      this.onPress('lasso'),
    );
    tools.append(this.lassoButton);

    const edits = this.group('History');
    this.undoButton = this.button(icons.undo, 'Undo', 'Ctrl+Z', () => actions.undo());
    this.redoButton = this.button(icons.redo, 'Redo', 'Ctrl+Y', () => actions.redo());
    this.clearButton = this.button(icons.clear, 'Clear all pages', '', () => actions.clear());
    edits.append(this.undoButton, this.redoButton, this.clearButton);

    const settings = this.group('Settings');
    settings.append(this.menus.sound.button, this.menus.sound.panel);

    this.element.append(tools, edits, settings);

    // A menu closes the way any menu does: press anywhere else, press Escape, or change the
    // layout under it. Capturing means the page still gets the press, so reaching for the
    // paper both closes the menu and starts the stroke.
    document.addEventListener('pointerdown', (event) => this.onOutsidePress(event), {
      signal,
      capture: true,
    });
    document.addEventListener('keydown', (event) => this.onKeyDown(event), { signal });
    window.addEventListener('resize', () => this.closeMenu(), { signal });
  }

  update(state: ToolbarState): void {
    this.state = state;
    const inHand = buttonFor(state.tool);
    for (const [name, { button }] of this.entries()) {
      if (name !== 'sound') button.setAttribute('aria-pressed', String(name === inHand));
    }
    this.lassoButton.setAttribute('aria-pressed', String(inHand === 'lasso'));
    // A menu belongs to the tool in hand. When a key changes the tool, its menu goes too.
    if (this.open && this.open !== 'sound' && this.open !== inHand) this.closeMenu();

    this.showSize(this.menus.pen, state.penWidth);
    this.showSize(this.menus.eraser, state.eraserSize);
    for (const [value, input] of this.swatches) input.checked = value === state.penColor;
    for (const [tool, input] of this.eraserModes) input.checked = tool === state.eraser;
    this.showEraser(state.eraser);

    // The pen icon, the sample line and the eraser tip all read these.
    this.element.style.setProperty('--pen-color', state.penColor);
    this.element.style.setProperty('--pen-size', `${state.penWidth}px`);
    this.element.style.setProperty('--eraser-size', `${state.eraserSize}px`);

    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.clearButton.disabled = !state.canClear;
    this.showVolume(state.volume);
    this.vibrationSwitch.checked = state.vibration;
    this.vibrationSwitch.closest('label')!.hidden = !state.canVibrate;
  }

  destroy(): void {
    this.abort.abort(); // removes every listener registered above and below in one call
    this.element.remove();
  }

  // ------------------------------------------------------------------ the menus

  private penMenu(): Menu {
    const button = this.button(icons.pen, 'Pen', 'P', () => this.onPress('pen'));
    button.classList.add('tool-pen');
    button.title = 'Pen (P). Press again for its size and colour';
    const size = this.sizeControl('Pen', PEN_SIZE, (width) => this.actions.setPenWidth(width));

    // The sample is drawn at the true width and in the true colour: exactly what you get.
    const preview = element('div', 'size-preview');
    preview.innerHTML = penSample;

    const colours = this.choices('swatches', 'Ink colour');
    for (const ink of INKS) {
      const swatch = element('label', 'swatch');
      swatch.style.setProperty('--swatch', ink.value);
      swatch.title = ink.name;
      const input = this.radio('ink', ink.value, () => this.actions.setPenColor(ink.value));
      input.setAttribute('aria-label', ink.name);
      swatch.append(input);
      colours.append(swatch);
      this.swatches.set(ink.value, input);
    }
    return this.menu(button, 'Pen', size, [preview, size.slider, colours]);
  }

  private eraserMenu(): Menu {
    const button = this.button('', 'Eraser', '', () => this.onPress('eraser'));
    button.title = 'Eraser (E, R). Press again for its size and what it rubs out';
    const size = this.sizeControl('Eraser', ERASER_SIZE, (s) => this.actions.setEraserSize(s));

    // The tip at its true size, as it is drawn under the pointer on the page.
    const preview = element('div', 'size-preview');
    preview.append(element('span', 'eraser-tip'));

    const modes = this.choices('eraser-modes', 'What it rubs out');
    for (const { tool, label, shortcut, icon } of ERASERS) {
      const option = element('label', 'eraser-mode');
      option.title = `${label} (${shortcut})`;
      option.innerHTML = `${icon}<span>${label}</span>`;
      const input = this.radio('eraser', tool, () => this.actions.selectTool(tool));
      option.prepend(input);
      modes.append(option);
      this.eraserModes.set(tool, input);
    }
    return this.menu(button, 'Eraser', size, [preview, size.slider, modes]);
  }

  /**
   * The speaker: the volume, heard as you let go of the slider, and the vibration switch.
   * Volume 0 is silence, so it needs no mute button of its own.
   */
  private soundMenu(): { menu: Menu; vibration: HTMLInputElement } {
    const button = this.button(icons.sound, 'Sound', '', () =>
      this.open === 'sound' ? this.closeMenu() : this.openMenu('sound'),
    );
    button.title = 'Sound and vibration';
    const volume = this.sizeControl(
      'Volume',
      VOLUME,
      (value) => this.actions.setVolume(value),
      'Volume',
    );
    volume.slider.addEventListener('change', () => this.actions.previewSound(), {
      signal: this.abort.signal,
    });

    const option = element('label', 'menu-switch');
    option.innerHTML = `${icons.vibration}<span>Vibration</span>`;
    const vibration = element('input', '');
    vibration.type = 'checkbox';
    vibration.addEventListener('change', () => this.actions.setVibration(vibration.checked), {
      signal: this.abort.signal,
    });
    option.prepend(vibration);

    return { menu: this.menu(button, 'Sound', volume, [volume.slider, option]), vibration };
  }

  private menu(
    button: HTMLButtonElement,
    name: string,
    size: { head: HTMLElement; slider: HTMLInputElement; value: HTMLElement },
    parts: HTMLElement[],
  ): Menu {
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const panel = element('div', 'tool-menu');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', name);
    panel.hidden = true;
    panel.append(size.head, ...parts);
    return { button, panel, slider: size.slider, sizeValue: size.value };
  }

  /** A heading with the size in it, and the slider that sets it. */
  private sizeControl(
    name: string,
    range: SizeRange,
    onSlide: (size: number) => void,
    label = `${name} size`,
  ): { head: HTMLElement; slider: HTMLInputElement; value: HTMLElement } {
    const title = element('span', 'size-name');
    title.textContent = name;
    const value = element('span', 'size-value');
    const head = element('p', 'size-head');
    head.append(title, value);

    const slider = element('input', 'size-slider');
    slider.type = 'range';
    slider.min = String(range.min);
    slider.max = String(range.max);
    slider.step = String(range.step);
    slider.setAttribute('aria-label', label);
    slider.addEventListener('input', () => onSlide(Number(slider.value)), {
      signal: this.abort.signal,
    });
    return { head, slider, value };
  }

  private showSize(menu: Menu, size: number): void {
    const label = sizeLabel(size);
    menu.slider.value = String(size);
    menu.slider.setAttribute('aria-valuetext', label);
    menu.sizeValue.textContent = label;
  }

  /**
   * The eraser button always shows an eraser, whichever kind it picks up: the two kinds
   * are told apart in its menu. Its label names the kind.
   */
  private showEraser(eraser: Eraser): void {
    const button = this.menus.eraser.button;
    if (button.dataset.eraser === eraser) return;
    const { label } = ERASERS.find((e) => e.tool === eraser)!;
    button.dataset.eraser = eraser;
    button.innerHTML = icons.eraser;
    button.setAttribute('aria-label', `Eraser: ${label.toLowerCase()}`);
  }

  /** The speaker shows what you hear: no waves when silent, one when quiet, two when loud. */
  private showVolume(volume: number): void {
    const { button, slider, sizeValue } = this.menus.sound;
    const label = volumeLabel(volume);
    slider.value = String(volume);
    slider.setAttribute('aria-valuetext', label);
    sizeValue.textContent = label;
    const icon = volume === 0 ? 'muted' : volume < 50 ? 'soundLow' : 'sound';
    if (button.dataset.icon === icon) return;
    button.dataset.icon = icon;
    button.innerHTML = icons[icon];
    button.setAttribute('aria-label', volume === 0 ? 'Sound: off' : 'Sound');
  }

  private onPress(button: ToolButton): void {
    if (!this.state) return;
    const result = press(button, this.state.tool, this.state.eraser, this.open);
    if ('select' in result) this.actions.selectTool(result.select);
    else if (result.menu) this.openMenu(result.menu);
    else this.closeMenu();
  }

  private openMenu(name: MenuName): void {
    this.closeMenu();
    const { button, panel, slider } = this.menus[name];
    this.open = name;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');

    // Measured and placed in the same task as it is shown, so it never paints elsewhere.
    const at = placePanel(
      button.getBoundingClientRect(),
      this.element.getBoundingClientRect(),
      panel.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
    slider.focus({ preventScroll: true });
  }

  private closeMenu(): void {
    if (!this.open) return;
    const { button, panel } = this.menus[this.open];
    this.open = null;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  private onOutsidePress(event: PointerEvent): void {
    if (!this.open || !(event.target instanceof Node)) return;
    const { button, panel } = this.menus[this.open];
    // A press on the menu's own button is left to its click handler, which closes it.
    if (panel.contains(event.target) || button.contains(event.target)) return;
    this.closeMenu();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.open) return;
    const { button } = this.menus[this.open];
    this.closeMenu();
    button.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------- building

  private entries(): Array<[MenuName, Menu]> {
    return Object.entries(this.menus) as Array<[MenuName, Menu]>;
  }

  /** A row of radio buttons. Real ones, so the arrow keys move along it for free. */
  private choices(className: string, label: string): HTMLElement {
    const row = element('div', className);
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', label);
    return row;
  }

  private radio(name: string, value: string, onChoose: () => void): HTMLInputElement {
    const input = element('input', '');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.addEventListener('change', onChoose, { signal: this.abort.signal });
    return input;
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
