import { icons, type IconName } from './icons';
import { appendPoint, drawStroke, shapePoints, usePageUnits, type InkKind, type PenType, type ShapeType, type Stroke } from './ink';
import {
  MARKER_PALETTE,
  PEN_PALETTE,
  PEN_TYPES,
  SMOOTHING_LEVELS,
  TIMER_COLORS,
  TIMER_EFFECTS,
  slotMatches,
  sliderToWidth,
  widthToSlider,
  type EdgeMode,
  type EraserMode,
  type PenSlot,
  type Preferences,
  type WidthRange,
} from './session';
import { TIMER_SOUNDS } from './sound';
import type { TimerSize, TimerStatus } from './timer';
import type { Tool } from './types';

export interface ToolbarActions {
  selectTool(tool: Tool): void;
  selectColor(color: string): void;
  addCustomColor(color: string): void;
  change(patch: Partial<Preferences>): void;
  undo(): void;
  redo(): void;
  clearPage(): void;
  previous(): void;
  next(): void;
  overview(): void;
  insertBlank(): void;
  close(): void;
  timerSetMinutes(minutes: number): void;
  timerAdjust(minutes: number): void;
  timerStartPause(): void;
  timerReset(): void;
  /** Das Timerfeld ist offen: Die Anzeige zeigt schon Größe und Lage. */
  timerPreview(on: boolean): void;
  /** Effekt und Ton zur Probe; gibt dabei auch den Ton auf dem iPad frei */
  timerPreviewEnd(): void;
  selectPenSlot(index: number): void;
  storePenSlot(): void;
  lassoDelete(): void;
  lassoDuplicate(): void;
  lassoClear(): void;
  coverAll(): void;
  coverRemoveAll(): void;
  replay(): void;
  exportPdf(): void;
  switchGroup(name: string): void;
  switchFile(path: string): void;
  togglePlan(): void;
  showLine(line: number | null): void;
}

type PanelMode = 'tool' | 'timer' | 'more';

export interface MoreState {
  group: string;
  groups: string[];
  suggestions: string[];
  files: { path: string; label: string; current: boolean }[];
  hasPlan: boolean;
  planRunning: boolean;
  canExport: boolean;
  lineMessage: string;
}

export interface ToolbarState {
  preferences: Preferences;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  /** Position unter den sichtbaren Seiten, ab 1 */
  position: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Breite der Seite am Bildschirm. Die Vorschau zeigt den Strich so groß, wie er wirklich wird. */
  sheetWidth: number;
  timerStatus: TimerStatus;
  timerMinutes: number;
  /** Mit dem Lasso ist etwas ausgewählt */
  hasSelection: boolean;
  more: MoreState;
}

const AUTO_HIDE_MS = 5000;
const PREVIEW_HEIGHT = 56;
const PEN_SAMPLE_HEIGHT = 34;

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'laser', icon: 'laser', label: 'Zeiger' },
  { tool: 'pen', icon: 'pen', label: 'Stift' },
  { tool: 'marker', icon: 'highlighter', label: 'Marker' },
  { tool: 'shape', icon: 'shapes', label: 'Formen' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer' },
  { tool: 'cover', icon: 'cover', label: 'Abdecken' },
  { tool: 'lasso', icon: 'lasso', label: 'Lasso' },
];

const TIMER_MINUTES = [1, 2, 3, 5, 10, 15, 20, 30];

const TIMER_SIZES: { size: TimerSize; label: string }[] = [
  { size: 'small', label: 'Klein' },
  { size: 'medium', label: 'Mittel' },
  { size: 'large', label: 'Groß' },
  { size: 'huge', label: 'Riesig' },
];

