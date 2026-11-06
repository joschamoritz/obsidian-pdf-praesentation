// Countdown über der Folie. Gerechnet wird mit der Uhrzeit statt mit Takten: Geht das iPad kurz
// in den Hintergrund oder stockt der Bildaufbau, stimmt die Restzeit trotzdem.

export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';
export type TimerSize = 'small' | 'medium' | 'large' | 'huge';
export type TimerPhase = 'normal' | 'warning' | 'finished';

const MINUTE = 60_000;
const MIN_DURATION = MINUTE;
const MAX_DURATION = 180 * MINUTE;
/** Warnfarbe in der letzten Minute, bei kurzen Timern im letzten Viertel */
const WARNING_MS = MINUTE;
const WARNING_SHARE = 0.25;

export class CountdownTimer {
  private durationMs: number;
  private leftMs: number;
  private endAt: number | null = null;
  private paused = false;

  constructor(minutes: number, private now: () => number = () => Date.now()) {
    this.durationMs = clampDuration(minutes * MINUTE);
    this.leftMs = this.durationMs;
  }

  get status(): TimerStatus {
    if (this.endAt !== null) return this.remaining > 0 ? 'running' : 'finished';
    return this.paused ? 'paused' : 'idle';
  }

  get remaining(): number {
    return this.endAt !== null ? Math.max(0, this.endAt - this.now()) : this.leftMs;
  }

  /** Wie lange der Timer schon abgelaufen ist */
  get overtime(): number {
    return this.endAt !== null ? Math.max(0, this.now() - this.endAt) : 0;
  }

  get minutes(): number {
    return Math.round(this.durationMs / MINUTE);
  }

  get phase(): TimerPhase {
    const left = this.remaining;
    if (left <= 0) return 'finished';
    return left <= Math.min(WARNING_MS, this.durationMs * WARNING_SHARE) ? 'warning' : 'normal';
  }

  /** Neue Dauer. Ein laufender Timer fängt damit von vorn an, aber angehalten. */
  setMinutes(minutes: number): void {
    this.durationMs = clampDuration(minutes * MINUTE);
    this.reset();
  }

  start(): void {
    if (this.status === 'finished') this.leftMs = this.durationMs;
    if (this.endAt !== null && this.status === 'running') return;
    this.endAt = this.now() + this.leftMs;
    this.paused = false;
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.leftMs = this.remaining;
    this.endAt = null;
    this.paused = true;
  }

  toggle(): void {
    if (this.status === 'running') this.pause();
    else this.start();
  }

  reset(): void {
    this.endAt = null;
    this.paused = false;
    this.leftMs = this.durationMs;
  }

  /** Eine Minute mehr oder weniger, auch während er läuft: Im Unterricht braucht es oft noch etwas Zeit. */
  adjust(minutes: number): void {
    const delta = minutes * MINUTE;
    const status = this.status;
    if (status === 'idle') {
      this.durationMs = clampDuration(this.durationMs + delta);
      this.leftMs = this.durationMs;
    } else if (status === 'running' || status === 'finished') {
      const left = Math.max(0, this.remaining + delta);
      this.endAt = this.now() + left;
      this.durationMs = Math.max(this.durationMs, left);
    } else {
      this.leftMs = Math.max(1000, this.leftMs + delta);
      this.durationMs = Math.max(this.durationMs, this.leftMs);
    }
  }
}

function clampDuration(ms: number): number {
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, ms));
}

/** Aufgerundet: Bei „0:01“ ist noch Zeit, „0:00“ heißt wirklich vorbei. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Zeit nach dem Ablauf. Eine Information und kein Effekt: Du entscheidest, ob sie reicht. */
export function formatOvertime(ms: number): string {
  return `+${formatRemaining(Math.floor(ms / 1000) * 1000)}`;
}

export interface TimerWidgetOptions {
  /** Läuft beim Wechsel in ein anderes PDF der Stunde einfach weiter */
  timer?: CountdownTimer;
  minutes: number;
  size: TimerSize;
  x: number;
  y: number;
  /** Während eines Strichs reagiert die Anzeige nicht, sonst schöbe die aufliegende Hand sie weg. */
  isInking(): boolean;
  onStatusChange(): void;
  onMoved(x: number, y: number): void;
}

