import { PageInk, type PenType, type ShapeType, type Smoothing } from './ink';
import type { StoredSlide } from './inkFile';
import type { TimerSize } from './timer';
import type { Tool } from './types';

/** Eine Folie ist eine PDF-Seite oder eine eingefügte leere Seite. */
export interface Slide {
  id: number;
  pdfPage: number | null;
  /** Höhe durch Breite, nur bei leeren Seiten fest */
  aspect: number | null;
  ink: PageInk;
  /** Erscheint nicht beim Blättern und ist in der Übersicht verdeckt, etwa eine Lösungsseite */
  locked: boolean;
  /** Flächen, die die Folie abdecken, bis sie in der Stunde weggezogen werden. In Seitenbreiten. */
  covers: Cover[];
}

export interface Cover {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Was zwischen zwei Präsentationen desselben PDFs erhalten bleibt. */
export class PresentationSession {
  slides: Slide[] = [];
  /** Tinte auf Seiten, die das PDF gerade nicht hat. Sie bleibt erhalten, bis die Seiten zurückkommen. */
  hiddenSlides: StoredSlide[] = [];
  current = 0;
  private nextId = 1;

  constructor(pageCount: number) {
    for (let page = 1; page <= pageCount; page++) this.appendSlide(page, null);
  }

  appendSlide(pdfPage: number | null, aspect: number | null): Slide {
    const slide: Slide = { id: this.nextId++, pdfPage, aspect, ink: new PageInk(), locked: false, covers: [] };
    this.slides.push(slide);
    return slide;
  }

  /** Gibt es etwas, das sich aufzuheben lohnt? */
  hasContent(): boolean {
    return this.hiddenSlides.length > 0 || this.slides.some((slide) => slide.pdfPage === null || slide.locked || slide.covers.length > 0 || slide.ink.strokes.length > 0);
  }

  /** Gibt es etwas, das „Alle Tinte löschen“ entfernen würde? Sperren bleiben dabei stehen. */
  hasClearable(): boolean {
    return this.hiddenSlides.length > 0 || this.slides.some((slide) => slide.pdfPage === null || slide.ink.strokes.length > 0);
  }

  /** Sperrt eine PDF-Seite oder gibt sie frei. Mindestens eine Seite muss sichtbar bleiben. */
  setLocked(index: number, locked: boolean): boolean {
    const slide = this.slides[index];
    if (!slide || slide.pdfPage === null) return false;
    if (locked && !this.slides.some((other) => other !== slide && !other.locked)) return false;
    slide.locked = locked;
    return true;
  }

  /** Die nächste nicht gesperrte Seite in dieser Richtung, null am Ende. */
  nextVisible(from: number, direction: 1 | -1): number | null {
    for (let index = from + direction; index >= 0 && index < this.slides.length; index += direction) {
      if (!this.slides[index].locked) return index;
    }
    return null;
  }

  /** Die Seite selbst oder, wenn sie gesperrt ist, die nächste sichtbare. */
  nearestVisible(index: number): number {
    if (!this.slides[index]?.locked) return index;
    return this.nextVisible(index, 1) ?? this.nextVisible(index, -1) ?? index;
  }

  firstVisible(): number {
    return this.nearestVisible(0);
  }

  lastVisible(): number {
    const last = this.slides.length - 1;
    return this.slides[last].locked ? (this.nextVisible(last, -1) ?? last) : last;
  }

  /** Für die Anzeige: Die Klasse soll nicht an „3 / 11“ sehen, dass Seiten fehlen. */
  visiblePosition(index: number): { position: number; total: number } {
    const visible = this.slides.filter((slide) => !slide.locked);
    return { position: visible.indexOf(this.slides[index]) + 1, total: visible.length };
  }

  hasInk(): boolean {
    return this.slides.some((slide) => slide.ink.strokes.length > 0);
  }

  /** Für die nächste Lerngruppe: Tinte weg, eingefügte leere Seiten auch. */
  clearAllInk(): void {
    this.slides = this.slides.filter((slide) => slide.pdfPage !== null);
    this.hiddenSlides = [];
    this.slides.forEach((slide) => slide.ink.clear());
    this.current = Math.min(this.current, this.slides.length - 1);
  }

  insertBlankAfter(index: number, aspect: number): number {
    const position = Math.min(index + 1, this.slides.length);
    this.slides.splice(position, 0, { id: this.nextId++, pdfPage: null, aspect, ink: new PageInk(), locked: false, covers: [] });
    return position;
  }

  /** Nur leere Seiten lassen sich entfernen. Das PDF selbst bleibt immer vollständig. */
  removeBlank(index: number): boolean {
    const slide = this.slides[index];
    if (!slide || slide.pdfPage !== null) return false;
    this.slides.splice(index, 1);
    if (this.current >= this.slides.length) this.current = this.slides.length - 1;
    else if (this.current > index) this.current -= 1;
    return true;
  }

