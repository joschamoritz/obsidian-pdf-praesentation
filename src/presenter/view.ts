// Reine Rechnungen für Einpassen, Zoomen und Verschieben.

export interface Size {
  width: number;
  height: number;
}

export interface ViewState {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/** Größte Seite, die in die Bühne passt. `aspect` ist Höhe durch Breite. */
export function fitSheet(stage: Size, aspect: number): Size {
  const width = Math.min(stage.width, stage.height / aspect);
  return { width, height: width * aspect };
}

function clampAxis(position: number, sheet: number, stage: number): number {
  if (sheet <= stage) return (stage - sheet) / 2;
  return Math.min(0, Math.max(stage - sheet, position));
}

/** Eine kleinere Seite bleibt mittig, eine größere deckt die Bühne lückenlos. */
export function clampView(view: ViewState, sheet: Size, stage: Size): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  return {
    zoom,
    x: clampAxis(view.x, sheet.width * zoom, stage.width),
    y: clampAxis(view.y, sheet.height * zoom, stage.height),
  };
}

/** Hält den Punkt unter (cx, cy) beim Zoomen fest und verschiebt um (dx, dy). */
export function zoomAround(
  view: ViewState,
  cx: number,
  cy: number,
  factor: number,
  dx: number,
  dy: number,
): ViewState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const applied = zoom / view.zoom;
  return {
    zoom,
    x: cx - (cx - view.x) * applied + dx,
    y: cy - (cy - view.y) * applied + dy,
  };
}

/** Seitengröße in ganzen Gerätepixeln. Sonst wird die Seite beim Anzeigen um Pixelbruchteile verschmiert. */
export function snapSize(size: Size, pixelRatio: number): Size {
  return {
    width: Math.round(size.width * pixelRatio) / pixelRatio,
    height: Math.round(size.height * pixelRatio) / pixelRatio,
  };
}

/** Lage der Seite auf ganze Gerätepixel. */
export function snapView(view: ViewState, pixelRatio: number): ViewState {
  return {
    zoom: view.zoom,
    x: Math.round(view.x * pixelRatio) / pixelRatio,
    y: Math.round(view.y * pixelRatio) / pixelRatio,
  };
}

export interface VisibleRegion {
  /** Lage und Größe des Ausschnitts auf der Bühne, in ganzen Gerätepixeln */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Breite der ganzen Seite in Gerätepixeln bei diesem Zoom */
  pageWidth: number;
  /** Wo die Seitenecke relativ zum Ausschnitt liegt */
  offsetX: number;
  offsetY: number;
}

/** Der sichtbare Teil der Seite. Nur er wird im Zoom scharf nachgerendert, das spart Speicher. */
export function visibleRegion(view: ViewState, sheet: Size, stage: Size, pixelRatio: number): VisibleRegion {
  const pageLeft = view.x * pixelRatio;
  const pageTop = view.y * pixelRatio;
  const pageWidth = sheet.width * view.zoom * pixelRatio;
  const pageHeight = sheet.height * view.zoom * pixelRatio;
  const left = Math.max(0, Math.floor(pageLeft));
  const top = Math.max(0, Math.floor(pageTop));
  const right = Math.min(Math.ceil(stage.width * pixelRatio), Math.ceil(pageLeft + pageWidth));
  const bottom = Math.min(Math.ceil(stage.height * pixelRatio), Math.ceil(pageTop + pageHeight));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    pageWidth,
    offsetX: pageLeft - left,
    offsetY: pageTop - top,
  };
}

export type WheelAction = { type: 'zoom'; factor: number } | { type: 'pan'; dx: number; dy: number } | null;

const WHEEL_ZOOM_SPEED = 0.01;
/** Ein Mausrad meldet je Raste etwa 100, ein Trackpad viele kleine Werte. Die Kappung macht beide angenehm. */
const WHEEL_ZOOM_MAX_DELTA = 20;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 600;

/**
 * Strg + Rad zoomt. Die Zoomgeste auf dem Trackpad kommt im Browser ebenfalls als Rad mit Strg an.
 * Ohne Strg verschiebt das Rad nur eine gezoomte Seite. Geblättert wird damit nicht,
 * sonst springt die Seite beim Scrollen versehentlich weiter.
 */
export function wheelAction(
  event: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean },
  zoomed: boolean,
): WheelAction {
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const dx = event.deltaX * unit;
  const dy = event.deltaY * unit;
  if (event.ctrlKey) {
    const delta = Math.max(-WHEEL_ZOOM_MAX_DELTA, Math.min(WHEEL_ZOOM_MAX_DELTA, dy));
    return { type: 'zoom', factor: Math.exp(-delta * WHEEL_ZOOM_SPEED) };
  }
  return zoomed ? { type: 'pan', dx: -dx, dy: -dy } : null;
}

const KEY_ZOOM_STEP = 1.25;

/** Faktor für eine Zoomtaste, 0 steht für „zurück auf die ganze Seite“, null für jede andere Taste. */
export function keyZoomFactor(key: string): number | null {
  if (key === '+' || key === '=') return KEY_ZOOM_STEP;
  if (key === '-') return 1 / KEY_ZOOM_STEP;
  if (key === '0') return 0;
  return null;
}

/** Pixelbreite einer Leinwand mit Obergrenze, weil iPadOS keine beliebig großen Canvas verträgt. */
export function rasterWidth(cssWidth: number, aspect: number, scale: number, maxPixels: number): number {
  const wanted = cssWidth * scale;
  const capped = Math.sqrt(maxPixels / aspect);
  return Math.max(1, Math.round(Math.min(wanted, capped)));
}