const TICK_MS = 250;
const DRAG_SLOP_PX = 6;

/** Die sichtbare Anzeige. Ein Tipp hält an und setzt fort, Ziehen verschiebt sie. */
export class TimerWidget {
  readonly timer: CountdownTimer;
  private element: HTMLElement;
  private interval = 0;
  private preview = false;
  private x: number;
  private y: number;
  private lastStatus: TimerStatus = 'idle';
  private drag: { pointerId: number; startX: number; startY: number; moved: boolean } | null = null;

  constructor(private root: HTMLElement, private options: TimerWidgetOptions) {
    this.timer = options.timer ?? new CountdownTimer(options.minutes);
    this.x = options.x;
    this.y = options.y;
    this.element = document.createElement('button');
    this.element.className = 'pp-timer';
    this.element.setAttribute('aria-live', 'off');
    this.element.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.element.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.element.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.element.addEventListener('pointercancel', () => (this.drag = null));
    root.appendChild(this.element);
    this.setSize(options.size);
    this.render();
  }

  setSize(size: TimerSize): void {
    this.element.dataset.size = size;
    this.applyPosition();
  }

  /** Beim Einstellen zeigt die Anzeige schon Größe und Lage, bevor sie läuft. */
  setPreview(preview: boolean): void {
    this.preview = preview;
    this.render();
  }

  /** Nach jeder Änderung von außen, damit die Anzeige sofort stimmt. */
  render(): void {
    const status = this.timer.status;
    const visible = status !== 'idle' || this.preview;
    this.element.classList.toggle('is-visible', visible);
    this.element.classList.toggle('is-paused', status === 'paused');
    this.element.dataset.phase = this.timer.phase;
    this.element.textContent = status === 'finished' ? formatOvertime(this.timer.overtime) : formatRemaining(this.timer.remaining);
    const label = status === 'running' ? 'Timer anhalten' : status === 'finished' ? 'Timer ausblenden' : 'Timer fortsetzen';
    this.element.setAttribute('aria-label', label);
    this.applyPosition();
    const ticking = status === 'running' || status === 'finished';
    if (ticking && !this.interval) {
      this.interval = window.setInterval(() => this.render(), TICK_MS);
    } else if (!ticking && this.interval) {
      window.clearInterval(this.interval);
      this.interval = 0;
    }
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.options.onStatusChange();
    }
  }

  private onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    if (this.options.isInking()) return;
    try {
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Ein schon beendeter Zeiger lässt sich nicht mehr einfangen.
    }
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_SLOP_PX) return;
    drag.moved = true;
    const rect = this.root.getBoundingClientRect();
    this.x = (event.clientX - rect.left) / rect.width;
    this.y = (event.clientY - rect.top) / rect.height;
    this.applyPosition();
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      this.options.onMoved(this.x, this.y);
      return;
    }
    if (this.timer.status === 'finished') this.timer.reset();
    else if (this.timer.status !== 'idle') this.timer.toggle();
    this.render();
  }

  /** Die Anzeige bleibt ganz im Bild, auch bei großer Schrift und nach dem Drehen. */
  private applyPosition(): void {
    const root = this.root.getBoundingClientRect();
    const own = this.element.getBoundingClientRect();
    if (!root.width || !root.height) return;
    const halfWidth = Math.min(0.5, own.width / 2 / root.width);
    const halfHeight = Math.min(0.5, own.height / 2 / root.height);
    this.x = Math.max(halfWidth, Math.min(1 - halfWidth, this.x));
    this.y = Math.max(halfHeight, Math.min(1 - halfHeight, this.y));
    this.element.style.left = `${this.x * 100}%`;
    this.element.style.top = `${this.y * 100}%`;
  }

  destroy(): void {
    window.clearInterval(this.interval);
    this.interval = 0;
    this.element.remove();
  }
}
