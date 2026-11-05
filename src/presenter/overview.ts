import { icons } from './icons';
import { drawStroke, usePageUnits } from './ink';
import { PageRenderer, releaseCanvas } from './pageRenderer';
import type { PresentationSession, Slide } from './session';
import type { PdfRenderTask } from './types';

const THUMBNAIL_PIXELS = 360;
const CONFIRM_MS = 4000;
const HINT_MS = 4000;

export interface OverviewActions {
  select(index: number): void;
  removeBlank(index: number): void;
  clearAllInk(): void;
  /** Gibt false zurück, wenn es die letzte sichtbare Seite wäre. */
  toggleLock(index: number): boolean;
  close(): void;
}

/** Seitenübersicht. Vorschaubilder entstehen erst, wenn sie ins Bild kommen, und nacheinander. */
export class Overview {
  private root: HTMLElement;
  private observer: IntersectionObserver;
  private queue: { slide: Slide; holder: HTMLElement }[] = [];
  private task: PdfRenderTask | null = null;
  private running = false;
  private closed = false;
  private canvases: HTMLCanvasElement[] = [];
  private hint!: HTMLElement;
  private hintTimer = 0;
  private grid!: HTMLElement;

  constructor(
    parent: HTMLElement,
    private session: PresentationSession,
    private renderer: PageRenderer,
    private actions: OverviewActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'pp-overview';
    parent.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'pp-overview-header';
    const title = document.createElement('span');
    title.textContent = 'Seitenübersicht';
    const closeButton = document.createElement('button');
    closeButton.className = 'pp-button';
    closeButton.innerHTML = icons.close;
    closeButton.setAttribute('aria-label', 'Übersicht schließen');
    closeButton.addEventListener('click', () => actions.close());
    const headerActions = document.createElement('div');
    headerActions.className = 'pp-overview-actions';
    this.hint = document.createElement('span');
    this.hint.className = 'pp-overview-hint';
    headerActions.appendChild(this.hint);
    if (session.hasClearable()) headerActions.appendChild(this.clearAllButton());
    headerActions.appendChild(closeButton);
    header.append(title, headerActions);
    this.root.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'pp-overview-grid';
    this.grid = grid;
    this.root.appendChild(grid);

    this.observer = new IntersectionObserver((entries) => this.onVisible(entries), {
      root: this.root,
      rootMargin: '200px',
    });

    session.slides.forEach((slide, index) => grid.appendChild(this.tile(slide, index)));
    grid.children[session.current]?.scrollIntoView({ block: 'center' });
  }

  /** Für die nächste Lerngruppe. Zwei Tipps, weil damit auch die eingefügten Seiten verschwinden. */
  private clearAllButton(): HTMLElement {
    const label = 'Alle Tinte löschen';
    const button = document.createElement('button');
    button.className = 'pp-text-button';
    button.textContent = label;
    let timer = 0;
    button.addEventListener('click', () => {
      if (button.classList.contains('is-armed')) {
        window.clearTimeout(timer);
        this.actions.clearAllInk();
        return;
      }
      button.classList.add('is-armed');
      button.textContent = 'Wirklich alles löschen?';
      timer = window.setTimeout(() => {
        button.classList.remove('is-armed');
        button.textContent = label;
      }, CONFIRM_MS);
    });
    return button;
  }

  private tile(slide: Slide, index: number): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'pp-tile';
    tile.classList.toggle('is-current', index === this.session.current);
    tile.classList.toggle('is-locked', slide.locked);

    const button = document.createElement('button');
    button.className = 'pp-tile-page';
    button.setAttribute('aria-label', slide.locked ? `Seite ${index + 1} ist gesperrt` : `Zu Seite ${index + 1}`);
    button.style.aspectRatio = slide.aspect ? `1 / ${slide.aspect}` : '';
    button.addEventListener('click', () => {
      if (slide.locked) this.showHint('Gesperrt. Erst das Schloss antippen, dann lässt sich die Seite zeigen.');
      else this.actions.select(index);
    });
    if (slide.locked) button.innerHTML = icons.lock;
    tile.appendChild(button);

    const label = document.createElement('span');
    label.className = 'pp-tile-label';
    label.textContent = slide.pdfPage === null ? `${index + 1} · leer` : slide.locked ? `${index + 1} · gesperrt` : String(index + 1);
    tile.appendChild(label);

