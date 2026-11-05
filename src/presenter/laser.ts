// Laserpointer: heller Punkt mit kurzem Nachleuchten, nichts bleibt auf der Seite.

interface LaserPoint {
  x: number;
  y: number;
  time: number;
}

const TRAIL_MS = 650;
const FADE_MS = 350;
const COLOR = '255, 40, 40';

export class Laser {
  private points: LaserPoint[] = [];
  private latest: LaserPoint | null = null;
  private frame = 0;
  private releasedAt: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    /** Rechnet Seiteneinheiten in Pixel dieser Leinwand um */
    private applyPageTransform: (context: CanvasRenderingContext2D) => void,
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

    this.points = this.points.filter((point) => now - point.time < TRAIL_MS);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (let i = 1; i < this.points.length; i++) {
      const age = (now - this.points[i].time) / TRAIL_MS;
      context.strokeStyle = `rgba(${COLOR}, ${0.65 * (1 - age)})`;
      context.lineWidth = 0.006 * (1 - 0.5 * age);
      context.beginPath();
      context.moveTo(this.points[i - 1].x, this.points[i - 1].y);
      context.lineTo(this.points[i].x, this.points[i].y);
      context.stroke();
    }

    const fade = this.releasedAt === null ? 1 : Math.max(0, 1 - (now - this.releasedAt) / FADE_MS);
    if (this.latest && fade > 0) {
      context.fillStyle = `rgba(${COLOR}, ${0.28 * fade})`;
      context.beginPath();
      context.arc(this.latest.x, this.latest.y, 0.014, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = `rgba(${COLOR}, ${fade})`;
      context.beginPath();
      context.arc(this.latest.x, this.latest.y, 0.0065, 0, Math.PI * 2);
      context.fill();
    }

    const stillVisible = this.releasedAt === null || fade > 0 || this.points.length > 0;
    if (stillVisible) this.schedule();
  }
}
