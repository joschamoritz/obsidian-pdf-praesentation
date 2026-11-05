// Ordnet Zeiger-Ereignisse einer Bedeutung zu: Stift und Maus zeichnen, der Finger
// blättert und zoomt. Ohne DOM-Zugriff, damit sich die Regeln testen lassen.

export interface PointerInput {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
  timeStamp: number;
}

export interface GestureHandlers<E extends PointerInput> {
  inkStart(event: E): void;
  inkMove(event: E): void;
  inkEnd(event: E | null): void;
  inkCancel(): void;
  swipe(direction: 1 | -1): void;
  tap(x: number, y: number): void;
  pan(dx: number, dy: number): void;
  pinch(cx: number, cy: number, factor: number, dx: number, dy: number): void;
  gestureEnd(): void;
  isZoomed(): boolean;
  fingerDraws(): boolean;
}

interface TrackedTouch {
  x: number;
  y: number;
}

type Mode = 'idle' | 'ink' | 'one-finger' | 'pinch' | 'settling';

/** So lange nach dem Stift gelten Berührungen als aufliegende Hand. */
export const PALM_WINDOW_MS = 500;
const SLOP_PX = 8;
const SWIPE_MIN_PX = 50;
const SWIPE_MAX_MS = 900;
const TAP_MAX_MS = 350;
/** Zweiter Finger binnen dieser Zeit: Es war nie ein Strich gemeint. */
const FINGER_INK_GRACE_MS = 250;

export class GestureRouter<E extends PointerInput> {
  private mode: Mode = 'idle';
  private touches = new Map<number, TrackedTouch>();
  private ignored = new Set<number>();
  private inkPointer: number | null = null;
  private inkPointerType = '';
  private inkStartedAt = 0;
  private lastPenTime = -Infinity;
  private start = { x: 0, y: 0, time: 0 };
  private moved = false;
  private pinchDistance = 0;
  private pinchCenter = { x: 0, y: 0 };

  constructor(private handlers: GestureHandlers<E>) {}

  down(event: E): void {
    if (event.pointerType === 'pen') return this.penDown(event);
    if (event.pointerType === 'touch') return this.touchDown(event);
    if (event.button === 0 && this.mode === 'idle') this.startInk(event);
  }

  move(event: E): void {
    if (event.pointerType === 'pen') this.lastPenTime = event.timeStamp;
    if (this.mode === 'ink') {
      if (event.pointerId === this.inkPointer) this.handlers.inkMove(event);
      return;
    }
    const touch = this.touches.get(event.pointerId);
    if (!touch) return;
    if (this.mode === 'one-finger') {
      this.oneFingerMove(event, touch);
    } else if (this.mode === 'pinch') {
      touch.x = event.clientX;
      touch.y = event.clientY;
      this.pinchMove();
    } else {
      touch.x = event.clientX;
      touch.y = event.clientY;
    }
  }

  up(event: E): void {
    this.finish(event, false);
  }

  cancel(event: E): void {
    this.finish(event, true);
  }

  private penDown(event: E): void {
    this.lastPenTime = event.timeStamp;
    // Die Hand liegt oft schon auf, bevor der Stift aufsetzt. Laufende
    // Fingergesten gelten dann als Handballen und lösen nichts mehr aus.
    if (this.mode === 'pinch' || (this.mode === 'one-finger' && this.moved)) this.handlers.gestureEnd();
    if (this.mode === 'ink' && this.inkPointerType === 'touch') this.handlers.inkCancel();
    // Fehlte das Absetzen des vorigen Strichs, bleibt er erhalten, statt vom neuen ersetzt zu werden.
    else if (this.mode === 'ink') this.handlers.inkEnd(null);
    for (const id of this.touches.keys()) this.ignored.add(id);
    this.touches.clear();
    this.mode = 'idle';
    this.startInk(event);
  }