    if (slide.pdfPage === null) {
      const remove = document.createElement('button');
      remove.className = 'pp-tile-remove';
      remove.innerHTML = icons.close;
      remove.setAttribute('aria-label', 'Leere Seite entfernen');
      remove.addEventListener('click', () => {
        // Eine beschriebene Seite ist ein Tafelbild. Dafür braucht es zwei Tipps.
        if (slide.ink.strokes.length && !remove.classList.contains('is-armed')) {
          remove.classList.add('is-armed');
          this.showHint('Diese Seite ist beschrieben. Zum Entfernen noch einmal tippen.');
          window.setTimeout(() => remove.classList.remove('is-armed'), CONFIRM_MS);
          return;
        }
        this.actions.removeBlank(index);
      });
      tile.appendChild(remove);
    }

    if (slide.pdfPage !== null) {
      const lock = document.createElement('button');
      lock.className = 'pp-tile-lock';
      lock.innerHTML = slide.locked ? icons.lockOpen : icons.lock;
      lock.setAttribute('aria-label', slide.locked ? `Seite ${index + 1} freigeben` : `Seite ${index + 1} sperren`);
      lock.title = slide.locked ? 'Seite freigeben' : 'Seite sperren';
      lock.addEventListener('click', () => this.toggleLock(index, tile));
      tile.appendChild(lock);
    }

    // Eine gesperrte Seite bekommt gar kein Vorschaubild. Die Klasse sieht die Übersicht ja mit.
    if (!slide.locked) {
      (button as HTMLElement & { ppSlide?: Slide }).ppSlide = slide;
      this.observer.observe(button);
    }
    return tile;
  }

  private toggleLock(index: number, tile: HTMLElement): void {
    if (!this.actions.toggleLock(index)) {
      this.showHint('Mindestens eine Seite muss sichtbar bleiben.');
      return;
    }
    tile.replaceWith(this.tile(this.session.slides[index], index));
    // Wurde die gerade gezeigte Seite gesperrt, steht jetzt eine andere im Vordergrund.
    Array.from(this.grid.children).forEach((child, position) => {
      child.classList.toggle('is-current', position === this.session.current);
    });
  }

  private showHint(text: string): void {
    this.hint.textContent = text;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (this.hint.textContent = ''), HINT_MS);
  }

  private onVisible(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const holder = entry.target as HTMLElement & { ppSlide?: Slide };
      this.observer.unobserve(holder);
      if (holder.ppSlide) this.queue.push({ slide: holder.ppSlide, holder });
    }
    void this.work();
  }

  private async work(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (!this.closed && this.queue.length) {
      const { slide, holder } = this.queue.shift()!;
      try {
        // In der Zwischenzeit gesperrt: dann auch nicht mehr zeichnen.
        if (!slide.locked) await this.renderThumbnail(slide, holder);
      } catch {
        if (!this.closed) holder.classList.add('is-failed');
      }
    }
    this.running = false;
  }

  private async renderThumbnail(slide: Slide, holder: HTMLElement): Promise<void> {
    let canvas: HTMLCanvasElement;
    if (slide.pdfPage === null) {
      canvas = document.createElement('canvas');
      canvas.width = THUMBNAIL_PIXELS;
      canvas.height = Math.round(THUMBNAIL_PIXELS * (slide.aspect ?? 0.75));
      const blank = canvas.getContext('2d');
      if (blank) {
        blank.fillStyle = '#fff';
        blank.fillRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      const rendered = await this.renderer.thumbnail(slide.pdfPage, THUMBNAIL_PIXELS);
      canvas = rendered.canvas;
      this.task = rendered.task;
      await rendered.task.promise;
      this.task = null;
    }
    if (this.closed) {
      releaseCanvas(canvas);
      return;
    }
    this.paintInk(canvas, slide);
    holder.appendChild(canvas);
    this.canvases.push(canvas);
  }

  private paintInk(canvas: HTMLCanvasElement, slide: Slide): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    usePageUnits(context, canvas.width);
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = 0.55;
    for (const stroke of slide.ink.strokes) if (stroke.kind === 'marker') drawStroke(context, stroke);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    for (const stroke of slide.ink.strokes) if (stroke.kind === 'pen') drawStroke(context, stroke);
  }

  destroy(): void {
    this.closed = true;
    window.clearTimeout(this.hintTimer);
    this.observer.disconnect();
    this.queue = [];
    this.task?.cancel();
    this.canvases.forEach(releaseCanvas);
    this.root.remove();
  }
}
