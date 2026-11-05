import type { PdfDocument, PdfPage, PdfRenderTask } from './types';

interface Entry {
  canvas: HTMLCanvasElement | null;
  width: number;
  pendingWidth: number;
  pending: Promise<HTMLCanvasElement> | null;
  task: PdfRenderTask | null;
  /** Nur der neueste Auftrag darf sein Ergebnis abliefern. */
  generation: number;
}

/** Gleicher Name wie der Abbruchfehler von pdf.js, damit der Aufrufer nur einen Fall kennt. */
function cancelled(): Error {
  const error = new Error('Rendern abgebrochen');
  error.name = 'RenderingCancelledException';
  return error;
}

/** Gibt den Speicher einer Leinwand sofort frei. iPadOS hält ihn sonst noch lange fest. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function whiteCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Keine Zeichenfläche verfügbar');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

/** Rendert PDF-Seiten und hält nur die Seiten rund um die aktuelle im Speicher. */
export class PageRenderer {
  private pages = new Map<number, Promise<PdfPage>>();
  private entries = new Map<number, Entry>();
  private destroyed = false;

  constructor(private doc: PdfDocument) {}

  private page(pageNumber: number): Promise<PdfPage> {
    let page = this.pages.get(pageNumber);
    if (!page) {
      page = this.doc.getPage(pageNumber);
      this.pages.set(pageNumber, page);
    }
    return page;
  }

  /** Höhe durch Breite der Seite. */
  async aspect(pageNumber: number): Promise<number> {
    const viewport = (await this.page(pageNumber)).getViewport({ scale: 1 });
    return viewport.height / viewport.width;
  }

  cached(pageNumber: number): HTMLCanvasElement | null {
    return this.entries.get(pageNumber)?.canvas ?? null;
  }

  render(pageNumber: number, pixelWidth: number): Promise<HTMLCanvasElement> {
    let entry = this.entries.get(pageNumber);
    if (!entry) {
      entry = { canvas: null, width: 0, pendingWidth: 0, pending: null, task: null, generation: 0 };
      this.entries.set(pageNumber, entry);
    }
    if (entry.canvas && entry.width >= pixelWidth) return Promise.resolve(entry.canvas);
    if (entry.pending && entry.pendingWidth >= pixelWidth) return entry.pending;
    entry.task?.cancel();
    entry.task = null;
    const generation = ++entry.generation;
    const pending = this.renderInto(entry, generation, pageNumber, pixelWidth).finally(() => {
      if (entry.generation === generation) entry.pending = null;
    });
    entry.pending = pending;
    entry.pendingWidth = pixelWidth;
    return pending;
  }

  private async renderInto(entry: Entry, generation: number, pageNumber: number, pixelWidth: number): Promise<HTMLCanvasElement> {
    const page = await this.page(pageNumber);
    if (this.destroyed || entry.generation !== generation) throw cancelled();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pixelWidth / base.width });
    const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
    canvas.className = 'pp-page-canvas';
    const task = page.render({ canvas, canvasContext: context, viewport });
    entry.task = task;
    try {
      await task.promise;
    } catch (error) {
      releaseCanvas(canvas);
      throw error;
    }
    if (this.destroyed || this.entries.get(pageNumber) !== entry || entry.generation !== generation) {
      releaseCanvas(canvas);
      throw cancelled();
    }
    entry.task = null;
    const old = entry.canvas;
    entry.canvas = canvas;
    entry.width = canvas.width;
    if (old) {
      old.remove();
      releaseCanvas(old);
    }
    return canvas;
  }

  /** Verwirft alle Seiten außerhalb der Auswahl. */
  retain(pageNumbers: Set<number>): void {
    for (const [pageNumber, entry] of this.entries) {
      if (pageNumbers.has(pageNumber)) continue;
      entry.generation++;
      entry.task?.cancel();
      if (entry.canvas) {
        entry.canvas.remove();
        releaseCanvas(entry.canvas);
      }
      this.entries.delete(pageNumber);
    }
    // pdf.js hält sonst die Daten jeder berührten Seite. Läuft dort gerade etwas, lässt es die Seite in Ruhe.
    for (const [pageNumber, page] of this.pages) {
      if (pageNumbers.has(pageNumber)) continue;
      this.pages.delete(pageNumber);
      void page.then((loaded) => loaded.cleanup?.()).catch(() => undefined);
    }
  }

  /** Eigenständiges Vorschaubild für die Übersicht, geht nicht in den Zwischenspeicher. */
  async thumbnail(pageNumber: number, pixelWidth: number): Promise<{ canvas: HTMLCanvasElement; task: PdfRenderTask }> {
    const page = await this.page(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pixelWidth / base.width });
    const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
    return { canvas, task: page.render({ canvas, canvasContext: context, viewport }) };
  }

  /** Rendert nur einen Ausschnitt der Seite, für scharfe Darstellung im Zoom. */
  async region(
    pageNumber: number,
    area: { pageWidth: number; offsetX: number; offsetY: number; width: number; height: number },
  ): Promise<{ canvas: HTMLCanvasElement; task: PdfRenderTask }> {
    const page = await this.page(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: area.pageWidth / base.width,
      offsetX: area.offsetX,
      offsetY: area.offsetY,
    });
    const { canvas, context } = whiteCanvas(area.width, area.height);
    return { canvas, task: page.render({ canvas, canvasContext: context, viewport }) };
  }

  destroy(): void {
    this.destroyed = true;
    this.retain(new Set());
  }
}
