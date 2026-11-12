import { GestureRouter } from './gestures';
import {
  appendPoint,
  drawStroke,
  shapePoints,
  type InkKind,
  type ShapeType,
  type Stroke,
} from './ink';
import { icons } from './icons';
import { insideBounds, moveStrokes, replaceStrokes, selectInLasso, selectionBounds } from './lasso';
import { Laser } from './laser';
import { SampleFilter } from './samples';
import { recognizeShape } from './shapeRecognition';
import { SoundPlayer } from './sound';
import { Overview } from './overview';
import { PageRenderer, releaseCanvas } from './pageRenderer';
import {
  loadPreferences,
  savePreferences,
  withCustomColor,
  withQuickColor,
  type Preferences,
  type Cover,
  type PresentationSession,
  type Slide,
} from './session';
import { findLineBand, planLabel, type PlanRow } from './lessonData';
import { CountdownTimer, TimerWidget } from './timer';
import { Toolbar, type MoreState } from './toolbar';
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
const REPLAY_MIN_MS = 4000;
const REPLAY_MAX_MS = 15_000;
const REPLAY_MS_PER_STROKE = 60;
const PLAN_TICK_MS = 15_000;

type InkPointerEvent = PointerEvent;

/** Eine Form oder ein gerader Marker, solange der Stift noch zieht. */
interface ShapeDrag {
  kind: InkKind;
  type: ShapeType;
  color: string;
  width: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Aus Zeichnen und halten: Rechteck und Ellipse bleiben, wie erkannt */
  fixed?: boolean;
}

/** So lange muss der Stift stillstehen, und so weit darf er dabei zittern (Bildschirmpixel). */
const HOLD_MS = 550;
const HOLD_RADIUS_PX = 4;

