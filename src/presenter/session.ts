import { PageInk, type PenType, type ShapeType } from './ink';
import type { Tool } from './types';

/** Eine Folie ist eine PDF-Seite oder eine eingefügte leere Seite. */
export interface Slide {
  id: number;
  pdfPage: number | null;
  /** Höhe durch Breite, nur bei leeren Seiten fest */
  aspect: number | null;
  ink: PageInk;
}

/** Was zwischen zwei Präsentationen desselben PDFs erhalten bleibt. */
export class PresentationSession {
  slides: Slide[] = [];
  current = 0;
  private nextId = 1;

  constructor(pageCount: number) {
    for (let page = 1; page <= pageCount; page++) this.appendSlide(page, null);
  }

  appendSlide(pdfPage: number | null, aspect: number | null): Slide {
    const slide: Slide = { id: this.nextId++, pdfPage, aspect, ink: new PageInk() };
    this.slides.push(slide);
    return slide;
  }

  /** Gibt es etwas, das sich aufzuheben lohnt? */
  hasContent(): boolean {
    return this.slides.some((slide) => slide.pdfPage === null || slide.ink.strokes.length > 0);
  }

  hasInk(): boolean {
    return this.slides.some((slide) => slide.ink.strokes.length > 0);
  }

  /** Für die nächste Lerngruppe: Tinte weg, eingefügte leere Seiten auch. */
  clearAllInk(): void {
    this.slides = this.slides.filter((slide) => slide.pdfPage !== null);
    this.slides.forEach((slide) => slide.ink.clear());
    this.current = Math.min(this.current, this.slides.length - 1);
  }

  insertBlankAfter(index: number, aspect: number): number {
    const position = Math.min(index + 1, this.slides.length);
    this.slides.splice(position, 0, { id: this.nextId++, pdfPage: null, aspect, ink: new PageInk() });
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

export interface Preferences {
  tool: Tool;
  penType: PenType;
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
const TOOLS: Tool[] = ['laser', 'pen', 'marker', 'eraser', 'shape'];

const DEFAULTS: Preferences = {
  tool: 'pen',
  penType: 'ball',
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
  for (const key of ['penWidth', 'markerWidth', 'eraserSize'] as const) {
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
