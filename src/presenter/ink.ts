// Tinte in Seitenkoordinaten: x läuft von 0 bis 1 über die Seitenbreite, y in
// derselben Einheit. So bleibt jeder Strich beim Zoomen und Drehen an seiner Stelle.

import { getStroke } from 'perfect-freehand';

export type InkKind = 'pen' | 'marker';
export type PenType = 'ball' | 'fountain' | 'fineliner' | 'brush';
export type ShapeType = 'line' | 'arrow' | 'rectangle' | 'ellipse';

export interface InkPoint {
  x: number;
  y: number;
  /** Druckstärke 0 bis 1 */
  p: number;
  /** Strichbreite an dieser Stelle, in Seitenbreiten */
  w: number;
}

export interface Stroke {
  kind: InkKind;
  color: string;
  width: number;
  penType?: PenType;
  /** Gerade Verbindungen statt geglätteter Kurve, für Formen und den geraden Marker */
  sharp?: boolean;
  points: InkPoint[];
}

const MIN_POINT_DISTANCE = 0.0006;
const PRESSURE_SMOOTHING = 0.3;
const WIDTH_SMOOTHING = 0.35;
/** Kleine Schritte zurück sind Messrauschen oder überlappende Stiftdaten, keine Schrift. Etwa 3 Bildschirmpixel. */
const BACKTRACK_TOLERANCE = 0.0025;
/** Über so viele Punkte wird die Schreibrichtung bestimmt. Einzelne Schritte sind dafür zu grob gerastert. */
const DIRECTION_SPAN = 3;
const RECENT_POINTS = 16;
const HISTORY_LIMIT = 300;
/** Eine Füllerfeder ist schräg geschnitten: Quer zur Feder wird der Strich breit. */
const NIB_ANGLE = -Math.PI / 4;

/** Breite an einem Punkt. Hier unterscheiden sich die Stiftarten. */
export function widthAt(stroke: Stroke, pressure: number, dx = 0, dy = 0): number {
  if (stroke.kind === 'marker' || stroke.sharp) return stroke.width;
  switch (stroke.penType ?? 'ball') {
    case 'fineliner':
      return stroke.width;
    case 'fountain': {
      const moving = dx !== 0 || dy !== 0;
      const across = moving ? Math.abs(Math.sin(Math.atan2(dy, dx) - NIB_ANGLE)) : 0.6;
      return stroke.width * (0.35 + 0.85 * across) * (0.7 + 0.6 * pressure);
    }
    case 'brush':
      return stroke.width * (0.2 + 1.8 * Math.pow(pressure, 1.4));
    case 'ball':
    default:
      return stroke.width * (0.75 + 0.5 * pressure);
  }
}

/** Hängt einen Punkt an, wenn er weit genug vom letzten entfernt ist. Im Zoom zählen auch kleinere Abstände. */
export function appendPoint(stroke: Stroke, x: number, y: number, pressure: number, zoom = 1): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (!last) {
    stroke.points.push({ x, y, p: pressure, w: widthAt(stroke, pressure) });
    return true;
  }
  if (Math.hypot(x - last.x, y - last.y) < MIN_POINT_DISTANCE / zoom) return false;
  const before = stroke.points[stroke.points.length - 2];
  if (before) {
    const backwards = (x - last.x) * (last.x - before.x) + (y - last.y) * (last.y - before.y) < 0;
    if (backwards && Math.hypot(x - last.x, y - last.y) < BACKTRACK_TOLERANCE / zoom) return false;
  }
  const p = last.p + (pressure - last.p) * PRESSURE_SMOOTHING;
  const from = stroke.points[Math.max(0, stroke.points.length - DIRECTION_SPAN)];
  const target = widthAt(stroke, p, x - from.x, y - from.y);
  stroke.points.push({ x, y, p, w: last.w + (target - last.w) * WIDTH_SMOOTHING });
  return true;
}

/**
 * Räumt Striche auf, die vor dem Filter für überlappende Stiftdaten entstanden sind.
 * Die Toleranz richtet sich nach dem üblichen Punktabstand, denn im Zoom Geschriebenes ist feiner.
 */
export function cleanStroke(stroke: Stroke): Stroke {
  if (stroke.sharp || stroke.points.length < 3) return stroke;
  const steps = stroke.points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - stroke.points[index].x, point.y - stroke.points[index].y))
    .sort((a, b) => a - b);
  const typical = steps[steps.length >> 1];
  const zoom = typical > 0 ? Math.max(1, BACKTRACK_TOLERANCE / (3 * typical)) : 1;
  const cleaned: Stroke = { ...stroke, points: [] };
  // Eine überlappende Liste kann auch mehrere Pixel zurückspringen. Sie wiederholt aber exakt dieselben Punkte.
  const recent: string[] = [];
  for (const point of stroke.points) {
    const key = `${point.x}|${point.y}`;
    if (recent.includes(key)) continue;
    recent.push(key);
    if (recent.length > RECENT_POINTS) recent.shift();
    appendPoint(cleaned, point.x, point.y, point.p, zoom);
  }
  return cleaned;
}

