import { GestureRouter } from './gestures';
import {
  appendPoint,
  drawStroke,
  shapePoints,
  type InkKind,
  type ShapeType,
  type Stroke,
} from './ink';
import { Laser } from './laser';
import { SampleFilter } from './samples';
import { Overview } from './overview';
import { PageRenderer, releaseCanvas } from './pageRenderer';
import {
  loadPreferences,
  savePreferences,
  withCustomColor,
  withQuickColor,
  type Preferences,
  type PresentationSession,
  type Slide,
} from './session';
import { TimerWidget } from './timer';
import { Toolbar } from './toolbar';
import type { PdfDocument, Tool } from './types';
import {
  clampView,
  fitSheet,
  keyZoomFactor,
  medianColor,
  rasterWidth,
  snapSize,
  snapView,
  visibleRegion,
  wheelAction,
  zoomAround,
  type Size,
  type ViewState,
} from './view';

const MAX_PAGE_PIXELS = 12_000_000;
const RERASTER_DELAY_MS = 180;
const DOUBLE_TAP_MS = 320;
/** Linker und rechter Rand blättern beim Antippen. */
const TAP_ZONE = 0.22;
const DEFAULT_ASPECT = 0.75;
/** Kürzer gezogene Formen gelten als versehentlicher Tipp. */
const MIN_SHAPE_SIZE = 0.004;
/** Abstand der fixierten Leiste zur Seite und zum Rand */
const TOOLBAR_GAP = 16;

type InkPointerEvent = PointerEvent;

/** Eine Form oder ein gerader Marker, solange der Stift noch zieht. */
interface ShapeDrag {
  kind: InkKind;
  type: ShapeType;
  color: string;
  width: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface PresenterOptions {
  doc: PdfDocument;
  session: PresentationSession;
  /** Tinte oder Seiten haben sich geändert */
  onChange?(): void;
  /** Eine andere Seite wird gezeigt */
  onPageChange?(index: number): void;
  /** Das Gerät schickt die App in den Hintergrund, und iPadOS kann sie danach jederzeit beenden. */
  onHidden?(): void;
  onClose(): void;
}

/** Vollbild-Präsentation eines PDFs. Kennt Obsidian nicht und läuft auch im Test-Harness. */
export class Presenter {
  private root: HTMLElement;
  private stage: HTMLElement;
  private sheet: HTMLElement;
  private pageSlot: HTMLElement;
  private markerLayer: HTMLCanvasElement;
  private inkLayer: HTMLCanvasElement;
  /** Für alles, was noch nicht fertig ist: laufender Strich, Formvorschau, Laser */
  private transientLayer: HTMLCanvasElement;
  private detail: HTMLCanvasElement | null = null;
  private detailTask: { cancel(): void } | null = null;
  private detailToken = 0;
  private inkFrame = 0;
  private liveFrame = 0;
  private toolbar: Toolbar;
  private timer: TimerWidget;
  /** Randfarbe je PDF-Seite. Sie auszulesen kostet auf dem iPad etwas. */
  private edgeColors = new Map<number, string>();
  private edgeColor = '#fff';
  private laser: Laser;
  private router: GestureRouter<InkPointerEvent>;
  private renderer: PageRenderer;
  private session: PresentationSession;
  private preferences: Preferences;
  private overview: Overview | null = null;

  private stageSize: Size = { width: 1, height: 1 };
  private sheetSize: Size = { width: 1, height: 1 };
  private aspect = DEFAULT_ASPECT;
  private view: ViewState = { zoom: 1, x: 0, y: 0 };
  private navigation = 0;
  private rerasterTimer = 0;
  private lastTapTime = 0;
  private activeStroke: Stroke | null = null;
  private sampleFilter = new SampleFilter<PointerEvent>();
  private shapeDrag: ShapeDrag | null = null;
  private inkRect: DOMRect | null = null;
  private erasing = false;
  private lasering = false;
  private closed = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private resizeObserver: ResizeObserver;

