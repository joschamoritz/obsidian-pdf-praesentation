// Das Dateiformat der gespeicherten Tinte. Ohne Dateizugriff, damit es sich testen lässt.
import { cleanStroke, type InkKind, type InkPoint, type PenType, type Stroke } from './ink';
import { PresentationSession, type Slide } from './session';

/** Ab Version 2 sind Striche frei von überlappenden Stiftdaten. Ältere werden beim Laden aufgeräumt. */
export const INK_FILE_VERSION = 2;

/** Nicht kryptografisch (cyrb53): Es geht nur ums Wiedererkennen, und es läuft ohne Abhängigkeit. */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function hashText(text: string): string {
  return hashBytes(new TextEncoder().encode(text));
}

interface StoredStroke {
  k: 'p' | 'm';
  c: string;
  b: number;
  t?: PenType;
  s?: 1;
  /** x, y, Druck, Breite je Punkt hintereinander, das spart etwa die Hälfte gegenüber Objekten */
  d: number[];
}

interface StoredSlide {
  /** PDF-Seite, fehlt bei leeren Seiten */
  p?: number;
  /** Höhe durch Breite einer leeren Seite */
  a?: number;
  s?: StoredStroke[];
}

export interface InkFile {
  version: number;
  path: string;
  current: number;
  slides: StoredSlide[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function storeStroke(stroke: Stroke): StoredStroke {
  const data: number[] = [];
  for (const point of stroke.points) {
    data.push(round(point.x, 5), round(point.y, 5), round(point.p, 2), round(point.w, 5));
  }
  const stored: StoredStroke = { k: stroke.kind === 'marker' ? 'm' : 'p', c: stroke.color, b: round(stroke.width, 5), d: data };
  if (stroke.penType) stored.t = stroke.penType;
  if (stroke.sharp) stored.s = 1;
  return stored;
}

function restoreStroke(stored: StoredStroke): Stroke | null {
  if (!stored || !Array.isArray(stored.d) || stored.d.length < 4 || stored.d.length % 4 !== 0) return null;
  if (typeof stored.c !== 'string' || typeof stored.b !== 'number') return null;
  if (stored.d.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const points: InkPoint[] = [];
  for (let i = 0; i < stored.d.length; i += 4) {
    points.push({ x: stored.d[i], y: stored.d[i + 1], p: stored.d[i + 2], w: stored.d[i + 3] });
  }
  const kind: InkKind = stored.k === 'm' ? 'marker' : 'pen';
  const stroke: Stroke = { kind, color: stored.c, width: stored.b, points };
  if (stored.t) stroke.penType = stored.t;
  if (stored.s) stroke.sharp = true;
  return stroke;
}

/** Gibt null zurück, wenn es nichts aufzuheben gibt. Dann braucht es auch keine Datei. */
export function serializeSession(session: PresentationSession, path: string): string | null {
  if (!session.hasContent()) return null;
  const file: InkFile = {
    version: INK_FILE_VERSION,
    path,
    current: session.current,
    slides: session.slides.map((slide) => {
      const stored: StoredSlide = slide.pdfPage === null ? { a: slide.aspect ?? undefined } : { p: slide.pdfPage };
      if (slide.ink.strokes.length) stored.s = slide.ink.strokes.map(storeStroke);
      return stored;
    }),
  };
  return JSON.stringify(file);
}

/**
 * Eine Datei ohne Tinte. Sie ersetzt das Löschen: iCloud stellt eine Datei wieder her,
 * die Sekunden nach dem Schreiben gelöscht wird, und damit wäre die Tinte zurück.
 */
export function emptyInkFile(path: string): string {
  const file: InkFile = { version: INK_FILE_VERSION, path, current: 0, slides: [] };
  return JSON.stringify(file);
}

export class InkFileError extends Error {
  constructor(message: string, readonly newerVersion = false) {
    super(message);
  }
}

export function parseInkFile(text: string): InkFile {
  let file: InkFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new InkFileError('Die Tintendatei ist beschädigt.');
  }
  if (!file || typeof file !== 'object' || !Array.isArray(file.slides) || typeof file.version !== 'number') {
    throw new InkFileError('Die Tintendatei hat ein unbekanntes Format.');
  }
  if (file.version > INK_FILE_VERSION) {
    throw new InkFileError('Die Tintendatei stammt aus einer neueren Plugin-Version.', true);
  }
  return file;
}

function restoreInk(slide: Slide, stored: StoredSlide, version: number): void {
  if (!Array.isArray(stored.s)) return;
  const strokes = stored.s.map(restoreStroke).filter((stroke): stroke is Stroke => stroke !== null);
  slide.ink.strokes = version < 2 ? strokes.map(cleanStroke) : strokes;
}

/**
 * Baut die Sitzung aus der Datei. Das PDF hat Vorrang: Jede seiner Seiten kommt genau
 * einmal vor, auch wenn es inzwischen mehr oder weniger Seiten hat als beim Speichern.
 */
export function restoreSession(file: InkFile, pageCount: number): { session: PresentationSession; droppedInk: boolean } {
  const session = new PresentationSession(0);
  const seen = new Set<number>();
  let droppedInk = false;
  for (const stored of file.slides) {
    if (typeof stored?.p === 'number') {
      if (stored.p < 1 || stored.p > pageCount || seen.has(stored.p)) {
        if (stored.s?.length) droppedInk = true;
        continue;
      }
      seen.add(stored.p);
      restoreInk(session.appendSlide(stored.p, null), stored, file.version);
    } else if (stored && typeof stored === 'object') {
      restoreInk(session.appendSlide(null, typeof stored.a === 'number' && stored.a > 0 ? stored.a : 0.75), stored, file.version);
    }
  }
  for (let page = 1; page <= pageCount; page++) {
    if (!seen.has(page)) session.appendSlide(page, null);
  }
  const current = Number.isInteger(file.current) ? file.current : 0;
  session.current = Math.max(0, Math.min(session.slides.length - 1, current));
  return { session, droppedInk };
}