  private touchDown(event: E): void {
    const penBusy = this.mode === 'ink' && this.inkPointerType === 'pen';
    const mouseBusy = this.mode === 'ink' && this.inkPointerType === 'mouse';
    if (penBusy || mouseBusy || event.timeStamp - this.lastPenTime < PALM_WINDOW_MS) {
      this.ignored.add(event.pointerId);
      return;
    }
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size === 1) {
      if (this.handlers.fingerDraws()) {
        this.startInk(event);
        return;
      }
      this.mode = 'one-finger';
      this.moved = false;
      this.start = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    } else if (this.touches.size === 2) {
      if (this.mode === 'ink') {
        if (event.timeStamp - this.inkStartedAt < FINGER_INK_GRACE_MS) this.handlers.inkCancel();
        else this.handlers.inkEnd(null);
        this.inkPointer = null;
      }
      this.startPinch();
    }
  }

  private startInk(event: E): void {
    this.mode = 'ink';
    this.inkPointer = event.pointerId;
    this.inkPointerType = event.pointerType;
    this.inkStartedAt = event.timeStamp;
    this.handlers.inkStart(event);
  }

  private oneFingerMove(event: E, touch: TrackedTouch): void {
    const distance = Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y);
    if (distance > SLOP_PX) this.moved = true;
    if (this.moved && this.handlers.isZoomed()) {
      this.handlers.pan(event.clientX - touch.x, event.clientY - touch.y);
    }
    touch.x = event.clientX;
    touch.y = event.clientY;
  }

  private twoTouches(): [TrackedTouch, TrackedTouch] {
    const [a, b] = this.touches.values();
    return [a, b];
  }

  private startPinch(): void {
    this.mode = 'pinch';
    const [a, b] = this.twoTouches();
    this.pinchDistance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private pinchMove(): void {
    const [a, b] = this.twoTouches();
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.handlers.pinch(
      center.x,
      center.y,
      distance / this.pinchDistance,
      center.x - this.pinchCenter.x,
      center.y - this.pinchCenter.y,
    );
    this.pinchDistance = distance;
    this.pinchCenter = center;
  }

  private finish(event: E, cancelled: boolean): void {
    if (event.pointerType === 'pen') this.lastPenTime = event.timeStamp;
    if (this.ignored.delete(event.pointerId)) return;

    if (this.mode === 'ink' && event.pointerId === this.inkPointer) {
      // Auch ein abgebrochener Strich bleibt stehen: iPadOS meldet "cancel"
      // gelegentlich mitten im Schreiben, und die Tinte soll dann nicht verschwinden.
      this.handlers.inkEnd(cancelled ? null : event);
      this.inkPointer = null;
      this.touches.delete(event.pointerId);
      this.mode = this.touches.size ? 'settling' : 'idle';
      return;
    }

    if (!this.touches.delete(event.pointerId)) return;

    if (this.mode === 'one-finger') {
      if (!cancelled) this.classifyOneFinger(event);
      else if (this.moved) this.handlers.gestureEnd();
      this.mode = 'idle';
    } else if (this.mode === 'pinch') {
      if (this.touches.size < 2) {
        this.handlers.gestureEnd();
        this.mode = this.touches.size ? 'settling' : 'idle';
      }
    } else if (this.mode === 'settling' && this.touches.size === 0) {
      this.mode = 'idle';
    }
  }

  private classifyOneFinger(event: E): void {
    const dx = event.clientX - this.start.x;
    const dy = event.clientY - this.start.y;
    const elapsed = event.timeStamp - this.start.time;
    if (this.handlers.isZoomed()) {
      if (this.moved) this.handlers.gestureEnd();
      else if (elapsed <= TAP_MAX_MS) this.handlers.tap(event.clientX, event.clientY);
      return;
    }
    if (!this.moved) {
      if (elapsed <= TAP_MAX_MS) this.handlers.tap(event.clientX, event.clientY);
      return;
    }
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > 1.5 * Math.abs(dy) && elapsed <= SWIPE_MAX_MS) {
      this.handlers.swipe(dx < 0 ? 1 : -1);
    }
  }
}