  constructor(private options: PresenterOptions) {
    this.session = options.session;
    this.renderer = new PageRenderer(options.doc);
    this.preferences = loadPreferences();

    this.root = document.createElement('div');
    this.root.className = 'pp-root';
    this.stage = document.createElement('div');
    this.stage.className = 'pp-stage';
    this.sheet = document.createElement('div');
    this.sheet.className = 'pp-sheet';
    this.pageSlot = document.createElement('div');
    this.pageSlot.className = 'pp-page-slot';
    this.sheet.appendChild(this.pageSlot);
    this.stage.appendChild(this.sheet);
    // Die Tinte liegt nicht auf der Seite, sondern über der Bühne und wird für den sichtbaren
    // Ausschnitt neu gezeichnet. So bleibt sie bei jedem Zoom scharf wie eine Vektorgrafik.
    this.markerLayer = this.layer('pp-layer pp-marker-layer');
    this.inkLayer = this.layer('pp-layer');
    this.transientLayer = this.layer('pp-layer');
    this.root.appendChild(this.stage);
    document.body.appendChild(this.root);

    this.laser = new Laser(this.transientLayer, (context) => this.applyPageTransform(context));
    this.router = new GestureRouter<InkPointerEvent>({
      inkStart: (event) => this.inkStart(event),
      inkMove: (event) => this.inkMove(event),
      inkEnd: (event) => this.inkEnd(event),
      inkCancel: () => this.inkCancel(),
      swipe: (direction) => this.step(direction),
      tap: (x) => this.onTap(x),
      pan: (dx, dy) => this.applyView({ ...this.view, x: this.view.x + dx, y: this.view.y + dy }),
      pinch: (cx, cy, factor, dx, dy) => this.onPinch(cx, cy, factor, dx, dy),
      gestureEnd: () => this.scheduleReraster(),
      isZoomed: () => this.view.zoom > 1.01,
      fingerDraws: () => this.preferences.fingerDraws,
    });

    this.timer = new TimerWidget(this.root, {
      minutes: this.preferences.timerMinutes,
      size: this.preferences.timerSize,
      x: this.preferences.timerX,
      y: this.preferences.timerY,
      isInking: () => this.inkRect !== null,
      onStatusChange: () => {
        if (this.toolbar) this.syncToolbar();
      },
      onMoved: (timerX, timerY) => this.changePreferences({ timerX, timerY }),
    });

    this.toolbar = new Toolbar(this.root, {
      selectTool: (tool) => this.selectTool(tool),
      selectColor: (color) => this.selectColor(color),
      addCustomColor: (color) => this.addCustomColor(color),
      change: (patch) => this.changePreferences(patch),
      undo: () => this.undo(),
      redo: () => this.redo(),
      clearPage: () => this.clearPage(),
      previous: () => this.step(-1),
      next: () => this.step(1),
      overview: () => this.openOverview(),
      insertBlank: () => this.insertBlank(),
      close: () => this.close(),
      timerSetMinutes: (minutes) => {
        this.timer.timer.setMinutes(minutes);
        this.timerChanged();
      },
      timerAdjust: (minutes) => {
        this.timer.timer.adjust(minutes);
        this.timerChanged();
      },
      timerStartPause: () => {
        this.timer.timer.toggle();
        this.timerChanged();
      },
      timerReset: () => {
        this.timer.timer.reset();
        this.timerChanged();
      },
      timerPreview: (on) => this.timer.setPreview(on),
    });

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.stage);
    this.resizeObserver.observe(this.toolbar.barElement);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    void this.requestWakeLock();
    this.syncToolbar();
    this.reserveToolbarSpace();
    this.measureStage();
    void this.goTo(this.session.current);
  }

  private layer(className: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    this.stage.appendChild(canvas);
    return canvas;
  }

  // ---------- Eingabe ----------