export interface PresenterOptions {
  doc: PdfDocument;
  session: PresentationSession;
  /** Tinte oder Seiten haben sich geändert */
  onChange?(): void;
  /** Läuft beim Wechsel in ein anderes PDF der Stunde weiter */
  timer?: CountdownTimer;
  /** Daten aus dem Stundenentwurf und dem Tintenordner für das Feld „Mehr“ */
  more?: Partial<MoreState>;
  plan?: PlanRow[];
  /** Startzeit der Planzeit, bleibt beim Wechsel des PDFs erhalten */
  planStartedAt?: number | null;
  onPlanChange?(startedAt: number | null): void;
  onSwitchGroup?(name: string): void;
  onSwitchFile?(path: string): void;
  onExportPdf?(): void;
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
  private coverLayer: HTMLElement;
  private spot: HTMLElement;
  private spotAt = { x: 0.5, y: 0.5 };
  private planElement: HTMLElement;
  private planTimer = 0;
  private planStartedAt: number | null = null;
  private lineMessage = '';
  private lineToken = 0;
  /** Wie weit jede Abdeckung in dieser Sitzung weggezogen ist. Beim Öffnen liegt alles wieder drauf. */
  private coverState = new WeakMap<Cover, { side: 'left' | 'right' | 'top' | 'bottom'; amount: number }>();
  private dragged: { cover: Cover; base: { side: 'left' | 'right' | 'top' | 'bottom'; amount: number } | null } | null = null;
  private coverDraft: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;
  private replayState: { strokes: Stroke[]; shown: number; startedAt: number; pausedAt: number | null; frame: number } | null = null;
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
  private sound = new SoundPlayer();
  private flash: HTMLElement;
  private holdTimer = 0;
  private holdAnchor: { x: number; y: number } | null = null;
  private lassoPath: { x: number; y: number }[] | null = null;
  private lassoDrag: { start: { x: number; y: number }; base: Stroke[]; all: Stroke[] } | null = null;
  /** Mit dem Lasso ausgewählte Striche der aktuellen Seite */
  private selection: Stroke[] | null = null;
  private selectionBar: HTMLElement;

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
    this.coverLayer = document.createElement('div');
    this.coverLayer.className = 'pp-cover-layer';
    this.stage.appendChild(this.coverLayer);
    // Die Tinte liegt nicht auf der Seite, sondern über der Bühne und wird für den sichtbaren
    // Ausschnitt neu gezeichnet. So bleibt sie bei jedem Zoom scharf wie eine Vektorgrafik.
    this.markerLayer = this.layer('pp-layer pp-marker-layer');
    this.inkLayer = this.layer('pp-layer');
    this.transientLayer = this.layer('pp-layer');
    this.root.appendChild(this.stage);
    this.flash = document.createElement('div');
    this.flash.className = 'pp-flash';
    this.root.appendChild(this.flash);
    this.selectionBar = document.createElement('div');
    this.selectionBar.className = 'pp-selection-bar';
    for (const [icon, label, action] of [
      ['copy', 'Auswahl kopieren', () => this.lassoDuplicate()],
      ['trash', 'Auswahl löschen', () => this.lassoDelete()],
      ['close', 'Auswahl aufheben', () => this.clearSelection()],
    ] as const) {
      const button = document.createElement('button');
      button.className = 'pp-button';
      button.innerHTML = icons[icon];
      button.setAttribute('aria-label', label);
      button.title = label;
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', action);
      this.selectionBar.appendChild(button);
    }
    this.root.appendChild(this.selectionBar);
    this.spot = document.createElement('div');
    this.spot.className = 'pp-spot';
    this.stage.appendChild(this.spot);
    this.planElement = document.createElement('div');
    this.planElement.className = 'pp-plan';
    this.root.appendChild(this.planElement);
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
      fingerDraws: () => this.preferences.fingerDraws || this.spotActive,
      coverAt: (x, y) => !this.spotActive && this.visibleCoverAt(x, y) !== null,
      coverDrag: (x, y, dx, dy) => this.onCoverDrag(x, y, dx, dy),
      coverTap: (x, y) => this.onCoverTap(x, y),
      coverEnd: () => (this.dragged = null),
    });

    this.timer = new TimerWidget(this.root, {
      timer: options.timer,
      minutes: this.preferences.timerMinutes,
      size: this.preferences.timerSize,
      x: this.preferences.timerX,
      y: this.preferences.timerY,
      isInking: () => this.inkRect !== null,
      color: this.preferences.timerColor,
      effect: this.preferences.timerEffect,
      onStatusChange: () => {
        if (this.toolbar) this.syncToolbar();
      },
      onFinished: () => this.timerFinished(),
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
        this.sound.unlock();
        this.timer.timer.toggle();
        this.timerChanged();
      },
      timerReset: () => {
        this.timer.timer.reset();
        this.timerChanged();
      },
      timerPreview: (on) => this.timer.setPreview(on),
      timerPreviewEnd: () => {
        this.sound.unlock();
        this.timerFinished(true);
      },
      selectPenSlot: (index) => this.selectPenSlot(index),
      storePenSlot: () => this.storePenSlot(),
      lassoDelete: () => this.lassoDelete(),
      lassoDuplicate: () => this.lassoDuplicate(),
      lassoClear: () => this.clearSelection(),
      coverAll: () => this.coverAll(),
      coverRemoveAll: () => this.coverRemoveAll(),
      replay: () => this.startReplay(),
      exportPdf: () => options.onExportPdf?.(),
      switchGroup: (name) => options.onSwitchGroup?.(name),
      switchFile: (path) => options.onSwitchFile?.(path),
      togglePlan: () => this.togglePlan(),
      showLine: (line) => void this.showLine(line),
    });

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.stage);
    this.resizeObserver.observe(this.toolbar.barElement);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    void this.requestWakeLock();
    this.planStartedAt = options.planStartedAt ?? null;
    this.syncToolbar();
    this.reserveToolbarSpace();
    this.measureStage();
    this.renderPlan();
    void this.goTo(this.session.current);
  }

  /** Damit ein Timer den Wechsel in ein anderes PDF der Stunde übersteht. */
  get currentTimer(): CountdownTimer {
    return this.timer.timer;
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
    // Das iPad gibt Ton erst nach einer Berührung frei. Jeder Tipp holt das nach.
    for (const type of ['pointerup', 'click'] as const) this.root.addEventListener(type, () => this.sound.unlock(), true);
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
    if (this.replayState) {
      this.toggleReplayPause();
      return;
    }
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
    this.stopReplay();
    this.inkRect = this.sheet.getBoundingClientRect();
    this.sampleFilter.start(event);
    const point = this.toPage(event);
    const tool = this.preferences.tool;
    this.laser.stop();
    this.transientLayer.classList.toggle('pp-marker-layer', tool === 'marker');
    if (this.spotActive) {
      this.moveSpot(event);
    } else if (tool === 'laser') {
      this.lasering = true;
      this.laser.start(point.x, point.y);
    } else if (tool === 'cover') {
      this.coverDraft = { start: point, end: point };
      this.scheduleLive();
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
    } else if (tool === 'lasso') {
      this.lassoStart(point);
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
          ? { kind, color: this.preferences.penColor, width: this.preferences.penWidth, penType: this.preferences.penType, smoothing: this.preferences.penSmoothing, points: [] }
          : { kind, color: this.preferences.markerColor, width: this.preferences.markerWidth, points: [] };
      appendPoint(stroke, point.x, point.y, this.pressure(event), this.view.zoom);
      this.activeStroke = stroke;
      this.holdWatch(point);
      this.scheduleLive();
    }
  }

  private inkMove(event: PointerEvent): void {
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of this.sampleFilter.fresh(coalesced, event)) this.inkSample(sample);
  }

  private inkSample(event: PointerEvent): void {
    const point = this.toPage(event);
    if (this.spotActive) {
      this.moveSpot(event);
    } else if (this.coverDraft) {
      this.coverDraft.end = point;
      this.scheduleLive();
    } else if (this.lasering) {
      this.laser.move(point.x, point.y);
    } else if (this.erasing) {
      this.eraseAt(point);
    } else if (this.shapeDrag) {
      if (!this.shapeDrag.fixed) {
        this.shapeDrag.end = point;
        this.scheduleLive();
      }
    } else if (this.lassoDrag) {
      this.lassoMove(point);
    } else if (this.lassoPath) {
      const last = this.lassoPath[this.lassoPath.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 0.002 / this.view.zoom) {
        this.lassoPath.push(point);
        this.scheduleLive();
      }
    } else if (this.activeStroke) {
      if (appendPoint(this.activeStroke, point.x, point.y, this.pressure(event), this.view.zoom)) this.scheduleLive();
      this.holdWatch(point);
    }
  }

  private eraseAt(point: { x: number; y: number }): void {
    const { eraserSize, eraserMode } = this.preferences;
    // Höchstens einmal je Bild: Ein Stiftpunkt kann mehrere Treffer je Bild liefern.
    if (this.slide.ink.eraseAt(point.x, point.y, eraserSize, eraserMode === 'partial')) this.scheduleInkRedraw();
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
      const draft = this.coverDraft;
      const stroke =
        this.activeStroke ??
        (this.shapeDrag ? this.strokeFromDrag(this.shapeDrag) : null) ??
        (draft
          ? this.strokeFromDrag({ kind: 'pen', type: 'rectangle', color: '#6b7280', width: 0.002, start: draft.start, end: draft.end })
          : null);
      this.clearCanvas(this.transientLayer);
      if (stroke) this.paint(this.transientLayer, (context) => drawStroke(context, stroke));
      this.paintLasso();
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
    const changesInk = !this.lasering && !this.spotActive && !this.lassoPath;
    this.holdStop();
    if (this.lassoPath) {
      this.lassoFinish();
    } else if (this.lassoDrag) {
      this.lassoDrag = null;
      this.slide.ink.endChange();
    } else if (this.coverDraft) {
      this.finishCoverDraft();
    } else if (this.lasering) {
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
    this.holdStop();
    this.lassoPath = null;
    if (this.lassoDrag) {
      this.slide.ink.setStrokes(this.lassoDrag.all);
      this.slide.ink.endChange();
      this.selection = this.lassoDrag.base;
      this.lassoDrag = null;
    }
    this.inkRect = null;
    this.activeStroke = null;
    this.shapeDrag = null;
    this.coverDraft = null;
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
    // Zoom und Verschieben zeichnen die Tinte neu, die Auswahl muss mit.
    if (this.selection) this.scheduleLive();
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
    this.clearSelection();
    if (this.slide.ink.undo()) {
      this.redrawInk();
      this.syncToolbar();
      this.options.onChange?.();
    }
  }

  private redo(): void {
    this.clearSelection();
    if (this.slide.ink.redo()) {
      this.redrawInk();
      this.syncToolbar();
      this.options.onChange?.();
    }
  }

  private clearPage(): void {
    this.clearSelection();
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

  // ---------- Zeichnen und halten ----------

  /** Bei jeder spürbaren Bewegung beginnt die Wartezeit neu. Steht der Stift, wird aus dem Strich eine Form. */
  private holdWatch(point: { x: number; y: number }): void {
    if (!this.preferences.holdToShape) return;
    const radius = HOLD_RADIUS_PX / (this.sheetSize.width * this.view.zoom);
    if (this.holdAnchor && Math.hypot(point.x - this.holdAnchor.x, point.y - this.holdAnchor.y) <= radius) return;
    this.holdAnchor = point;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => this.holdFired(), HOLD_MS);
  }

  private holdStop(): void {
    window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.holdAnchor = null;
  }

  private holdFired(): void {
    this.holdTimer = 0;
    const stroke = this.activeStroke;
    if (!stroke || stroke.points.length < 2) return;
    const shape = recognizeShape(stroke.points);
    if (!shape) return;
    this.activeStroke = null;
    this.shapeDrag = {
      kind: stroke.kind,
      type: shape.type,
      color: stroke.color,
      width: stroke.width,
      start: shape.start,
      end: shape.end,
      fixed: shape.type !== 'line',
    };
    this.scheduleLive();
  }

  // ---------- Lasso ----------

  private lassoStart(point: { x: number; y: number }): void {
    const bounds = this.selection ? selectionBounds(this.selection) : null;
    const padding = 12 / (this.sheetSize.width * this.view.zoom);
    if (this.selection && bounds && insideBounds(point, bounds, padding)) {
      this.slide.ink.beginChange();
      this.lassoDrag = { start: point, base: this.selection, all: this.slide.ink.strokes };
      return;
    }
    this.selection = null;
    this.lassoPath = [point];
    this.scheduleLive();
  }

  private lassoMove(point: { x: number; y: number }): void {
    const drag = this.lassoDrag;
    if (!drag) return;
    const moved = moveStrokes(drag.base, point.x - drag.start.x, point.y - drag.start.y);
    this.slide.ink.setStrokes(replaceStrokes(drag.all, drag.base, moved));
    this.selection = moved;
    this.scheduleInkRedraw();
  }

  private lassoFinish(): void {
    const path = this.lassoPath ?? [];
    this.lassoPath = null;
    const selected = selectInLasso(this.slide.ink.strokes, path);
    this.selection = selected.length ? selected : null;
    this.scheduleLive();
  }

  private clearSelection(): void {
    if (!this.selection && !this.lassoPath) return;
    this.selection = null;
    this.lassoPath = null;
    this.selectionBar.classList.remove('is-visible');
    this.scheduleLive();
    if (this.toolbar) this.syncToolbar();
  }

  private lassoDelete(): void {
    const selection = this.selection;
    if (!selection) return;
    const remove = new Set(selection);
    this.slide.ink.replace(this.slide.ink.strokes.filter((stroke) => !remove.has(stroke)));
    this.clearSelection();
    this.redrawInk();
    this.syncToolbar();
    this.options.onChange?.();
  }

  private lassoDuplicate(): void {
    const selection = this.selection;
    if (!selection) return;
    const copies = moveStrokes(selection, 0.02, 0.02);
    this.slide.ink.replace([...this.slide.ink.strokes, ...copies]);
    this.selection = copies;
    this.redrawInk();
    this.syncToolbar();
    this.options.onChange?.();
  }

  /** Lasso-Linie und Rahmen der Auswahl, dazu die kleine Leiste über der Auswahl */
  private paintLasso(): void {
    const scale = this.sheetSize.width * this.view.zoom;
    const path = this.lassoPath;
    const bounds = this.selection ? selectionBounds(this.selection) : null;
    if (path && path.length > 1) {
      this.paint(this.transientLayer, (context) => {
        context.setLineDash([6 / scale, 5 / scale]);
        context.lineWidth = 1.5 / scale;
        context.strokeStyle = '#1f5fd6';
        context.beginPath();
        path.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.stroke();
      });
    }
    if (!bounds) {
      this.selectionBar.classList.remove('is-visible');
      return;
    }
    const padding = 8 / scale;
    this.paint(this.transientLayer, (context) => {
      context.fillStyle = 'rgba(31, 95, 214, 0.07)';
      context.fillRect(bounds.minX - padding, bounds.minY - padding, bounds.maxX - bounds.minX + 2 * padding, bounds.maxY - bounds.minY + 2 * padding);
      context.setLineDash([6 / scale, 5 / scale]);
      context.lineWidth = 1.5 / scale;
      context.strokeStyle = '#1f5fd6';
      context.strokeRect(bounds.minX - padding, bounds.minY - padding, bounds.maxX - bounds.minX + 2 * padding, bounds.maxY - bounds.minY + 2 * padding);
    });
    if (this.lassoDrag) {
      this.selectionBar.classList.remove('is-visible');
      return;
    }
    const sheet = this.sheet.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const left = sheet.left - rootRect.left + ((bounds.minX + bounds.maxX) / 2) * sheet.width;
    const top = sheet.top - rootRect.top + bounds.minY * sheet.width - 14;
    this.selectionBar.classList.add('is-visible');
    const barWidth = this.selectionBar.offsetWidth || 150;
    const barHeight = this.selectionBar.offsetHeight || 50;
    const x = Math.max(8, Math.min(rootRect.width - barWidth - 8, left - barWidth / 2));
    const below = sheet.top - rootRect.top + bounds.maxY * sheet.width + 14;
    const y = top - barHeight >= 8 ? top - barHeight : Math.min(rootRect.height - barHeight - 8, below);
    this.selectionBar.style.left = `${x}px`;
    this.selectionBar.style.top = `${y}px`;
  }

  // ---------- Timer am Ende ----------

  /** Ton und Effekt. Mit probe auch ohne abgelaufenen Timer, zum Ausprobieren im Einstellungsfeld. */
  private timerFinished(probe = false): void {
    const { timerSound, timerEffect } = this.preferences;
    this.sound.play(timerSound);
    if (timerEffect === 'flash') {
      this.flash.style.background = probe ? this.preferences.timerColor : '#be1e1e';
      this.flash.classList.remove('is-flashing');
      void this.flash.offsetWidth;
      this.flash.classList.add('is-flashing');
    } else if (probe && timerEffect !== 'none') {
      this.timer.playEffect();
    }
  }

  // ---------- Werkzeuge ----------

  private selectPenSlot(index: number): void {
    const slot = this.preferences.penSlots[index];
    if (!slot) return;
    this.changePreferences({ penColor: slot.color, penType: slot.penType, penWidth: slot.width, penSmoothing: slot.smoothing, penSlot: index });
  }

  private storePenSlot(): void {
    const { penColor, penType, penWidth, penSmoothing, penSlot, penSlots } = this.preferences;
    const next = penSlots.map((slot, index) => (index === penSlot ? { color: penColor, penType, width: penWidth, smoothing: penSmoothing } : slot));
    this.changePreferences({ penSlots: next });
  }

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
    if (patch.timerColor) this.timer.setColor(patch.timerColor);
    if (patch.timerEffect) this.timer.setEffect(patch.timerEffect);
    if (patch.tool && patch.tool !== 'lasso') this.clearSelection();
    if ('tool' in patch || 'pointerMode' in patch || 'spotSize' in patch) this.renderSpot();
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
      hasSelection: this.selection !== null,
      more: {
        group: '',
        groups: [],
        suggestions: [],
        files: [],
        canExport: false,
        ...this.options.more,
        hasPlan: (this.options.plan?.length ?? 0) > 0,
        planRunning: this.planStartedAt !== null,
        lineMessage: this.lineMessage,
      },
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
    this.stopReplay();
    this.clearSelection();
    this.clearDetail();
    this.lineToken++;
    this.lineMessage = '';
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
      const navigation = this.navigation;
      void this.renderer
        .aspect(pageNumber)
        .then((aspect) => {
          // Inzwischen weitergeblättert: Diese Seite würde sonst bis zum nächsten Blättern im Speicher bleiben.
          if (navigation !== this.navigation) return undefined;
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
    this.coverLayer.style.width = this.sheet.style.width;
    this.coverLayer.style.height = this.sheet.style.height;
    this.sizeLayers();
    this.applyView(this.view);
    this.redrawInk();
    this.renderCovers();
    this.renderSpot();
  }

  private applyView(view: ViewState): void {
    const next = snapView(clampView(view, this.sheetSize, this.stageSize), this.pixelRatio);
    const changed = next.zoom !== this.view.zoom || next.x !== this.view.x || next.y !== this.view.y;
    this.view = next;
    this.sheet.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
    this.coverLayer.style.transform = this.sheet.style.transform;
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

  // ---------- Schlüsselloch ----------

  private get spotActive(): boolean {
    return this.preferences.tool === 'laser' && this.preferences.pointerMode === 'spot';
  }

  private moveSpot(event: PointerEvent): void {
    const rect = this.stage.getBoundingClientRect();
    this.spotAt = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    this.renderSpot();
  }

  private renderSpot(): void {
    this.spot.classList.toggle('is-visible', this.spotActive);
    if (!this.spotActive) return;
    const radius = this.preferences.spotSize * Math.min(this.stageSize.width, this.stageSize.height);
    this.spot.style.width = `${radius * 2}px`;
    this.spot.style.height = `${radius * 2}px`;
    this.spot.style.left = `${this.spotAt.x * this.stageSize.width - radius}px`;
    this.spot.style.top = `${this.spotAt.y * this.stageSize.height - radius}px`;
  }

  // ---------- Abdecken ----------

  private coverPage(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.sheet.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.width };
  }

  /** Die oberste Abdeckung, die an dieser Stelle noch sichtbar ist. */
  private visibleCoverAt(clientX: number, clientY: number): Cover | null {
    const { x, y } = this.coverPage(clientX, clientY);
    for (let i = this.slide.covers.length - 1; i >= 0; i--) {
      const cover = this.slide.covers[i];
      if (x < cover.x || x > cover.x + cover.w || y < cover.y || y > cover.y + cover.h) continue;
      const state = this.coverState.get(cover);
      if (!state) return cover;
      const u = (x - cover.x) / cover.w;
      const v = (y - cover.y) / cover.h;
      const open =
        state.side === 'left' ? u < state.amount : state.side === 'right' ? u > 1 - state.amount : state.side === 'top' ? v < state.amount : v > 1 - state.amount;
      if (!open) return cover;
    }
    return null;
  }

  private onCoverTap(clientX: number, clientY: number): void {
    const cover = this.visibleCoverAt(clientX, clientY);
    if (!cover) return;
    this.coverState.set(cover, { side: 'left', amount: 1 });
    this.renderCovers();
  }

  /** Das Blatt folgt der Hand: Das Tempo kommt vom Finger, nicht von einer festen Animation. */
  private onCoverDrag(startX: number, startY: number, dx: number, dy: number): void {
    if (!this.dragged) {
      const cover = this.visibleCoverAt(startX, startY);
      if (!cover) return;
      this.dragged = { cover, base: this.coverState.get(cover) ?? null };
    }
    const { cover, base } = this.dragged;
    const rect = this.sheet.getBoundingClientRect();
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const side = base?.side ?? (horizontal ? (dx > 0 ? 'left' : 'right') : dy > 0 ? 'top' : 'bottom');
    const along = side === 'left' ? dx / (cover.w * rect.width) : side === 'right' ? -dx / (cover.w * rect.width) : side === 'top' ? dy / (cover.h * rect.width) : -dy / (cover.h * rect.width);
    const amount = Math.max(0, Math.min(1, (base?.amount ?? 0) + along));
    this.coverState.set(cover, { side, amount });
    this.renderCovers();
  }

  private renderCovers(): void {
    const nodes = this.slide.covers.map((cover) => {
      const frame = document.createElement('div');
      frame.className = 'pp-cover';
      frame.style.left = `${(cover.x / 1) * 100}%`;
      frame.style.width = `${cover.w * 100}%`;
      // Höhe und Lage in Seitenbreiten, die Ebene ist aber aspect-mal so hoch wie breit.
      frame.style.top = `${(cover.y / this.aspect) * 100}%`;
      frame.style.height = `${(cover.h / this.aspect) * 100}%`;
      const sheet = document.createElement('div');
      sheet.className = 'pp-cover-sheet';
      const state = this.coverState.get(cover);
      if (state) {
        const percent = state.amount * 100;
        const moves = { left: `translateX(${percent}%)`, right: `translateX(${-percent}%)`, top: `translateY(${percent}%)`, bottom: `translateY(${-percent}%)` };
        sheet.style.transform = moves[state.side];
      }
      frame.appendChild(sheet);
      return frame;
    });
    this.coverLayer.replaceChildren(...nodes, ...(this.lineBand ? [this.lineBand] : []));
  }

  private finishCoverDraft(): void {
    const draft = this.coverDraft;
    this.coverDraft = null;
    this.clearTransient();
    if (!draft) return;
    const { start, end } = draft;
    const size = Math.hypot(end.x - start.x, end.y - start.y);
    if (size < 0.008) {
      // Ein Stifttipp entfernt die Abdeckung unter ihm.
      const index = this.slide.covers.findIndex(
        (cover) => start.x >= cover.x && start.x <= cover.x + cover.w && start.y >= cover.y && start.y <= cover.y + cover.h,
      );
      if (index >= 0) this.slide.covers.splice(index, 1);
    } else {
      this.slide.covers.push({
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
      });
    }
    this.renderCovers();
    this.options.onChange?.();
  }

  private coverAll(): void {
    this.coverState = new WeakMap();
    this.renderCovers();
  }

  private coverRemoveAll(): void {
    this.slide.covers = [];
    this.renderCovers();
    this.options.onChange?.();
  }

  // ---------- Zeile hervorheben ----------

  private lineBand: HTMLElement | null = null;

  private async showLine(line: number | null): Promise<void> {
    const token = ++this.lineToken;
    this.lineBand = null;
    this.lineMessage = '';
    const page = this.slide.pdfPage;
    if (line !== null && page !== null) {
      let items: Awaited<ReturnType<PageRenderer['textItems']>> = [];
      try {
        items = await this.renderer.textItems(page);
      } catch {
        items = [];
      }
      if (token !== this.lineToken || this.closed) return;
      const band = findLineBand(items, line);
      if (band) {
        const node = document.createElement('div');
        node.className = 'pp-line-band';
        node.style.left = `${band.x * 100}%`;
        node.style.width = `${band.width * 100}%`;
        node.style.top = `${(band.y / this.aspect) * 100}%`;
        node.style.height = `${(band.height / this.aspect) * 100}%`;
        this.lineBand = node;
        this.toolbar.collapse();
      } else {
        this.lineMessage = `Zeile ${line} ließ sich auf dieser Seite nicht finden. Es braucht eine Zeilenzählung im PDF-Text.`;
      }
    }
    this.renderCovers();
    this.syncToolbar();
  }

  // ---------- Tafel neu entstehen lassen ----------

  private startReplay(): void {
    this.stopReplay();
    const strokes = this.slide.ink.strokes;
    if (!strokes.length) return;
    this.clearCanvas(this.markerLayer);
    this.clearCanvas(this.inkLayer);
    this.replayState = { strokes, shown: 0, startedAt: performance.now(), pausedAt: null, frame: 0 };
    this.replayState.frame = requestAnimationFrame(() => this.replayFrame());
  }

  private replayFrame(): void {
    const state = this.replayState;
    if (!state || state.pausedAt !== null) return;
    const duration = Math.min(REPLAY_MAX_MS, Math.max(REPLAY_MIN_MS, state.strokes.length * REPLAY_MS_PER_STROKE));
    const target = Math.min(state.strokes.length, Math.ceil(((performance.now() - state.startedAt) / duration) * state.strokes.length));
    while (state.shown < target) this.paintStroke(state.strokes[state.shown++]);
    if (state.shown >= state.strokes.length) {
      this.replayState = null;
      return;
    }
    state.frame = requestAnimationFrame(() => this.replayFrame());
  }

  /** Antippen hält an, damit die Klasse sagen kann, was als Nächstes kam. */
  private toggleReplayPause(): void {
    const state = this.replayState;
    if (!state) return;
    if (state.pausedAt === null) {
      state.pausedAt = performance.now();
      cancelAnimationFrame(state.frame);
    } else {
      state.startedAt += performance.now() - state.pausedAt;
      state.pausedAt = null;
      state.frame = requestAnimationFrame(() => this.replayFrame());
    }
  }

  private stopReplay(): void {
    if (!this.replayState) return;
    cancelAnimationFrame(this.replayState.frame);
    this.replayState = null;
    this.redrawInk();
  }

  // ---------- Planzeit ----------

  private togglePlan(): void {
    this.planStartedAt = this.planStartedAt === null ? Date.now() : null;
    this.options.onPlanChange?.(this.planStartedAt);
    this.renderPlan();
    this.syncToolbar();
  }

  private renderPlan(): void {
    window.clearInterval(this.planTimer);
    const rows = this.options.plan;
    const running = this.planStartedAt !== null && !!rows?.length;
    this.planElement.classList.toggle('is-visible', running);
    if (!running || !rows) return;
    const update = () => {
      const minute = Math.floor((Date.now() - (this.planStartedAt as number)) / 60_000);
      this.planElement.textContent = planLabel(rows, minute);
    };
    update();
    this.planTimer = window.setInterval(update, PLAN_TICK_MS);
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
    window.clearInterval(this.planTimer);
    if (this.replayState) cancelAnimationFrame(this.replayState.frame);
    this.replayState = null;
    cancelAnimationFrame(this.inkFrame);
    cancelAnimationFrame(this.liveFrame);
    this.clearDetail();
    this.closeOverview();
    this.laser.stop();
    for (const canvas of [this.markerLayer, this.inkLayer, this.transientLayer]) releaseCanvas(canvas);
    this.holdStop();
    this.sound.destroy();
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
