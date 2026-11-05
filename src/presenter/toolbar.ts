import { icons, type IconName } from './icons';
import { appendPoint, drawStroke, shapePoints, usePageUnits, type InkKind, type PenType, type ShapeType, type Stroke } from './ink';
import {
  MARKER_PALETTE,
  PEN_PALETTE,
  PEN_TYPES,
  sliderToWidth,
  widthToSlider,
  type EraserMode,
  type Preferences,
  type WidthRange,
} from './session';
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
}

export interface ToolbarState {
  preferences: Preferences;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  index: number;
  total: number;
  /** Breite der Seite am Bildschirm. Die Vorschau zeigt den Strich so groß, wie er wirklich wird. */
  sheetWidth: number;
}

const AUTO_HIDE_MS = 5000;
const PREVIEW_HEIGHT = 56;
const PEN_SAMPLE_HEIGHT = 34;

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'laser', icon: 'laser', label: 'Laserpointer' },
  { tool: 'pen', icon: 'pen', label: 'Stift' },
  { tool: 'marker', icon: 'highlighter', label: 'Marker' },
  { tool: 'shape', icon: 'shapes', label: 'Formen' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer' },
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
    this.optionsButton = this.iconButton(this.colorGroup, 'sliders', 'Werkzeug einstellen', () => this.togglePanel());

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
    this.iconButton(pages, 'filePlus', 'Leere Seite einfügen', () => actions.insertBlank());

    const end = element('div', 'pp-group', this.bar);
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
      if (tool !== 'laser') this.togglePanel();
      return;
    }
    this.actions.selectTool(tool);
  }

  update(state: ToolbarState): void {
    this.state = state;
    const { preferences } = state;
    for (const [tool, button] of this.toolButtons) {
      button.classList.toggle('is-active', tool === preferences.tool);
      button.classList.toggle('has-options', tool === preferences.tool && tool !== 'laser');
      button.setAttribute('aria-pressed', String(tool === preferences.tool));
    }
    this.renderQuickColors(preferences);
    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.clearButton.disabled = !state.canClear;
    this.fingerButton.classList.toggle('is-active', preferences.fingerDraws);
    this.fingerButton.setAttribute('aria-pressed', String(preferences.fingerDraws));
    this.previousButton.disabled = state.index <= 0;
    this.nextButton.disabled = state.index >= state.total - 1;
    this.pageLabel.textContent = `${state.index + 1} / ${state.total}`;
    this.applyPinned(preferences.toolbarPinned);
    if (preferences.tool === 'laser') this.setPanelOpen(false);
    this.renderPanel();
    this.refreshPanelValues?.();
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
    this.colorGroup.style.display = preferences.tool === 'laser' ? 'none' : '';
    if (!kind) return;
    const quick = kind === 'marker' ? preferences.quickMarker : preferences.quickPen;
    const selected = kind === 'marker' ? preferences.markerColor : preferences.penColor;
    for (const color of quick) {
      const button = this.colorButton(color, this.colorName(color), color === selected);
      this.colorGroup.insertBefore(button, this.optionsButton);
    }
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

  private togglePanel(): void {
    this.setPanelOpen(!this.panelOpen);
    this.renderPanel();
    this.refreshPanelValues?.();
    this.restartTimer();
  }

  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.classList.toggle('is-open', open);
    if (!open) this.panelKey = '';
  }

  /** Baut das Feld nur neu, wenn sich sein Aufbau ändert. Sonst risse jeder Reglerschritt den Regler unter dem Finger weg. */
  private renderPanel(): void {
    if (!this.panelOpen || !this.state) return;
    const p = this.state.preferences;
    const key = JSON.stringify([
      p.tool, p.penType, p.penColor, p.markerColor, p.markerStraight, p.shapeType, p.eraserMode,
      p.customPen, p.customMarker, this.state.sheetWidth,
    ]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.replaceChildren();
    this.refreshPanelValues = null;
    if (p.tool === 'pen') this.buildPenPanel(p);
    else if (p.tool === 'marker') this.buildMarkerPanel(p);
    else if (p.tool === 'shape') this.buildShapePanel(p);
    else if (p.tool === 'eraser') this.buildEraserPanel(p);
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
    this.widthSection('pen', 'penWidth', p);
    this.colorSection(PEN_PALETTE, p.customPen, p.penColor);
    const refresh = this.refreshPanelValues as (() => void) | null;
    this.refreshPanelValues = () => {
      refresh?.();
      const state = this.state;
      if (!state) return;
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
    if (p.tool === 'pen') stroke.penType = p.penType;
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