  private bindInput(): void {
    const stage = this.stage;
    stage.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Ein schon beendeter Zeiger lässt sich nicht mehr einfangen.
      }
      this.router.down(event);
    });
    stage.addEventListener('pointermove', (event) => this.router.move(event));
    stage.addEventListener('pointerup', (event) => this.router.up(event));
    stage.addEventListener('pointercancel', (event) => this.router.cancel(event));
    // Fehlt ein "pointerup", bliebe der Stift sonst dauerhaft als schreibend markiert.
    stage.addEventListener('lostpointercapture', (event) => this.router.cancel(event));

    // iPadOS macht aus Pencil-Strichen sonst Scrollen, Auswahl oder die Lupe. Der
    // Zeiger-Ablauf bleibt davon unberührt. Auch die Randgesten von Obsidian sollen
    // die Bühne nicht erreichen, sonst öffnen sich hinter der Präsentation Seitenleisten.
    const blockTouch = (event: TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    stage.addEventListener('touchstart', blockTouch, { passive: false });
    stage.addEventListener('touchmove', blockTouch, { passive: false });
    stage.addEventListener('touchend', blockTouch, { passive: false });
    stage.addEventListener('contextmenu', (event) => event.preventDefault());
    stage.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });

    // Über Leiste und Übersicht bleiben Tippen und Scrollen normal, nur Obsidian hört nicht mit.
    const keepFromObsidian = (event: Event) => event.stopPropagation();
    for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown']) {
      this.root.addEventListener(type, keepFromObsidian);
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    let handled = true;
    if (this.overview && key === 'Escape') this.closeOverview();
    else if (key === 'Escape') this.close();
    else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') this.redo();
    else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
      if (event.shiftKey) this.redo();
      else this.undo();
    }
    else if (keyZoomFactor(key) !== null) this.onZoomKey(keyZoomFactor(key) as number);
    else if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') this.step(1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') this.step(-1);
    else if (key === 'Home') void this.goTo(this.session.firstVisible());
    else if (key === 'End') void this.goTo(this.session.lastVisible());
    else handled = false;
    // Solange die Präsentation offen ist, gehören die Tasten ihr, auch die Hotkeys von Obsidian.
    event.stopPropagation();
    if (handled) event.preventDefault();
  };

  private onTap(clientX: number): void {
    const now = performance.now();
    const isDouble = now - this.lastTapTime < DOUBLE_TAP_MS;
    this.lastTapTime = now;
    if (this.view.zoom > 1.01) {
      if (isDouble) this.resetZoom();
      else this.toolbar.toggle();
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    if (ratio < TAP_ZONE) this.step(-1);
    else if (ratio > 1 - TAP_ZONE) this.step(1);
    else this.toolbar.toggle();
  }

  private onPinch(cx: number, cy: number, factor: number, dx: number, dy: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.applyView(zoomAround(this.view, cx - rect.left, cy - rect.top, factor, dx, dy));
  }

  private onWheel(event: WheelEvent): void {
    // Strg + Rad zoomt sonst die ganze Obsidian-Oberfläche.
    event.preventDefault();
    event.stopPropagation();
    // Während eines Strichs steht die Seite still, sonst läge der Rest des Strichs daneben.
    if (this.inkRect) return;
    const action = wheelAction(event, this.view.zoom > 1.01);
    if (!action) return;
    if (action.type === 'zoom') {
      this.zoomAt(event.clientX, event.clientY, action.factor);
    } else {
      this.applyView({ ...this.view, x: this.view.x + action.dx, y: this.view.y + action.dy });
      this.scheduleReraster();
    }
  }

  private onZoomKey(factor: number): void {
    if (this.inkRect || this.overview) return;
    if (factor === 0) {
      this.resetZoom();
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.stage.getBoundingClientRect();
    this.applyView(zoomAround(this.view, clientX - rect.left, clientY - rect.top, factor, 0, 0));
    this.scheduleReraster();
  }

  private resetZoom(): void {
    this.applyView({ zoom: 1, x: 0, y: 0 });
    this.scheduleReraster();
  }

  // ---------- Tinte ----------

  private get slide(): Slide {
    return this.session.slides[this.session.current];
  }

  private toPage(event: PointerEvent): { x: number; y: number } {
    // Während eines Strichs ändert sich die Lage nicht. Das spart je Stiftpunkt eine Layout-Abfrage.
    const rect = this.inkRect ?? this.sheet.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.width,
    };
  }

  private pressure(event: PointerEvent): number {
    return event.pointerType === 'pen' ? event.pressure : 0.5;
  }

  private inkStart(event: PointerEvent): void {
    this.toolbar.collapse();
    this.inkRect = this.sheet.getBoundingClientRect();
    this.sampleFilter.start(event);
    const point = this.toPage(event);
    const tool = this.preferences.tool;
    this.laser.stop();
    this.transientLayer.classList.toggle('pp-marker-layer', tool === 'marker');
    if (tool === 'laser') {
      this.lasering = true;
      this.laser.start(point.x, point.y);
    } else if (tool === 'eraser') {
      this.erasing = true;
      this.slide.ink.beginErase();
      this.eraseAt(point);
    } else if (tool === 'shape') {
      this.shapeDrag = {
        kind: 'pen',
        type: this.preferences.shapeType,
        color: this.preferences.penColor,
        width: this.preferences.penWidth,
        start: point,
        end: point,
      };
      this.scheduleLive();
    } else if (tool === 'marker' && this.preferences.markerStraight) {
      this.shapeDrag = {
        kind: 'marker',
        type: 'line',
        color: this.preferences.markerColor,
        width: this.preferences.markerWidth,
        start: point,
        end: point,
      };
      this.scheduleLive();
    } else {
      const kind: InkKind = tool;
      const stroke: Stroke =
        kind === 'pen'
          ? { kind, color: this.preferences.penColor, width: this.preferences.penWidth, penType: this.preferences.penType, points: [] }
          : { kind, color: this.preferences.markerColor, width: this.preferences.markerWidth, points: [] };
      appendPoint(stroke, point.x, point.y, this.pressure(event), this.view.zoom);
      this.activeStroke = stroke;
      this.scheduleLive();
    }
  }

  private inkMove(event: PointerEvent): void {
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of this.sampleFilter.fresh(coalesced, event)) this.inkSample(sample);
  }

  private inkSample(event: PointerEvent): void {
    const point = this.toPage(event);
    if (this.lasering) {
      this.laser.move(point.x, point.y);
    } else if (this.erasing) {
      this.eraseAt(point);
    } else if (this.shapeDrag) {
      this.shapeDrag.end = point;
      this.scheduleLive();
    } else if (this.activeStroke) {
      if (appendPoint(this.activeStroke, point.x, point.y, this.pressure(event), this.view.zoom)) this.scheduleLive();
    }
  }

  private eraseAt(point: { x: number; y: number }): void {
    const { eraserSize, eraserMode } = this.preferences;
    if (this.slide.ink.eraseAt(point.x, point.y, eraserSize, eraserMode === 'partial')) this.redrawInk();
  }

  private strokeFromDrag(drag: ShapeDrag): Stroke {
    return {
      kind: drag.kind,
      color: drag.color,
      width: drag.width,
      sharp: true,
      points: shapePoints(drag.type, drag.start, drag.end, drag.width),
    };
  }

  private clearTransient(): void {
    cancelAnimationFrame(this.liveFrame);
    this.liveFrame = 0;
    this.clearCanvas(this.transientLayer);
  }

  /** Der laufende Strich wird je Bild einmal ganz neu gezeichnet. Er sieht damit schon so aus wie fertig. */
  private scheduleLive(): void {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      const stroke = this.activeStroke ?? (this.shapeDrag ? this.strokeFromDrag(this.shapeDrag) : null);
      this.clearCanvas(this.transientLayer);
      if (stroke) this.paint(this.transientLayer, (context) => drawStroke(context, stroke));
    });
  }

  private finishShape(drag: ShapeDrag): void {
    this.clearTransient();
    if (Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) < MIN_SHAPE_SIZE) return;
    const stroke = this.strokeFromDrag(drag);
    this.slide.ink.add(stroke);
    this.paintStroke(stroke);
  }

  private inkEnd(event: PointerEvent | null): void {
    const changesInk = !this.lasering;
    if (this.lasering) {
      this.lasering = false;
      this.laser.end();
    } else if (this.erasing) {
      this.erasing = false;
      this.slide.ink.endErase();
    } else if (this.shapeDrag) {
      const drag = this.shapeDrag;
      this.shapeDrag = null;
      this.finishShape(drag);
    } else if (this.activeStroke) {
      const stroke = this.activeStroke;
      this.activeStroke = null;
      if (event) {
        const point = this.toPage(event);
        appendPoint(stroke, point.x, point.y, this.pressure(event), this.view.zoom);
      }
      this.clearTransient();
      this.slide.ink.add(stroke);
      this.paintStroke(stroke);
    }
    this.inkRect = null;
    this.syncToolbar();
    if (changesInk) this.options.onChange?.();
  }

  private inkCancel(): void {
    this.inkRect = null;
    this.activeStroke = null;
    this.shapeDrag = null;
    this.clearTransient();
    if (this.lasering) {
      this.lasering = false;
      this.laser.stop();
    }
    if (this.erasing) {
      this.erasing = false;
      this.slide.ink.endErase();
    }
    this.redrawInk();
  }

  private get pixelRatio(): number {
    return window.devicePixelRatio || 1;
  }

  /** Seiteneinheiten auf Gerätepixel der Bühne, mit Zoom und Verschiebung. */
  private applyPageTransform(context: CanvasRenderingContext2D): void {
    const ratio = this.pixelRatio;
    const scale = this.sheetSize.width * this.view.zoom * ratio;
    context.setTransform(scale, 0, 0, scale, this.view.x * ratio, this.view.y * ratio);
  }

  private clearCanvas(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Zeichnet in Seiteneinheiten und schneidet am Seitenrand ab. */
  private paint(canvas: HTMLCanvasElement, draw: (context: CanvasRenderingContext2D) => void): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.save();
    this.applyPageTransform(context);
    context.beginPath();
    context.rect(0, 0, 1, this.aspect);
    context.clip();
    draw(context);
    context.restore();
  }

  private paintStroke(stroke: Stroke): void {
    this.paint(stroke.kind === 'marker' ? this.markerLayer : this.inkLayer, (context) => drawStroke(context, stroke));
  }

  private redrawInk(): void {
    cancelAnimationFrame(this.inkFrame);
    this.inkFrame = 0;
    this.clearCanvas(this.markerLayer);
    this.clearCanvas(this.inkLayer);
    const { strokes } = this.slide.ink;
    this.paint(this.markerLayer, (context) => {
      for (const stroke of strokes) if (stroke.kind === 'marker') drawStroke(context, stroke);
    });
    this.paint(this.inkLayer, (context) => {
      for (const stroke of strokes) if (stroke.kind === 'pen') drawStroke(context, stroke);
    });
  }

  /** Beim Zoomen und Verschieben höchstens einmal je Bild. */
  private scheduleInkRedraw(): void {
    if (this.inkFrame) return;
    this.inkFrame = requestAnimationFrame(() => {
      this.inkFrame = 0;
      this.redrawInk();
    });
  }

  private undo(): void {
    if (this.slide.ink.undo()) {
      this.redrawInk();
      this.syncToolbar();
      this.options.onChange?.();
    }
  }

  private redo(): void {
    if (this.slide.ink.redo()) {
      this.redrawInk();
      this.syncToolbar();
      this.options.onChange?.();
    }
  }

  private clearPage(): void {
    this.slide.ink.clear();
    this.redrawInk();
    this.syncToolbar();
    this.options.onChange?.();
  }

  private clearAllInk(): void {
    this.session.clearAllInk();
    this.options.onChange?.();
    void this.goTo(this.session.current);
  }

  // ---------- Werkzeuge ----------

  private selectTool(tool: Tool): void {
    this.changePreferences({ tool });
  }

  private selectColor(color: string): void {
    const { preferences } = this;
    if (preferences.tool === 'marker') {
      this.changePreferences({ markerColor: color, quickMarker: withQuickColor(preferences.quickMarker, color) });
    } else {
      this.changePreferences({ penColor: color, quickPen: withQuickColor(preferences.quickPen, color) });
    }
  }

  private addCustomColor(color: string): void {
    const { preferences } = this;
    if (preferences.tool === 'marker') {
      this.changePreferences({ customMarker: withCustomColor(preferences.customMarker, color) });
    } else {
      this.changePreferences({ customPen: withCustomColor(preferences.customPen, color) });
    }
    this.selectColor(color);
  }

  private changePreferences(patch: Partial<Preferences>): void {
    Object.assign(this.preferences, patch);
    savePreferences(this.preferences);
    if (patch.timerSize) this.timer.setSize(patch.timerSize);
    if (patch.edgeMode) this.applyEdge();
    this.syncToolbar();
    if ('toolbarPinned' in patch) this.onResize();
  }

  private timerChanged(): void {
    if (this.timer.timer.status === 'idle') this.preferences.timerMinutes = this.timer.timer.minutes;
    savePreferences(this.preferences);
    this.timer.render();
    this.syncToolbar();
  }

  /** Die Fläche um die Folie nimmt ihre Randfarbe an, damit sie am Board nicht als schwarzer Balken auffällt. */
  private applyEdge(): void {
    this.root.style.background = this.preferences.edgeMode === 'page' ? this.edgeColor : '';
  }

  private updateEdgeColor(pageNumber: number | null, canvas: HTMLCanvasElement | null): void {
    if (pageNumber === null || !canvas) {
      this.edgeColor = '#fff';
    } else {
      let color = this.edgeColors.get(pageNumber);
      if (!color) {
        const context = canvas.getContext('2d');
        if (!context || canvas.width < 8 || canvas.height < 8) return;
        const inset = 3;
        const corners = [
          [inset, inset],
          [canvas.width - inset, inset],
          [inset, canvas.height - inset],
          [canvas.width - inset, canvas.height - inset],
        ];
        color = medianColor(corners.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)));
        this.edgeColors.set(pageNumber, color);
      }
      this.edgeColor = color;
    }
    this.applyEdge();
  }

  private syncToolbar(): void {
    const { ink } = this.slide;
    this.toolbar.update({
      preferences: this.preferences,
      canUndo: ink.canUndo,
      canRedo: ink.canRedo,
      canClear: ink.strokes.length > 0,
      ...this.session.visiblePosition(this.session.current),
      hasPrevious: this.session.nextVisible(this.session.current, -1) !== null,
      hasNext: this.session.nextVisible(this.session.current, 1) !== null,
      sheetWidth: this.sheetSize.width,
      timerStatus: this.timer.timer.status,
      timerMinutes: this.timer.timer.minutes,
    });
  }

  // ---------- Seiten ----------

  private step(direction: 1 | -1): void {
    const target = this.session.nextVisible(this.session.current, direction);
    if (target !== null) void this.goTo(target);
  }

  private async goTo(index: number): Promise<void> {
    if (this.closed) return;
    // Ein Presenter-Klick mitten im Strich: Der Strich gehört noch auf die alte Seite.
    if (this.inkRect) this.inkEnd(null);
    this.clearDetail();
    // Auch ein Link auf eine gesperrte Seite zeigt sie nicht.
    const target = this.session.nearestVisible(Math.max(0, Math.min(this.session.slides.length - 1, index)));
    const navigation = ++this.navigation;
    this.session.current = target;
    this.options.onPageChange?.(target);
    const slide = this.slide;
    this.pageSlot.textContent = '';

    let aspect = slide.aspect ?? DEFAULT_ASPECT;
    if (slide.pdfPage !== null) {
      try {
        aspect = await this.renderer.aspect(slide.pdfPage);
      } catch {
        this.showPageError();
      }
      if (navigation !== this.navigation) return;
    }
    this.aspect = aspect;
    this.view = { zoom: 1, x: 0, y: 0 };
    this.layout();
    this.syncToolbar();
    this.rasterCurrent(navigation);
    this.preloadAround(target);
  }

  private showPageError(): void {
    const message = document.createElement('div');
    message.className = 'pp-page-error';
    message.textContent = 'Diese Seite ließ sich nicht laden.';
    this.pageSlot.replaceChildren(message);
  }

  private rasterCurrent(navigation: number): void {
    const slide = this.slide;
    if (slide.pdfPage === null) {
      this.updateEdgeColor(null, null);
      return;
    }
    const pageNumber = slide.pdfPage;
    // Immer die ganze Seite in Bildschirmauflösung. Im Zoom kommt der scharfe Ausschnitt dazu.
    const width = rasterWidth(this.sheetSize.width, this.aspect, this.pixelRatio, MAX_PAGE_PIXELS);
    const cached = this.renderer.cached(pageNumber);
    if (cached) {
      this.pageSlot.replaceChildren(cached);
      this.updateEdgeColor(pageNumber, cached);
    }
    this.renderer
      .render(pageNumber, width)
      .then((canvas) => {
        if (navigation !== this.navigation || this.closed) return;
        this.pageSlot.replaceChildren(canvas);
        this.updateEdgeColor(pageNumber, canvas);
      })
      .catch((error: { name?: string }) => {
        if (error?.name === 'RenderingCancelledException' || navigation !== this.navigation || this.closed) return;
        if (!this.renderer.cached(pageNumber)) this.showPageError();
      });
  }

  /** Rendert die Nachbarseiten vor, damit das Blättern sofort sitzt. */
  private preloadAround(index: number): void {
    const keep = new Set<number>();
    const scale = this.pixelRatio;
    const neighbours = [index, this.session.nextVisible(index, 1), this.session.nextVisible(index, -1)];
    for (const neighbour of neighbours) {
      if (neighbour === null) continue;
      const slide = this.session.slides[neighbour];
      if (slide?.pdfPage == null) continue;
      keep.add(slide.pdfPage);
      if (neighbour === index) continue;
      const pageNumber = slide.pdfPage;
      void this.renderer
        .aspect(pageNumber)
        .then((aspect) => {
          const sheet = snapSize(fitSheet(this.stageSize, aspect), scale);
          return this.renderer.render(pageNumber, rasterWidth(sheet.width, aspect, scale, MAX_PAGE_PIXELS));
        })
        .catch(() => undefined);
    }
    this.renderer.retain(keep);
  }

  private insertBlank(): void {
    const position = this.session.insertBlankAfter(this.session.current, this.aspect);
    this.options.onChange?.();
    void this.goTo(position);
  }

  // ---------- Layout ----------

  private measureStage(): void {
    const rect = this.stage.getBoundingClientRect();
    this.stageSize = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  /** Eine fixierte Leiste soll nichts von der Seite verdecken. Die Bühne endet deshalb über ihr. */
  private reserveToolbarSpace(): void {
    const space = this.preferences.toolbarPinned ? this.toolbar.barElement.getBoundingClientRect().height + TOOLBAR_GAP : 0;
    this.root.style.setProperty('--pp-reserve', `${space}px`);
  }

  private onResize(): void {
    this.reserveToolbarSpace();
    const before = this.stageSize;
    this.measureStage();
    if (before.width === this.stageSize.width && before.height === this.stageSize.height) return;
    this.view = { zoom: 1, x: 0, y: 0 };
    this.clearDetail();
    this.layout();
    this.rasterCurrent(this.navigation);
  }

  private layout(): void {
    this.sheetSize = snapSize(fitSheet(this.stageSize, this.aspect), this.pixelRatio);
    this.sheet.style.width = `${this.sheetSize.width}px`;
    this.sheet.style.height = `${this.sheetSize.height}px`;
    this.sizeLayers();
    this.applyView(this.view);
    this.redrawInk();
  }

  private applyView(view: ViewState): void {
    const next = snapView(clampView(view, this.sheetSize, this.stageSize), this.pixelRatio);
    const changed = next.zoom !== this.view.zoom || next.x !== this.view.x || next.y !== this.view.y;
    this.view = next;
    this.sheet.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
    if (!changed) return;
    // Der scharfe Ausschnitt passt nicht mehr. Bis zum Ende der Geste trägt die skalierte Seite.
    this.clearDetail();
    this.scheduleInkRedraw();
  }

  /** Die Ebenen decken die Bühne Pixel für Pixel ab, unabhängig vom Zoom. */
  private sizeLayers(): void {
    const width = Math.max(1, Math.round(this.stageSize.width * this.pixelRatio));
    const height = Math.max(1, Math.round(this.stageSize.height * this.pixelRatio));
    for (const canvas of [this.markerLayer, this.inkLayer, this.transientLayer]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  }

  /** Erst nach der Geste den scharfen Ausschnitt holen. Währenddessen reicht die skalierte Seite. */
  private scheduleReraster(): void {
    window.clearTimeout(this.rerasterTimer);
    this.rerasterTimer = window.setTimeout(() => {
      if (!this.closed) this.renderDetail();
    }, RERASTER_DELAY_MS);
  }

  /** Rendert den sichtbaren Teil der Seite in voller Auflösung über die skalierte Seite. */
  private renderDetail(): void {
    this.clearDetail();
    const pageNumber = this.slide.pdfPage;
    if (pageNumber === null || this.view.zoom <= 1.01) return;
    const token = this.detailToken;
    const ratio = this.pixelRatio;
    const region = visibleRegion(this.view, this.sheetSize, this.stageSize, ratio);
    if (region.width < 1 || region.height < 1) return;
    void this.renderer
      .region(pageNumber, region)
      .then(async ({ canvas, task }) => {
        if (token !== this.detailToken) {
          task.cancel();
          releaseCanvas(canvas);
          return;
        }
        this.detailTask = task;
        try {
          await task.promise;
        } catch (error) {
          releaseCanvas(canvas);
          throw error;
        }
        if (token !== this.detailToken) {
          releaseCanvas(canvas);
          return;
        }
        this.detailTask = null;
        canvas.className = 'pp-detail';
        canvas.style.left = `${region.left / ratio}px`;
        canvas.style.top = `${region.top / ratio}px`;
        canvas.style.width = `${region.width / ratio}px`;
        canvas.style.height = `${region.height / ratio}px`;
        this.detail = canvas;
        this.sheet.after(canvas);
      })
      // Bleibt der Ausschnitt aus, zeigt die skalierte Seite weiter dasselbe, nur weniger scharf.
      .catch(() => undefined);
  }

  private clearDetail(): void {
    this.detailToken++;
    this.detailTask?.cancel();
    this.detailTask = null;
    if (this.detail) {
      this.detail.remove();
      releaseCanvas(this.detail);
      this.detail = null;
    }
  }

  // ---------- Übersicht ----------

  private openOverview(): void {
    if (this.overview) return;
    this.toolbar.collapse();
    this.overview = new Overview(this.root, this.session, this.renderer, {
      select: (index) => {
        this.closeOverview();
        void this.goTo(index);
      },
      removeBlank: (index) => {
        this.session.removeBlank(index);
        this.options.onChange?.();
        this.closeOverview();
        void this.goTo(this.session.current);
        this.openOverview();
      },
      clearAllInk: () => {
        this.clearAllInk();
        this.closeOverview();
        this.openOverview();
      },
      toggleLock: (index) => {
        const slide = this.session.slides[index];
        if (!this.session.setLocked(index, !slide.locked)) return false;
        this.options.onChange?.();
        if (index === this.session.current && slide.locked) void this.goTo(index);
        else this.syncToolbar();
        return true;
      },
      close: () => this.closeOverview(),
    });
  }

  private closeOverview(): void {
    this.overview?.destroy();
    this.overview = null;
  }

  // ---------- Bildschirm wach halten ----------

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.requestWakeLock();
    else this.options.onHidden?.();
  };

  /** Ohne das geht das iPad im Unterricht mitten in der Erklärung aus. Wo es fehlt, greift die Geräteeinstellung. */
  private async requestWakeLock(): Promise<void> {
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    }).wakeLock;
    if (!wakeLock) return;
    try {
      this.wakeLock = await wakeLock.request('screen');
    } catch {
      this.wakeLock = null;
    }
  }

  // ---------- Ende ----------

  close(): void {
    if (this.closed) return;
    if (this.inkRect) this.inkEnd(null);
    this.closed = true;
    this.navigation++;
    window.clearTimeout(this.rerasterTimer);
    cancelAnimationFrame(this.inkFrame);
    cancelAnimationFrame(this.liveFrame);
    this.clearDetail();
    this.closeOverview();
    this.laser.stop();
    for (const canvas of [this.markerLayer, this.inkLayer, this.transientLayer]) releaseCanvas(canvas);
    this.toolbar.destroy();
    this.timer.destroy();
    this.resizeObserver.disconnect();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    void this.wakeLock?.release().catch(() => undefined);
    this.renderer.destroy();
    this.root.remove();
    this.options.onClose();
  }
}