function distanceToSegment(px: number, py: number, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Begrenzungsbox je Strich, damit der Radierer nicht jeden Punkt jedes Strichs prüfen muss. */
const boxCache = new WeakMap<Stroke, { length: number; minX: number; maxX: number; minY: number; maxY: number }>();

function boxOf(stroke: Stroke) {
  const cached = boxCache.get(stroke);
  if (cached && cached.length === stroke.points.length) return cached;
  const box = { length: stroke.points.length, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const point of stroke.points) {
    box.minX = Math.min(box.minX, point.x);
    box.maxX = Math.max(box.maxX, point.x);
    box.minY = Math.min(box.minY, point.y);
    box.maxY = Math.max(box.maxY, point.y);
  }
  boxCache.set(stroke, box);
  return box;
}

export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const { points } = stroke;
  const box = boxOf(stroke);
  if (x < box.minX - reach || x > box.maxX + reach || y < box.minY - reach || y > box.maxY + reach) return false;
  if (points.length === 1) return Math.hypot(x - points[0].x, y - points[0].y) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(x, y, points[i - 1], points[i]) <= reach) return true;
  }
  return false;
}

/** Füllt lange Abschnitte mit Zwischenpunkten, damit sich auch eine Form mittendrin trennen lässt. */
function densify(points: InkPoint[], step: number): InkPoint[] {
  const result: InkPoint[] = [];
  points.forEach((point, index) => {
    if (index > 0) {
      const before = points[index - 1];
      const length = Math.hypot(point.x - before.x, point.y - before.y);
      const parts = Math.floor(length / step);
      for (let i = 1; i < parts; i++) {
        const t = i / parts;
        result.push({
          x: before.x + (point.x - before.x) * t,
          y: before.y + (point.y - before.y) * t,
          p: before.p + (point.p - before.p) * t,
          w: before.w + (point.w - before.w) * t,
        });
      }
    }
    result.push(point);
  });
  return result;
}

/** Radiert aus einem Strich nur den getroffenen Teil. Übrig bleiben null bis mehrere Stücke. */
export function eraseFromStroke(stroke: Stroke, x: number, y: number, radius: number): Stroke[] {
  const reach = radius + stroke.width / 2;
  const pieces: InkPoint[][] = [];
  let current: InkPoint[] = [];
  for (const point of densify(stroke.points, Math.max(radius / 2, 0.0015))) {
    if (Math.hypot(point.x - x, point.y - y) <= reach) {
      if (current.length) pieces.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) pieces.push(current);
  return pieces.filter((points) => points.length > 1).map((points) => ({ ...stroke, points }));
}

/** Die Tinte einer Seite mit Rückgängig und Wiederholen. Fertige Striche werden nie verändert, nur ersetzt. */
export class PageInk {
  strokes: Stroke[] = [];
  private undoStack: Stroke[][] = [];
  private redoStack: Stroke[][] = [];
  private eraseBase: Stroke[] | null = null;

  private remember(previous: Stroke[]): void {
    this.undoStack.push(previous);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  add(stroke: Stroke): void {
    this.remember(this.strokes);
    this.strokes = [...this.strokes, stroke];
  }

  beginErase(): void {
    this.eraseBase = this.strokes;
  }

  /** Entfernt getroffene Striche oder, mit `partial`, nur die getroffene Stelle. Meldet, ob sich etwas geändert hat. */
  eraseAt(x: number, y: number, radius: number, partial = false): boolean {
    let changed = false;
    const next: Stroke[] = [];
    for (const stroke of this.strokes) {
      if (!strokeHit(stroke, x, y, radius)) {
        next.push(stroke);
        continue;
      }
      changed = true;
      if (partial) next.push(...eraseFromStroke(stroke, x, y, radius));
    }
    if (changed) this.strokes = next;
    return changed;
  }

  endErase(): void {
    if (this.eraseBase && this.eraseBase !== this.strokes) this.remember(this.eraseBase);
    this.eraseBase = null;
  }

  clear(): void {
    if (!this.strokes.length) return;
    this.remember(this.strokes);
    this.strokes = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.strokes);
    this.strokes = previous;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.strokes);
    this.strokes = next;
    return true;
  }
}

