// Lasso: Tinte umkreisen, dann verschieben, kopieren oder löschen. Ohne DOM.

import type { Stroke } from './ink';

type Point = { x: number; y: number };

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ein Strich gehört dazu, wenn mehr als die Hälfte seiner Punkte im Lasso liegt. So fängt ein knappes Lasso noch die ganze Schrift. */
export function selectInLasso(strokes: Stroke[], polygon: Point[]): Stroke[] {
  if (polygon.length < 3) return [];
  return strokes.filter((stroke) => {
    const inside = stroke.points.filter((point) => pointInPolygon(point, polygon)).length;
    return inside > stroke.points.length / 2;
  });
}

export function selectionBounds(strokes: Stroke[]): Bounds | null {
  if (!strokes.length) return null;
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const stroke of strokes) {
    const reach = stroke.width / 2;
    for (const point of stroke.points) {
      bounds.minX = Math.min(bounds.minX, point.x - reach);
      bounds.maxX = Math.max(bounds.maxX, point.x + reach);
      bounds.minY = Math.min(bounds.minY, point.y - reach);
      bounds.maxY = Math.max(bounds.maxY, point.y + reach);
    }
  }
  return bounds;
}

export function insideBounds(point: Point, bounds: Bounds, padding: number): boolean {
  return point.x >= bounds.minX - padding && point.x <= bounds.maxX + padding && point.y >= bounds.minY - padding && point.y <= bounds.maxY + padding;
}

/** Neue Striche statt geänderter: Fertige Striche bleiben unverändert, so funktioniert Rückgängig. */
export function moveStrokes(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) }));
}

/** Ersetzt die ausgewählten Striche an ihrer Stelle, damit die Reihenfolge der Ebenen bleibt. */
export function replaceStrokes(all: Stroke[], selected: Stroke[], replacement: Stroke[]): Stroke[] {
  const index = new Map(selected.map((stroke, i) => [stroke, i]));
  return all.map((stroke) => (index.has(stroke) ? replacement[index.get(stroke) as number] : stroke));
}
