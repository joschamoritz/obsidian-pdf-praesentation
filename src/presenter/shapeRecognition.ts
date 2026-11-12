// Zeichnen und halten: Bleibt der Stift am Ende eines Strichs stehen, wird aus dem Strich eine
// gerade Linie, ein Rechteck oder eine Ellipse. Ohne DOM, damit es sich prüfen lässt.

import type { ShapeType } from './ink';

export interface Recognized {
  type: Extract<ShapeType, 'line' | 'rectangle' | 'ellipse'>;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

type Point = { x: number; y: number };

/** Kleiner als das bleibt es Schrift: Ein „l“ oder ein „o“ soll kein Strich und kein Kreis werden. */
const MIN_LINE_LENGTH = 0.02;
const MIN_CLOSED_SIZE = 0.025;
/** Wie weit ein Strich von der Geraden abweichen darf, als Anteil seiner Länge */
const LINE_TOLERANCE = 0.08;
/** Wie nah das Ende am Anfang liegen muss, als Anteil der größeren Seite */
const CLOSE_TOLERANCE = 0.3;
/** Ein Kreis ist rundherum etwa 1,57-mal so lang wie Breite plus Höhe, ein Rechteck 2-mal. Darunter ist es nicht geschlossen. */
/** Wie gut eine Form passen muss, als Anteil der kleineren Seite */
const FIT_TOLERANCE = 0.16;

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function recognizeShape(points: Point[]): Recognized | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);

  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (chord >= MIN_LINE_LENGTH) {
    const deviation = Math.max(...points.map((point) => distanceToSegment(point, start, end)));
    if (deviation <= Math.max(LINE_TOLERANCE * chord, 0.003)) return { type: 'line', start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const larger = Math.max(width, height);
  const smaller = Math.min(width, height);
  const closed = chord <= CLOSE_TOLERANCE * larger && length >= 1.3 * (width + height);
  if (larger < MIN_CLOSED_SIZE || smaller < MIN_CLOSED_SIZE / 3 || !closed) return null;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = width / 2;
  const ry = height / 2;
  let ellipseError = 0;
  let rectangleError = 0;
  for (const point of points) {
    const radius = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
    ellipseError += Math.abs(radius - 1) * Math.min(rx, ry);
    rectangleError += Math.min(point.x - minX, maxX - point.x, point.y - minY, maxY - point.y);
  }
  ellipseError /= points.length;
  rectangleError /= points.length;
  const best = Math.min(ellipseError, rectangleError);
  if (best > FIT_TOLERANCE * smaller) return null;
  return {
    type: rectangleError < ellipseError ? 'rectangle' : 'ellipse',
    start: { x: minX, y: minY },
    end: { x: maxX, y: maxY },
  };
}
