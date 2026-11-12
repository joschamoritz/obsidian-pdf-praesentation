// Zeichnen und halten: Bleibt der Stift am Ende eines Strichs stehen, wird aus dem Strich eine
// gerade Linie, ein Pfeil, ein Dreieck, ein Rechteck oder eine Ellipse. Ohne DOM, damit es sich prüfen lässt.

type Point = { x: number; y: number };

export type Recognized =
  | { type: 'line' | 'arrow' | 'rectangle' | 'ellipse'; start: Point; end: Point }
  | { type: 'triangle'; points: Point[]; start: Point; end: Point };

/** Kleiner als das bleibt es Schrift: Ein „l“ oder ein „o“ soll kein Strich und kein Kreis werden. */
const MIN_LINE_LENGTH = 0.02;
const MIN_CLOSED_SIZE = 0.025;
/** Wie weit ein Strich von der Geraden abweichen darf, als Anteil seiner Länge */
const LINE_TOLERANCE = 0.08;
/** Wie nah das Ende am Anfang liegen muss, als Anteil der größeren Seite */
const CLOSE_TOLERANCE = 0.3;
/** Ein Kreis ist rundherum etwa 1,57-mal so lang wie Breite plus Höhe, ein Rechteck 2-mal. Darunter ist es nicht geschlossen. */
const CLOSED_LENGTH = 1.3;
/** Wie gut eine Form passen muss, als Anteil der kleineren Seite */
const FIT_TOLERANCE = 0.16;
/** Pfeilspitze: Die Widerhaken bleiben in diesem Anteil der Schaftlänge rund um die Spitze */
const ARROW_HEAD = 0.4;

const copy = (point: Point): Point => ({ x: point.x, y: point.y });

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker: die Ecken eines Strichs */
function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= epsilon) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}

/** Gerader Schaft bis zur weitesten Stelle, danach nur noch kurze Haken zurück: ein Pfeil in einem Zug */
function arrowOf(points: Point[]): Recognized | null {
  const start = points[0];
  let tip = 0;
  let shaft = 0;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    if (distance > shaft) {
      shaft = distance;
      tip = index;
    }
  });
  if (shaft < MIN_LINE_LENGTH * 1.5 || tip === points.length - 1) return null;
  const end = points[tip];
  const straight = points.slice(0, tip + 1).every((point) => distanceToSegment(point, start, end) <= Math.max(LINE_TOLERANCE * shaft, 0.003));
  if (!straight) return null;
  const head = points.slice(tip + 1);
  const close = head.every((point) => Math.hypot(point.x - end.x, point.y - end.y) <= ARROW_HEAD * shaft);
  const barb = Math.max(...head.map((point) => Math.hypot(point.x - end.x, point.y - end.y)));
  // Der Haken zeigt zurück zum Anfang, nicht weiter nach vorn
  const back = head.some((point) => (point.x - end.x) * (start.x - end.x) + (point.y - end.y) * (start.y - end.y) > 0);
  if (!close || !back || barb < 0.12 * shaft) return null;
  return { type: 'arrow', start: copy(start), end: copy(end) };
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
    if (deviation <= Math.max(LINE_TOLERANCE * chord, 0.003)) return { type: 'line', start: copy(start), end: copy(end) };
  }

  const arrow = arrowOf(points);
  if (arrow) return arrow;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;
  const larger = Math.max(width, height);
  const smaller = Math.min(width, height);
  const closed = chord <= CLOSE_TOLERANCE * larger && length >= CLOSED_LENGTH * (width + height);
  if (larger < MIN_CLOSED_SIZE || smaller < MIN_CLOSED_SIZE / 3 || !closed) return null;
  const box = { start: { x: minX, y: minY }, end: { x: maxX, y: maxY } };

  // Drei deutliche Ecken: ein Dreieck mit genau diesen Ecken
  const corners = simplify(points, 0.1 * larger);
  const last = corners[corners.length - 1];
  if (corners.length > 1 && Math.hypot(last.x - corners[0].x, last.y - corners[0].y) <= CLOSE_TOLERANCE * larger) corners.pop();
  if (corners.length === 3) {
    const triangle = corners.map(copy);
    const fits = points.every(
      (point) => Math.min(...triangle.map((a, i) => distanceToSegment(point, a, triangle[(i + 1) % 3]))) <= FIT_TOLERANCE * smaller * 1.5,
    );
    if (fits) return { type: 'triangle', points: [...triangle, copy(triangle[0])], ...box };
  }

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
  return { type: rectangleError < ellipseError ? 'rectangle' : 'ellipse', ...box };
}