/** Umriss einer Form als Punktfolge. Eine Form ist danach ein ganz normaler Strich. */
export function shapePoints(
  type: ShapeType,
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
): InkPoint[] {
  const point = (x: number, y: number): InkPoint => ({ x, y, p: 0.5, w: width });
  switch (type) {
    case 'rectangle':
      return [
        point(start.x, start.y),
        point(end.x, start.y),
        point(end.x, end.y),
        point(start.x, end.y),
        point(start.x, start.y),
      ];
    case 'ellipse': {
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const steps = 72;
      const points: InkPoint[] = [];
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        points.push(point(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
      }
      return points;
    }
    case 'arrow': {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const head = Math.min(Math.max(0.018, width * 5), length * 0.6);
      const barb = (side: number) =>
        point(end.x - head * Math.cos(angle + side * 0.5), end.y - head * Math.sin(angle + side * 0.5));
      return [point(start.x, start.y), point(end.x, end.y), barb(1), point(end.x, end.y), barb(-1)];
    }
    case 'line':
    default:
      return [point(start.x, start.y), point(end.x, end.y)];
  }
}

/**
 * perfect-freehand rechnet mit Schwellen in festen Einheiten (etwa "3" für das Strichende).
 * Die Seite ist bei uns 1 breit, deshalb wird für die Rechnung hochskaliert.
 */
const OUTLINE_SCALE = 4000;

/**
 * Der Umriss eines Stiftstrichs als eine einzige Fläche. Die Breite je Punkt legt weiter
 * die Stiftart fest: Mit thinning 1 und der Breite als Druck folgt der Umriss ihr genau.
 */
export function outlinePoints(stroke: Stroke, smooth = true): number[][] {
  const points = smooth ? smoothedPoints(stroke.points) : stroke.points;
  const widest = points.reduce((max, point) => Math.max(max, point.w), 0);
  if (!(widest > 0)) return [];
  const input = points.map((point) => [
    point.x * OUTLINE_SCALE,
    point.y * OUTLINE_SCALE,
    point.w / (2 * widest),
  ]);
  const outline = getStroke(input, {
    size: widest * OUTLINE_SCALE,
    thinning: 1,
    smoothing: 0.3,
    streamline: 0,
    simulatePressure: false,
    easing: (value) => value,
    last: true,
  });
  return outline.map(([x, y]) => [x / OUTLINE_SCALE, y / OUTLINE_SCALE]);
}

const SMOOTHING_PASSES = 2;

/**
 * Stiftpositionen kommen auf dem iPad nur in ganzen Gerätepixeln an. Ohne Glättung zeichnet der
 * Umriss jede Stufe nach. Nur fürs Zeichnen, die gespeicherten Punkte bleiben unverändert.
 */
export function smoothedPoints(points: InkPoint[]): InkPoint[] {
  let current = points;
  for (let pass = 0; pass < SMOOTHING_PASSES && current.length > 2; pass++) {
    const source = current;
    current = source.map((point, i) => {
      const previous = source[i - 1];
      const next = source[i + 1];
      if (!previous || !next) return point;
      return {
        x: (previous.x + 2 * point.x + next.x) / 4,
        y: (previous.y + 2 * point.y + next.y) / 4,
        p: point.p,
        w: (previous.w + 2 * point.w + next.w) / 4,
      };
    });
  }
  return current;
}

function filledPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const current = outline[i];
    const next = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  path.closePath();
  return path;
}

function centerlinePath(stroke: Stroke): Path2D {
  const path = new Path2D();
  const points = stroke.sharp ? stroke.points : smoothedPoints(stroke.points);
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (stroke.sharp || i === points.length - 1) {
      path.lineTo(points[i].x, points[i].y);
    } else {
      path.quadraticCurveTo(
        points[i].x,
        points[i].y,
        (points[i].x + points[i + 1].x) / 2,
        (points[i].y + points[i + 1].y) / 2,
      );
    }
  }
  return path;
}

/** Fertige Striche ändern sich nicht. Ihr Pfad bleibt gespeichert, das hält das Neuzeichnen beim Zoomen flüssig. */
const pathCache = new WeakMap<Stroke, { length: number; path: Path2D }>();

function pathFor(stroke: Stroke): Path2D {
  const cached = pathCache.get(stroke);
  if (cached && cached.length === stroke.points.length) return cached.path;
  const usesOutline = stroke.kind === 'pen' && !stroke.sharp;
  const path = usesOutline ? filledPath(outlinePoints(stroke)) : centerlinePath(stroke);
  pathCache.set(stroke, { length: stroke.points.length, path });
  return path;
}

/** Zeichnet den ganzen Strich in einem Zug. So decken sich die weichen Randpixel nie mehrfach. */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const first = stroke.points[0];
  if (!first) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.points.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, first.w / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (stroke.kind === 'pen' && !stroke.sharp) {
    ctx.fill(pathFor(stroke));
  } else {
    ctx.lineWidth = stroke.width;
    ctx.stroke(pathFor(stroke));
  }
}

/** Setzt den Kontext so, dass eine Einheit genau einer Seitenbreite entspricht. */
export function usePageUnits(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  ctx.setTransform(canvasWidth, 0, 0, canvasWidth, 0, 0);
}
