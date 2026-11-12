// Laserpointer: leuchtende Spur mit hellem Punkt, nichts bleibt auf der Seite.
// Die Spur ist eine einzige Fläche wie ein Stiftstrich. Einzelne Abschnitte mit runden Enden
// zeigten bei schnellen Bewegungen Perlen statt einer Linie.

import { getStroke } from 'perfect-freehand';

interface LaserPoint {
  x: number;
  y: number;
  time: number;
}

/** Ohne Halten: So lange leuchtet die Spur nach */
const TRAIL_MS = 900;
/** Nach dem Absetzen verblasst alles in dieser Zeit */
const FADE_MS = 600;
/** Mit Halten: Grenze, damit eine sehr lange Markierung das iPad nicht ausbremst */
const MAX_POINTS = 6000;
const COLOR = '255, 40, 40';
export type LaserSize = 'thin' | 'medium' | 'thick';
/**
 * Breite des leuchtenden Kerns in Seitenbreiten. Mittel entspricht der Spur vor v0.13.
 * perfect-freehand nimmt size als Halbmesser-Maß: Bei voller Stärke und thinning 0,7 wird der
 * Strich 1,7 × size breit. Deshalb wird unten durch 1,7 geteilt.
 */
const CORE: Record<LaserSize, number> = { thin: 0.003, medium: 0.0045, thick: 0.0065 };
const GLOW_FACTOR = 2.4;
const FULL_WIDTH = 1.7;
/** perfect-freehand rechnet in festen Einheiten, die Seite ist bei uns 1 breit */
const SCALE = 4000;

export interface LaserOptions {
  /** Die Spur bleibt, solange der Stift aufliegt, wie bei GoodNotes */
  hold(): boolean;
  size?(): LaserSize;
}

export class Laser {
  private points: LaserPoint[] = [];
  private latest: LaserPoint | null = null;
  private frame = 0;
  private releasedAt: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    /** Rechnet Seiteneinheiten in Pixel dieser Leinwand um */
    private applyPageTransform: (context: CanvasRenderingContext2D) => void,
    private options: LaserOptions = { hold: () => false },
  ) {}

  start(x: number, y: number): void {
    this.releasedAt = null;
    this.latest = { x, y, time: performance.now() };
    this.points = [this.latest];
    this.schedule();
  }

  move(x: number, y: number): void {
    this.latest = { x, y, time: performance.now() };
    this.points.push(this.latest);
    if (this.points.length > MAX_POINTS) this.points.shift();
    this.schedule();
  }

  end(): void {
    this.releasedAt = performance.now();
    this.schedule();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.points = [];
    this.latest = null;
    this.releasedAt = null;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    this.frame = 0;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const now = performance.now();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyPageTransform(context);

    const holding = this.options.hold();
    const fade = this.releasedAt === null ? 1 : Math.max(0, 1 - (now - this.releasedAt) / FADE_MS);
    if (!holding || this.releasedAt !== null) {
      // Ohne Halten verschwindet die Spur hinter dem Punkt; mit Halten erst nach dem Absetzen, dann als Ganzes
      if (!holding) this.points = this.points.filter((point) => now - point.time < TRAIL_MS);
      else if (fade <= 0) this.points = [];
    }

    const core = CORE[this.options.size?.() ?? 'medium'] ?? CORE.medium;
    if (this.points.length > 1 && fade > 0) {
      const trail = laserTrail(this.points, now, holding);
      context.fillStyle = `rgba(${COLOR}, ${0.18 * fade})`;
      context.fill(outlinePath(trail, (core * GLOW_FACTOR) / FULL_WIDTH));
      context.fillStyle = `rgba(${COLOR}, ${0.75 * fade})`;
      context.fill(outlinePath(trail, core / FULL_WIDTH));
    }

    if (this.latest && fade > 0) {
      // Der Punkt bleibt etwas größer als die Spur, damit man den Kopf findet
      const head = core * 1.4;
      context.fillStyle = `rgba(${COLOR}, ${0.28 * fade})`;
      context.beginPath();
      context.arc(this.latest.x, this.latest.y, head * 2.2, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = `rgba(${COLOR}, ${fade})`;
      context.beginPath();
      context.arc(this.latest.x, this.latest.y, head, 0, Math.PI * 2);
      context.fill();
    }

    const stillVisible = this.releasedAt === null || fade > 0 || (!holding && this.points.length > 0);
    if (stillVisible) this.schedule();
  }
}

/**
 * Punkte mit Stärke für den Umriss: Ohne Halten wird die Spur zum Ende hin dünner wie ein Schweif,
 * mit Halten bleibt sie gleich breit und läuft nur am Anfang kurz aus.
 */
export function laserTrail(points: LaserPoint[], now: number, holding: boolean): number[][] {
  return points.map((point, index) => {
    const strength = holding ? Math.min(1, 0.35 + index / 12) : Math.max(0.05, 1 - (now - point.time) / TRAIL_MS);
    return [point.x * SCALE, point.y * SCALE, strength];
  });
}

function outlinePath(trail: number[][], width: number): Path2D {
  const outline = getStroke(trail, {
    size: width * SCALE,
    thinning: 0.7,
    smoothing: 0.5,
    streamline: 0.2,
    simulatePressure: false,
    last: true,
  });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0] / SCALE, outline[0][1] / SCALE);
  for (let i = 1; i < outline.length; i++) {
    const [x, y] = outline[i];
    const [nx, ny] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x / SCALE, y / SCALE, (x + nx) / 2 / SCALE, (y + ny) / 2 / SCALE);
  }
  path.closePath();
  return path;
}