const SHAPES: { type: ShapeType; icon: IconName; label: string }[] = [
  { type: 'line', icon: 'line', label: 'Linie' },
  { type: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { type: 'rectangle', icon: 'rectangle', label: 'Rechteck' },
  { type: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function sizedCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const scale = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  return canvas.getContext('2d');
}

/** Eine Schlangenlinie mit steigendem Druck, damit man den Charakter eines Stifts sieht. */
function sampleStroke(stroke: Stroke, pageWidthInCanvas: number, width: number, height: number): Stroke {
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (width * (0.04 + 0.92 * t)) / pageWidthInCanvas;
    const y = (height * (0.5 + 0.3 * Math.sin(t * Math.PI * 2.5))) / pageWidthInCanvas;
    appendPoint(stroke, x, y, 0.1 + 0.8 * Math.sin(t * Math.PI));
  }
  return stroke;
}

function paintSample(canvas: HTMLCanvasElement, stroke: Stroke, sheetWidth: number): void {
  const context = sizedCanvas(canvas);
  if (!context) return;
  const pixels = sheetWidth * (window.devicePixelRatio || 1);
  context.clearRect(0, 0, canvas.width, canvas.height);
  usePageUnits(context, pixels);
  if (stroke.kind === 'marker') context.globalAlpha = 0.55;
  drawStroke(context, stroke);
}

/**
 * Die Leiste ist per AirPlay für alle sichtbar. Deshalb bleibt sie eingeklappt,
 * bis sie gebraucht wird, und zieht sich von selbst wieder zurück. Die Einstellungen
 * eines Werkzeugs liegen in einem Feld darüber, das sich mit dem zweiten Tipp öffnet.
 */
export class Toolbar {
  private dock: HTMLElement;
  private bar: HTMLElement;
  private panel: HTMLElement;
  private handle: HTMLElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private colorGroup: HTMLElement;
  private optionsButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private clearButton: HTMLButtonElement;
  private fingerButton: HTMLButtonElement;
  private previousButton: HTMLButtonElement;
  private nextButton: HTMLButtonElement;
  private pageLabel: HTMLElement;
  private pinButton: HTMLButtonElement;
  private timerButton: HTMLButtonElement;
  private moreButton: HTMLButtonElement;
  private panelMode: PanelMode = 'tool';
  private pinned = false;
  private hideTimer = 0;
  private visible = false;
  private panelOpen = false;
  private panelKey = '';
  private state: ToolbarState | null = null;
  private refreshPanelValues: (() => void) | null = null;

  constructor(root: HTMLElement, private actions: ToolbarActions) {
    this.handle = element('button', 'pp-handle', root);
    this.handle.setAttribute('aria-label', 'Werkzeuge einblenden');
    this.handle.addEventListener('click', () => this.show());

    this.dock = element('div', 'pp-dock', root);
    this.panel = element('div', 'pp-panel', this.dock);
    this.panel.addEventListener('pointerdown', () => this.restartTimer());
    this.bar = element('div', 'pp-toolbar', this.dock);
    this.bar.setAttribute('role', 'toolbar');
    this.bar.addEventListener('pointerdown', () => this.restartTimer());

    const tools = element('div', 'pp-group', this.bar);
    for (const { tool, icon, label } of TOOLS) {
      this.toolButtons.set(tool, this.iconButton(tools, icon, label, () => this.onToolTap(tool)));
    }

    this.colorGroup = element('div', 'pp-group', this.bar);
    this.optionsButton = this.iconButton(this.colorGroup, 'sliders', 'Werkzeug einstellen', () => this.togglePanel('tool'));

    const edit = element('div', 'pp-group', this.bar);
    this.undoButton = this.iconButton(edit, 'undo', 'Rückgängig', () => actions.undo());
    this.redoButton = this.iconButton(edit, 'redo', 'Wiederholen', () => actions.redo());
    this.clearButton = this.iconButton(edit, 'trash', 'Seite leeren', () => actions.clearPage());
    this.fingerButton = this.iconButton(edit, 'hand', 'Mit dem Finger zeichnen', () =>
      actions.change({ fingerDraws: !this.state?.preferences.fingerDraws }),
    );

    const pages = element('div', 'pp-group', this.bar);
    this.previousButton = this.iconButton(pages, 'chevronLeft', 'Vorherige Seite', () => actions.previous());
    this.pageLabel = element('span', 'pp-page-label', pages);
    this.nextButton = this.iconButton(pages, 'chevronRight', 'Nächste Seite', () => actions.next());
    this.iconButton(pages, 'layoutGrid', 'Seitenübersicht', () => actions.overview());

    const end = element('div', 'pp-group', this.bar);
    this.timerButton = this.iconButton(end, 'timer', 'Timer', () => this.togglePanel('timer'));
    this.moreButton = this.iconButton(end, 'more', 'Mehr', () => this.togglePanel('more'));
    this.pinButton = this.iconButton(end, 'pin', 'Werkzeugleiste fixieren', () =>
      actions.change({ toolbarPinned: !this.state?.preferences.toolbarPinned }),
    );
    this.iconButton(end, 'close', 'Präsentation beenden', () => actions.close());
    this.hide();
  }

  private iconButton(parent: HTMLElement, icon: IconName, label: string, action: () => void): HTMLButtonElement {
    const button = element('button', 'pp-button', parent);
    button.innerHTML = icons[icon];
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', action);
    return button;
  }

  /** Erster Tipp wählt das Werkzeug, der zweite öffnet seine Einstellungen. */
  private onToolTap(tool: Tool): void {
    if (this.state?.preferences.tool === tool) {
      this.togglePanel('tool');
      return;
    }
    // Ist gerade ein Feld offen, zeigt es danach die Einstellungen des neuen Werkzeugs.
    if (this.panelMode !== 'tool') this.setPanelOpen(false);
    this.actions.selectTool(tool);
  }

  update(state: ToolbarState): void {
    this.state = state;
    const { preferences } = state;
    for (const [tool, button] of this.toolButtons) {
      button.classList.toggle('is-active', tool === preferences.tool);
      button.classList.toggle('has-options', tool === preferences.tool);
      button.setAttribute('aria-pressed', String(tool === preferences.tool));
    }
    this.renderQuickColors(preferences);
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.clearButton.disabled = !state.canClear;
    this.fingerButton.classList.toggle('is-active', preferences.fingerDraws);
    this.fingerButton.setAttribute('aria-pressed', String(preferences.fingerDraws));
    this.previousButton.disabled = !state.hasPrevious;
    this.nextButton.disabled = !state.hasNext;
    this.pageLabel.textContent = `${state.position} / ${state.total}`;
    this.applyPinned(preferences.toolbarPinned);
    this.timerButton.classList.toggle('is-active', state.timerStatus === 'running' || state.timerStatus === 'paused');
    this.moreButton.classList.toggle('is-active', this.panelOpen && this.panelMode === 'more');
    this.renderPanel();
    // Nur bei offenem Feld: Die Muster zu zeichnen kostet sonst bei jedem Strichende Zeit.
    if (this.panelOpen) this.refreshPanelValues?.();
  }

  /** Die Leiste selbst, damit die Seite ihr ausweichen kann. */
  get barElement(): HTMLElement {
    return this.bar;
  }

  private applyPinned(pinned: boolean): void {
    const changed = pinned !== this.pinned;
    this.pinned = pinned;
    this.pinButton.classList.toggle('is-active', pinned);
    this.pinButton.setAttribute('aria-pressed', String(pinned));
    if (!changed) return;
    const label = pinned ? 'Werkzeugleiste lösen' : 'Werkzeugleiste fixieren';
    this.pinButton.innerHTML = icons[pinned ? 'pinOff' : 'pin'];
    this.pinButton.setAttribute('aria-label', label);
    this.pinButton.title = label;
    if (pinned) this.show();
    else this.restartTimer();
  }

  // ---------- Schnellfarben ----------

  private inkKind(preferences: Preferences): InkKind | null {
    if (preferences.tool === 'marker') return 'marker';
    if (preferences.tool === 'pen' || preferences.tool === 'shape') return 'pen';
    return null;
  }

  private renderQuickColors(preferences: Preferences): void {
    const kind = this.inkKind(preferences);
    this.colorGroup.querySelectorAll('.pp-color').forEach((node) => node.remove());
    this.colorGroup.style.display = ['laser', 'cover', 'lasso'].includes(preferences.tool) ? 'none' : '';
    if (!kind) return;
    if (preferences.tool === 'pen') {
      preferences.penSlots.forEach((slot, index) => this.colorGroup.insertBefore(this.slotButton(slot, index, preferences), this.optionsButton));
      return;
    }
    const quick = kind === 'marker' ? preferences.quickMarker : preferences.quickPen;
    const selected = kind === 'marker' ? preferences.markerColor : preferences.penColor;
    for (const color of quick) {
      const button = this.colorButton(color, this.colorName(color), color === selected);
      this.colorGroup.insertBefore(button, this.optionsButton);
    }
  }

  /** Ein Fach der Stiftablage: Farbe als Punkt, je dicker der Stift, desto größer der Punkt */
  private slotButton(slot: PenSlot, index: number, preferences: Preferences): HTMLButtonElement {
    const selected = slotMatches(slot, preferences);
    const type = PEN_TYPES.find((entry) => entry.type === slot.penType)?.label ?? 'Stift';
    const name = `Fach ${index + 1}: ${type}, ${this.colorName(slot.color)}`;
    const button = document.createElement('button');
    button.className = 'pp-button pp-color pp-slot';
    button.title = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-active', selected);
    const swatch = element('span', 'pp-swatch', button);
    swatch.style.background = slot.color;
    const size = 12 + 14 * Math.max(0, Math.min(1, widthToSlider('pen', slot.width)));
    swatch.style.width = `${size}px`;
    swatch.style.height = `${size}px`;
    button.addEventListener('click', () => this.actions.selectPenSlot(index));
    return button;
  }

  private colorName(color: string): string {
    const known = [...PEN_PALETTE, ...MARKER_PALETTE].find((entry) => entry.value === color);
    return known ? known.name : `Farbe ${color}`;
  }

  private colorButton(color: string, name: string, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pp-button pp-color';
    button.title = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-active', selected);
    const swatch = element('span', 'pp-swatch', button);
    swatch.style.background = color;
    button.addEventListener('click', () => this.actions.selectColor(color));
    return button;
  }

  // ---------- Einstellungsfeld ----------

  private togglePanel(mode: PanelMode): void {
    const closing = this.panelOpen && this.panelMode === mode;
    this.setPanelOpen(false);
    this.panelMode = mode;
    if (!closing) this.setPanelOpen(true);
    this.renderPanel();
    this.refreshPanelValues?.();
    this.restartTimer();
  }

  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.classList.toggle('is-open', open);
    if (!open) this.panelKey = '';
    this.actions.timerPreview(open && this.panelMode === 'timer');
  }

  /** Baut das Feld nur neu, wenn sich sein Aufbau ändert. Sonst risse jeder Reglerschritt den Regler unter dem Finger weg. */
  private renderPanel(): void {
    if (!this.panelOpen || !this.state) return;
    const p = this.state.preferences;
    const key = JSON.stringify([
      this.panelMode, this.state.timerStatus, this.state.timerMinutes, p.timerSize, p.edgeMode, p.pointerMode, this.state.more,
      p.laserHold, p.timerColor, p.timerEffect, p.timerSound, p.holdToShape, p.penSlots, p.penSlot, this.state.hasSelection,
      p.tool, p.penType, p.penSmoothing, p.penColor, p.markerColor, p.markerStraight, p.shapeType, p.eraserMode,
      p.customPen, p.customMarker, this.state.sheetWidth,
    ]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.replaceChildren();
    this.refreshPanelValues = null;
    if (this.panelMode === 'timer') this.buildTimerPanel(p);
    else if (this.panelMode === 'more') this.buildMorePanel(p);
    else if (p.tool === 'laser') this.buildPointerPanel(p);
    else if (p.tool === 'cover') this.buildCoverPanel();
    else if (p.tool === 'pen') this.buildPenPanel(p);
    else if (p.tool === 'marker') this.buildMarkerPanel(p);
    else if (p.tool === 'shape') this.buildShapePanel(p);
    else if (p.tool === 'eraser') this.buildEraserPanel(p);
    else if (p.tool === 'lasso') this.buildLassoPanel();
  }

  private buildTimerPanel(p: Preferences): void {
    const state = this.state as ToolbarState;
    const durations = element('div', 'pp-chips pp-chips-small', this.section('Dauer in Minuten'));
    for (const minutes of TIMER_MINUTES) {
      this.chip(durations, String(minutes), state.timerMinutes === minutes, () => this.actions.timerSetMinutes(minutes));
    }
    const stepper = element('div', 'pp-stepper', this.panel.lastElementChild as HTMLElement);
    this.textButton(stepper, '− 1 Min.', () => this.actions.timerAdjust(-1));
    element('span', 'pp-stepper-value', stepper).textContent = `${state.timerMinutes} Min.`;
    this.textButton(stepper, '+ 1 Min.', () => this.actions.timerAdjust(1));

    const sizes = element('div', 'pp-chips', this.section('Größe'));
    for (const { size, label } of TIMER_SIZES) {
      this.chip(sizes, label, p.timerSize === size, () => this.actions.change({ timerSize: size }));
    }

    const colors = element('div', 'pp-colors', this.section('Farbe'));
    for (const { name, value } of TIMER_COLORS) {
      const button = element('button', 'pp-button pp-color', colors);
      button.title = name;
      button.setAttribute('aria-label', `Timerfarbe ${name}`);
      button.setAttribute('aria-pressed', String(p.timerColor === value));
      button.classList.toggle('is-active', p.timerColor === value);
      element('span', 'pp-swatch', button).style.background = value;
      button.addEventListener('click', () => this.actions.change({ timerColor: value }));
    }
    // Eigene Farbe über den Farbwähler des Systems. Sie bleibt als Punkt stehen, solange sie gewählt ist.
    const own = !TIMER_COLORS.some((entry) => entry.value === p.timerColor);
    if (own) {
      const button = element('button', 'pp-button pp-color is-active', colors);
      button.title = 'Eigene Farbe';
      button.setAttribute('aria-label', 'Timerfarbe eigene');
      button.setAttribute('aria-pressed', 'true');
      element('span', 'pp-swatch', button).style.background = p.timerColor;
    }
    const add = element('label', 'pp-button pp-color-add', colors);
    add.title = 'Eigene Farbe';
    add.innerHTML = icons.plus;
    const picker = element('input', 'pp-color-input', add);
    picker.type = 'color';
    picker.value = p.timerColor;
    picker.setAttribute('aria-label', 'Eigene Timerfarbe wählen');
    picker.addEventListener('click', () => this.restartTimer());
    picker.addEventListener('change', () => this.actions.change({ timerColor: picker.value.toLowerCase() }));
    const effects = element('div', 'pp-chips', this.section('Bei null'));
    for (const { effect, label } of TIMER_EFFECTS) {
      this.chip(effects, label, p.timerEffect === effect, () => this.actions.change({ timerEffect: effect }));
    }
    const sounds = element('div', 'pp-chips', this.section('Ton'));
    for (const { sound, label } of TIMER_SOUNDS) {
      this.chip(sounds, label, p.timerSound === sound, () => {
        this.actions.change({ timerSound: sound });
        if (sound !== 'off') this.actions.timerPreviewEnd();
      });
    }
    const preview = element('div', 'pp-timer-controls', this.panel);
    this.textButton(preview, 'Ende vorführen', () => this.actions.timerPreviewEnd());
    const controls = element('div', 'pp-timer-controls', this.panel);
    const running = state.timerStatus === 'running';
    const label = running ? 'Anhalten' : state.timerStatus === 'paused' ? 'Fortsetzen' : 'Starten';
    this.textButton(controls, label, () => {
      this.actions.timerStartPause();
      // Sobald er läuft, soll die Klasse die Zeit sehen und nicht dieses Feld.
      if (!running) this.collapse();
    }).classList.add('is-primary');
    if (state.timerStatus !== 'idle') this.textButton(controls, 'Zurücksetzen', () => this.actions.timerReset());
    const hint = element('div', 'pp-hint', this.panel);
    hint.textContent = 'Die Anzeige lässt sich mit dem Finger verschieben. Ein Tipp darauf hält sie an. Der Ton kommt über AirPlay aus dem Board.';
  }

  private buildPointerPanel(p: Preferences): void {
    const modes = element('div', 'pp-chips', this.section('Zeiger'));
    this.chip(modes, 'Laserpointer', p.pointerMode === 'laser', () => this.actions.change({ pointerMode: 'laser' }));
    this.chip(modes, 'Schlüsselloch', p.pointerMode === 'spot', () => this.actions.change({ pointerMode: 'spot' }));
    if (p.pointerMode !== 'spot') {
      const trail = element('div', 'pp-chips', this.section('Laserspur'));
      this.chip(trail, 'Bleibt, solange der Stift aufliegt', p.laserHold, () => this.actions.change({ laserHold: true }));
      this.chip(trail, 'Verblasst gleich', !p.laserHold, () => this.actions.change({ laserHold: false }));
      element('div', 'pp-hint', trail.parentElement as HTMLElement).textContent =
        'Bleibt der Stift liegen, bleibt auch die Spur, so lässt sich ein Bereich länger einkreisen. Nach dem Absetzen verblasst sie.';
      return;
    }
    const section = this.section('Größe des Sichtfensters');
    const slider = element('input', 'pp-slider', section);
    slider.type = 'range';
    slider.min = '0.06';
    slider.max = '0.45';
    slider.step = '0.01';
    slider.value = String(p.spotSize);
    slider.setAttribute('aria-label', 'Größe des Sichtfensters');
    slider.addEventListener('input', () => {
      this.restartTimer();
      this.actions.change({ spotSize: Number(slider.value) });
    });
    element('div', 'pp-hint', this.panel).textContent = 'Stift oder Finger verschiebt das Sichtfenster. Geblättert wird über die Leiste.';
  }

  private buildCoverPanel(): void {
    element('div', 'pp-hint', this.section('Abdecken')).textContent =
      'Mit dem Stift eine Fläche aufziehen, ein Stifttipp entfernt sie. In der Stunde mit dem Finger wegziehen wie ein Blatt auf dem Overheadprojektor, oder antippen.';
    const controls = element('div', 'pp-timer-controls', this.panel);
    this.textButton(controls, 'Alle wieder abdecken', () => this.actions.coverAll());
    this.textButton(controls, 'Alle entfernen', () => this.actions.coverRemoveAll());
  }

  private buildMorePanel(p: Preferences): void {
    const more = (this.state as ToolbarState).more;

    const groups = element('div', 'pp-chips', this.section('Tintenstand'));
    this.chip(groups, 'Standard', more.group === '', () => this.actions.switchGroup(''));
    const names = [...new Set([...more.groups, ...more.suggestions, ...(more.group ? [more.group] : [])])];
    for (const name of names) this.chip(groups, name, more.group === name, () => this.actions.switchGroup(name));
    const adding = element('div', 'pp-stepper', this.panel.lastElementChild as HTMLElement);
    const input = element('input', 'pp-text-input', adding);
    input.type = 'text';
    input.placeholder = 'Neue Lerngruppe, zum Beispiel 8a';
    input.setAttribute('aria-label', 'Name der neuen Lerngruppe');
    this.textButton(adding, 'Anlegen', () => {
      if (input.value.trim()) this.actions.switchGroup(input.value);
    });

    if (more.files.length > 1) {
      const files = element('div', 'pp-chips', this.section('Stundenmappe'));
      for (const file of more.files) this.chip(files, file.label, file.current, () => this.actions.switchFile(file.path));
    }

    const lesson = element('div', 'pp-timer-controls', this.section('In der Stunde'));
    this.textButton(lesson, 'Leere Seite einfügen', () => {
      this.collapse();
      this.actions.insertBlank();
    });
    if (more.hasPlan) this.textButton(lesson, more.planRunning ? 'Planzeit aus' : 'Planzeit starten', () => this.actions.togglePlan());
    this.textButton(lesson, 'Tafel neu entstehen lassen', () => {
      this.collapse();
      this.actions.replay();
    });

    const lineSection = this.section('Zeile hervorheben');
    const lineRow = element('div', 'pp-stepper', lineSection);
    const lineInput = element('input', 'pp-text-input', lineRow);
    lineInput.type = 'number';
    lineInput.min = '1';
    lineInput.inputMode = 'numeric';
    lineInput.placeholder = 'Zeile';
    lineInput.setAttribute('aria-label', 'Zeilennummer');
    this.textButton(lineRow, 'Zeigen', () => this.actions.showLine(Number(lineInput.value) || null));
    this.textButton(lineRow, 'Aus', () => this.actions.showLine(null));
    if (more.lineMessage) element('div', 'pp-hint', lineSection).textContent = more.lineMessage;

    if (more.canExport) {
      const exporting = element('div', 'pp-timer-controls', this.section('Sichern'));
      this.textButton(exporting, 'Als PDF mit Tinte sichern', () => this.actions.exportPdf());
    }

    const edgeSection = this.section('Fläche um die Folie');
    const modes = element('div', 'pp-chips', edgeSection);
    const select = (edgeMode: EdgeMode) => () => this.actions.change({ edgeMode });
    this.chip(modes, 'Wie die Folie', p.edgeMode === 'page', select('page'));
    this.chip(modes, 'Schwarz', p.edgeMode === 'black', select('black'));
    element('div', 'pp-hint', edgeSection).textContent =
      'Die Balken links und rechts am Board kommen von der AirPlay-Spiegelung. Dagegen hilft höchstens eine Zoom-Einstellung am Board.';
  }

  private textButton(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const button = element('button', 'pp-text-button', parent);
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  private section(title: string): HTMLElement {
    const section = element('div', 'pp-section', this.panel);
    element('div', 'pp-section-title', section).textContent = title;
    return section;
  }

  private buildPenPanel(p: Preferences): void {
    const types = element('div', 'pp-chips', this.section('Stiftart'));
    const samples: { canvas: HTMLCanvasElement; type: PenType }[] = [];
    for (const { type, label } of PEN_TYPES) {
      const chip = this.chip(types, label, p.penType === type, () => this.actions.change({ penType: type }));
      chip.classList.add('pp-chip-pen');
      const canvas = document.createElement('canvas');
      canvas.className = 'pp-chip-sample';
      chip.prepend(canvas);
      samples.push({ canvas, type });
    }
    const slots = element('div', 'pp-chips pp-slot-chips', this.section('Stiftablage'));
    const slotSamples: { canvas: HTMLCanvasElement; slot: PenSlot }[] = [];
    p.penSlots.forEach((slot, index) => {
      const chip = this.chip(slots, `Fach ${index + 1}`, slotMatches(slot, p), () => this.actions.selectPenSlot(index));
      chip.classList.add('pp-chip-slot');
      chip.classList.toggle('is-target', index === p.penSlot);
      const canvas = document.createElement('canvas');
      canvas.className = 'pp-chip-sample';
      chip.prepend(canvas);
      slotSamples.push({ canvas, slot });
    });
    const store = element('div', 'pp-timer-controls', this.panel.lastElementChild as HTMLElement);
    this.textButton(store, `Aktuellen Stift in Fach ${p.penSlot + 1} ablegen`, () => this.actions.storePenSlot());
    this.holdSection(p);
    const smoothing = element('div', 'pp-chips', this.section('Glättung'));
    for (const { level, label } of SMOOTHING_LEVELS) {
      this.chip(smoothing, label, p.penSmoothing === level, () => this.actions.change({ penSmoothing: level }));
    }
    this.widthSection('pen', 'penWidth', p);
    this.colorSection(PEN_PALETTE, p.customPen, p.penColor);
    const refresh = this.refreshPanelValues as (() => void) | null;
    this.refreshPanelValues = () => {
      refresh?.();
      const state = this.state;
      if (!state) return;
      for (const { canvas, slot } of slotSamples) {
        const rect = canvas.getBoundingClientRect();
        const stroke: Stroke = { kind: 'pen', color: slot.color, penType: slot.penType, smoothing: slot.smoothing, width: slot.width, points: [] };
        paintSample(canvas, sampleStroke(stroke, state.sheetWidth, rect.width, PEN_SAMPLE_HEIGHT), state.sheetWidth);
      }
      for (const { canvas, type } of samples) {
        const rect = canvas.getBoundingClientRect();
        const stroke: Stroke = {
          kind: 'pen',
          color: '#f2f2f2',
          penType: type,
          // Die Muster zeigen die Stiftart, nicht die Strichstärke: immer dieselbe gut sichtbare Größe.
          width: 3 / 200,
          points: [],
        };
        paintSample(canvas, sampleStroke(stroke, 200, rect.width, PEN_SAMPLE_HEIGHT), 200);
      }
    };
  }

  private buildMarkerPanel(p: Preferences): void {
    const modes = element('div', 'pp-chips', this.section('Spitze'));
    this.chip(modes, 'Freihand', !p.markerStraight, () => this.actions.change({ markerStraight: false }));
    this.chip(modes, 'Gerade', p.markerStraight, () => this.actions.change({ markerStraight: true }));
    if (!p.markerStraight) this.holdSection(p);
    this.widthSection('marker', 'markerWidth', p);
    this.colorSection(MARKER_PALETTE, p.customMarker, p.markerColor);
  }

  private buildShapePanel(p: Preferences): void {
    const forms = element('div', 'pp-chips', this.section('Form'));
    for (const { type, icon, label } of SHAPES) {
      const chip = this.chip(forms, label, p.shapeType === type, () => this.actions.change({ shapeType: type }));
      const glyph = document.createElement('span');
      glyph.className = 'pp-chip-icon';
      glyph.innerHTML = icons[icon];
      chip.prepend(glyph);
    }
    this.widthSection('pen', 'penWidth', p);
    this.colorSection(PEN_PALETTE, p.customPen, p.penColor);
  }

  private holdSection(p: Preferences): void {
    const hold = element('div', 'pp-chips', this.section('Zeichnen und halten'));
    this.chip(hold, 'An', p.holdToShape, () => this.actions.change({ holdToShape: true }));
    this.chip(hold, 'Aus', !p.holdToShape, () => this.actions.change({ holdToShape: false }));
    element('div', 'pp-hint', hold.parentElement as HTMLElement).textContent =
      'Stift am Ende kurz stehen lassen: Aus dem Strich wird eine gerade Linie, ein Rechteck oder eine Ellipse. Bei der Linie folgt das Ende dem Stift, bis du absetzt.';
  }

  private buildLassoPanel(): void {
    element('div', 'pp-hint', this.section('Lasso')).textContent =
      'Mit dem Stift Tinte umkreisen. Die Auswahl mit dem Stift verschieben, oder unten kopieren und löschen.';
    const has = (this.state as ToolbarState).hasSelection;
    const controls = element('div', 'pp-timer-controls', this.panel);
    this.textButton(controls, 'Kopieren', () => this.actions.lassoDuplicate()).disabled = !has;
    this.textButton(controls, 'Löschen', () => this.actions.lassoDelete()).disabled = !has;
    this.textButton(controls, 'Aufheben', () => this.actions.lassoClear()).disabled = !has;
  }

  private buildEraserPanel(p: Preferences): void {
    const modes = element('div', 'pp-chips', this.section('Radiert'));
    const select = (eraserMode: EraserMode) => () => this.actions.change({ eraserMode });
    this.chip(modes, 'Ganzen Strich', p.eraserMode === 'stroke', select('stroke'));
    this.chip(modes, 'Nur die Stelle', p.eraserMode === 'partial', select('partial'));
    this.widthSection('eraser', 'eraserSize', p);
  }

  private chip(parent: HTMLElement, label: string, selected: boolean, action: () => void): HTMLButtonElement {
    const chip = element('button', 'pp-chip', parent);
    chip.classList.toggle('is-active', selected);
    chip.setAttribute('aria-pressed', String(selected));
    element('span', 'pp-chip-label', chip).textContent = label;
    chip.addEventListener('click', action);
    return chip;
  }

  private widthSection(range: WidthRange, key: 'penWidth' | 'markerWidth' | 'eraserSize', p: Preferences): void {
    const section = this.section(range === 'eraser' ? 'Größe' : 'Strichstärke');
    const row = element('div', 'pp-width-row', section);
    const slider = element('input', 'pp-slider', row);
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = String(widthToSlider(range, p[key]));
    slider.setAttribute('aria-label', range === 'eraser' ? 'Größe' : 'Strichstärke');
    slider.addEventListener('input', () => {
      this.restartTimer();
      this.actions.change({ [key]: sliderToWidth(range, Number(slider.value)) });
    });
    const preview = element('canvas', 'pp-preview', section);
    preview.style.height = `${PREVIEW_HEIGHT}px`;
    this.refreshPanelValues = () => this.paintPreview(preview);
  }

  private paintPreview(canvas: HTMLCanvasElement): void {
    const state = this.state;
    if (!state) return;
    const p = state.preferences;
    const rect = canvas.getBoundingClientRect();
    if (p.tool === 'eraser') {
      const context = sizedCanvas(canvas);
      if (!context) return;
      const scale = window.devicePixelRatio || 1;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#6b7280';
      context.lineWidth = 1.5 * scale;
      context.beginPath();
      context.arc(canvas.width / 2, canvas.height / 2, p.eraserSize * state.sheetWidth * scale, 0, Math.PI * 2);
      context.stroke();
      return;
    }
    const kind: InkKind = p.tool === 'marker' ? 'marker' : 'pen';
    const stroke: Stroke = {
      kind,
      color: kind === 'marker' ? p.markerColor : p.penColor,
      width: kind === 'marker' ? p.markerWidth : p.penWidth,
      points: [],
    };
    if (p.tool === 'pen') {
      stroke.penType = p.penType;
      stroke.smoothing = p.penSmoothing;
    }
    if (p.tool === 'shape' || (p.tool === 'marker' && p.markerStraight)) {
      stroke.sharp = true;
      const type: ShapeType = p.tool === 'shape' ? p.shapeType : 'line';
      const w = state.sheetWidth;
      const box = type === 'line' || type === 'arrow' ? 0.25 : 0.2;
      stroke.points = shapePoints(
        type,
        { x: (rect.width * (0.5 - box)) / w, y: (rect.height * 0.8) / w },
        { x: (rect.width * (0.5 + box)) / w, y: (rect.height * 0.2) / w },
        stroke.width,
      );
    } else {
      sampleStroke(stroke, state.sheetWidth, rect.width, rect.height);
    }
    paintSample(canvas, stroke, state.sheetWidth);
  }

  private colorSection(palette: { name: string; value: string }[], custom: string[], selected: string): void {
    const grid = element('div', 'pp-colors', this.section('Farbe'));
    for (const { name, value } of palette) grid.appendChild(this.colorButton(value, name, value === selected));
    for (const value of custom) grid.appendChild(this.colorButton(value, `Eigene Farbe ${value}`, value === selected));
    const add = element('label', 'pp-button pp-color-add', grid);
    add.title = 'Eigene Farbe';
    add.innerHTML = icons.plus;
    const input = element('input', 'pp-color-input', add);
    input.type = 'color';
    input.value = selected;
    input.setAttribute('aria-label', 'Eigene Farbe wählen');
    // Solange der Farbwähler des Systems offen ist, soll die Leiste nicht verschwinden.
    input.addEventListener('click', () => this.restartTimer());
    input.addEventListener('change', () => this.actions.addCustomColor(input.value));
  }

  // ---------- Ein- und Ausblenden ----------

  private restartTimer(): void {
    window.clearTimeout(this.hideTimer);
    if (this.panelOpen || this.pinned) return;
    this.hideTimer = window.setTimeout(() => this.hide(), AUTO_HIDE_MS);
  }

  show(): void {
    this.visible = true;
    this.bar.classList.add('is-open');
    this.handle.classList.add('is-hidden');
    this.restartTimer();
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.visible = false;
    this.setPanelOpen(false);
    this.bar.classList.remove('is-open');
    this.handle.classList.remove('is-hidden');
  }

  /** Beim Schreiben: Das Feld geht immer zu, die Leiste nur, wenn sie nicht fixiert ist. */
  collapse(): void {
    if (this.pinned) this.setPanelOpen(false);
    else this.hide();
  }

  toggle(): void {
    if (this.pinned) this.setPanelOpen(false);
    else if (this.visible) this.hide();
    else this.show();
  }

  destroy(): void {
    window.clearTimeout(this.hideTimer);
  }
}