  /** Index der Folie, die diese PDF-Seite zeigt. */
  indexOfPage(pageNumber: number): number {
    const index = this.slides.findIndex((slide) => slide.pdfPage === pageNumber);
    return index >= 0 ? index : 0;
  }
}

export type EraserMode = 'stroke' | 'partial';
export type EdgeMode = 'page' | 'black';
export type PointerMode = 'laser' | 'spot';

export interface Preferences {
  tool: Tool;
  penType: PenType;
  /** Glättung für neue Stiftstriche */
  penSmoothing: Smoothing;
  penColor: string;
  penWidth: number;
  markerColor: string;
  markerWidth: number;
  markerStraight: boolean;
  shapeType: ShapeType;
  eraserMode: EraserMode;
  eraserSize: number;
  fingerDraws: boolean;
  /** Leiste bleibt stehen, die Seite rückt so weit, dass sie nichts verdeckt */
  toolbarPinned: boolean;
  /** Der Zeiger: Laserpunkt oder dunkles Bild mit einem Sichtfenster */
  pointerMode: PointerMode;
  /** Radius des Sichtfensters als Anteil der kürzeren Bildschirmseite */
  spotSize: number;
  timerMinutes: number;
  timerSize: TimerSize;
  /** Mitte der Timeranzeige als Anteil des Bildschirms */
  timerX: number;
  timerY: number;
  /** Fläche um die Folie: in der Farbe des Folienrands oder schwarz */
  edgeMode: EdgeMode;
  /** Die Schnellfarben in der Leiste */
  quickPen: string[];
  quickMarker: string[];
  /** Selbst gemischte Farben */
  customPen: string[];
  customMarker: string[];
}

export interface NamedColor {
  name: string;
  value: string;
}

export const PEN_PALETTE: NamedColor[] = [
  { name: 'Schwarz', value: '#111111' },
  { name: 'Grau', value: '#6b7280' },
  { name: 'Rot', value: '#d92626' },
  { name: 'Orange', value: '#ea7317' },
  { name: 'Braun', value: '#8a5a2b' },
  { name: 'Grün', value: '#1a8f3c' },
  { name: 'Türkis', value: '#0e9aa7' },
  { name: 'Blau', value: '#1f5fd6' },
  { name: 'Dunkelblau', value: '#1b2f6b' },
  { name: 'Lila', value: '#7c3aed' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Weiß', value: '#ffffff' },
];

export const MARKER_PALETTE: NamedColor[] = [
  { name: 'Gelb', value: '#ffe14d' },
  { name: 'Orange', value: '#ffb65c' },
  { name: 'Grün', value: '#7ee081' },
  { name: 'Türkis', value: '#7fe3dc' },
  { name: 'Blau', value: '#8fd3ff' },
  { name: 'Lila', value: '#c9b1ff' },
  { name: 'Pink', value: '#ff9ecb' },
  { name: 'Grau', value: '#c9ced6' },
];

export const SMOOTHING_LEVELS: { level: Smoothing; label: string }[] = [
  { level: 'off', label: 'Aus' },
  { level: 'light', label: 'Leicht' },
  { level: 'strong', label: 'Stark' },
];

export const PEN_TYPES: { type: PenType; label: string }[] = [
  { type: 'ball', label: 'Kugelschreiber' },
  { type: 'fountain', label: 'Füller' },
  { type: 'fineliner', label: 'Fineliner' },
  { type: 'brush', label: 'Pinsel' },
];

/** Grenzen der Regler, in Seitenbreiten */
export const WIDTH_RANGES = {
  pen: { min: 0.0008, max: 0.014 },
  marker: { min: 0.006, max: 0.05 },
  eraser: { min: 0.004, max: 0.05 },
};

export type WidthRange = keyof typeof WIDTH_RANGES;

/** Der Regler läuft logarithmisch, damit feine Striche fein einstellbar bleiben. */
export function sliderToWidth(range: WidthRange, slider: number): number {
  const { min, max } = WIDTH_RANGES[range];
  return min * Math.pow(max / min, slider);
}

export function widthToSlider(range: WidthRange, width: number): number {
  const { min, max } = WIDTH_RANGES[range];
  return Math.log(width / min) / Math.log(max / min);
}

const QUICK_COLORS = 4;
const CUSTOM_COLORS = 6;
const STORAGE_KEY = 'pdf-praesentation-einstellungen';
const POSITION_PREFIX = 'pdf-praesentation-seite:';
const GROUP_PREFIX = 'pdf-praesentation-gruppe:';
const TOOLS: Tool[] = ['laser', 'pen', 'marker', 'eraser', 'shape', 'cover'];

const DEFAULTS: Preferences = {
  tool: 'pen',
  penType: 'ball',
  penSmoothing: 'light',
  penColor: '#d92626',
  penWidth: 0.0032,
  markerColor: '#ffe14d',
  markerWidth: 0.02,
  markerStraight: false,
  shapeType: 'arrow',
  eraserMode: 'stroke',
  eraserSize: 0.012,
  fingerDraws: false,
  toolbarPinned: false,
  pointerMode: 'laser',
  spotSize: 0.16,
  timerMinutes: 5,
  timerSize: 'medium',
  timerX: 0.9,
  timerY: 0.1,
  edgeMode: 'page',
  quickPen: ['#111111', '#d92626', '#1f5fd6', '#1a8f3c'],
  quickMarker: ['#ffe14d', '#7ee081', '#ff9ecb', '#8fd3ff'],
  customPen: [],
  customMarker: [],
};

/** Liest gespeicherte Werte und fällt bei allem Unbrauchbaren auf die Vorgabe zurück. */
export function normalizePreferences(stored: unknown): Preferences {
  const values = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Preferences>;
  const preferences = { ...DEFAULTS, ...values };
  if (!TOOLS.includes(preferences.tool)) preferences.tool = DEFAULTS.tool;
  if (!['small', 'medium', 'large', 'huge'].includes(preferences.timerSize)) preferences.timerSize = DEFAULTS.timerSize;
  if (!['page', 'black'].includes(preferences.edgeMode)) preferences.edgeMode = DEFAULTS.edgeMode;
  if (!['off', 'light', 'strong'].includes(preferences.penSmoothing)) preferences.penSmoothing = DEFAULTS.penSmoothing;
  if (!['laser', 'spot'].includes(preferences.pointerMode)) preferences.pointerMode = DEFAULTS.pointerMode;
  for (const key of ['timerX', 'timerY'] as const) {
    if (typeof preferences[key] !== 'number' || !Number.isFinite(preferences[key])) preferences[key] = DEFAULTS[key];
  }
  for (const key of ['penWidth', 'markerWidth', 'eraserSize', 'timerMinutes', 'spotSize'] as const) {
    if (typeof preferences[key] !== 'number' || !(preferences[key] > 0)) preferences[key] = DEFAULTS[key];
  }
  for (const key of ['quickPen', 'quickMarker', 'customPen', 'customMarker'] as const) {
    if (!Array.isArray(preferences[key])) preferences[key] = DEFAULTS[key];
  }
  return preferences;
}

/** Eine neue Farbe ersetzt die letzte Schnellfarbe. Die Reihenfolge der übrigen bleibt, damit die Hand sie wiederfindet. */
export function withQuickColor(quick: string[], color: string): string[] {
  if (quick.includes(color)) return quick;
  return [...quick.slice(0, QUICK_COLORS - 1), color];
}

export function withCustomColor(custom: string[], color: string): string[] {
  return [color, ...custom.filter((entry) => entry !== color)].slice(0, CUSTOM_COLORS);
}

/**
 * Die zuletzt gezeigte Seite gehört zum Gerät. Stünde sie in der Tintendatei, schriebe schon
 * bloßes Blättern eine Fassung, die auf einem anderen Gerät neuere Tinte verdrängen kann.
 */
export function loadPosition(pdfPath: string): number | null {
  try {
    const stored = window.localStorage.getItem(POSITION_PREFIX + pdfPath);
    return stored === null ? null : Number(stored) || 0;
  } catch {
    return null;
  }
}

export function savePosition(pdfPath: string, index: number): void {
  try {
    window.localStorage.setItem(POSITION_PREFIX + pdfPath, String(index));
  } catch {
    // Dann startet das PDF beim nächsten Mal vorn.
  }
}

/** Welcher Tintenstand zuletzt zu diesem PDF gehörte. Auch das gehört zum Gerät. */
export function loadGroup(pdfPath: string): string {
  try {
    return window.localStorage.getItem(GROUP_PREFIX + pdfPath) ?? '';
  } catch {
    return '';
  }
}

export function saveGroup(pdfPath: string, group: string): void {
  try {
    if (group) window.localStorage.setItem(GROUP_PREFIX + pdfPath, group);
    else window.localStorage.removeItem(GROUP_PREFIX + pdfPath);
  } catch {
    // Dann startet das PDF beim nächsten Mal mit dem Standard-Tintenstand.
  }
}

/** Liegt je Gerät im localStorage und bewusst nicht im iCloud-Vault. */
export function loadPreferences(): Preferences {
  try {
    return normalizePreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return normalizePreferences({});
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ohne Speicher starten die Werkzeuge beim nächsten Mal mit den Vorgaben.
  }
}
