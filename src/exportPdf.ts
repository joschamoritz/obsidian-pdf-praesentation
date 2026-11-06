// Das Tafelbild mit Tinte als eigenes PDF: für Abwesende, GoodNotes oder die Reflexion.
// Die PDF-Seiten bleiben dabei Vektor und Text, die Tinte kommt als Vektor darüber.
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { outlinePoints, smoothedPoints, type Stroke } from './presenter/ink';
import type { PresentationSession } from './presenter/session';

function color(hex: string) {
  const value = parseInt(hex.replace('#', ''), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function drawInk(page: PDFPage, stroke: Stroke): void {
  const { x, y, width, height } = page.getCropBox();
  const scale = width;
  const place = { x, y: y + height };
  const pointsToPath = (points: number[][], close: boolean) =>
    points.map(([px, py], index) => `${index ? 'L' : 'M'}${(px * scale).toFixed(2)} ${(py * scale).toFixed(2)}`).join(' ') + (close ? ' Z' : '');
  if (stroke.kind === 'pen' && !stroke.sharp) {
    const outline = outlinePoints(stroke);
    if (outline.length) page.drawSvgPath(pointsToPath(outline, true), { ...place, color: color(stroke.color), borderWidth: 0 });
    return;
  }
  const line = (stroke.sharp ? stroke.points : smoothedPoints(stroke.points)).map((point) => [point.x, point.y]);
  page.drawSvgPath(pointsToPath(line, false), {
    ...place,
    borderColor: color(stroke.color),
    borderWidth: stroke.width * scale,
    borderOpacity: stroke.kind === 'marker' ? 0.5 : 1,
    borderLineCap: 1,
  });
}

/** Gesperrte Seiten bleiben draußen: Das sind meist Lösungen, und das Blatt geht an die Klasse. */
export async function exportWithInk(pdfBytes: ArrayBuffer | Uint8Array, session: PresentationSession): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const result = await PDFDocument.create();
  let lastSize: [number, number] = [842, 595];
  for (const slide of session.slides) {
    if (slide.locked) continue;
    let page: PDFPage;
    if (slide.pdfPage !== null) {
      [page] = await result.copyPages(source, [slide.pdfPage - 1]);
      result.addPage(page);
      const box = page.getCropBox();
      lastSize = [box.width, box.height];
    } else {
      page = result.addPage([lastSize[0], lastSize[0] * (slide.aspect ?? 0.75)]);
    }
    const strokes = slide.ink.strokes;
    for (const stroke of strokes) if (stroke.kind === 'marker') drawInk(page, stroke);
    for (const stroke of strokes) if (stroke.kind === 'pen') drawInk(page, stroke);
  }
  return result.save();
}
