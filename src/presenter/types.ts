// Der Teil von pdf.js, den die Präsentation braucht. Obsidian liefert pdf.js
// selbst aus, die Version kann sich also mit jedem Update ändern.
export interface PdfViewport {
  width: number;
  height: number;
  convertToViewportPoint?(x: number, y: number): number[];
}

export interface PdfRenderTask {
  promise: Promise<unknown>;
  cancel(): void;
}

export interface PdfPage {
  getViewport(options: { scale: number; offsetX?: number; offsetY?: number }): PdfViewport;
  render(options: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }): PdfRenderTask;
  cleanup?(): unknown;
  getTextContent?(): Promise<{ items: { str?: string; transform?: number[]; width?: number }[] }>;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): unknown;
}

export type Tool = 'laser' | 'pen' | 'marker' | 'eraser' | 'shape' | 'cover';
