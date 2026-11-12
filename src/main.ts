import {
  FileView,
  FuzzySuggestModal,
  loadPdfJs,
  Notice,
  parseLinktext,
  Plugin,
  setIcon,
  TFile,
  type App,
  type Editor,
  type MarkdownPostProcessorContext,
} from 'obsidian';
import { exportWithInk } from './exportPdf';
import { digitalPdfNames, formatDwell, groupSlug, insertReflection, parsePlan, type PlanRow } from './presenter/lessonData';
import { reflectionWanted, ReflectionModal } from './reflectionModal';
import { findPdfs, looksLikePdfPath } from './pdfLookup';
import { hashBytes } from './presenter/inkFile';
import { InkSaver, InkStore } from './presenter/inkStore';
import { serializeSession } from './presenter/inkFile';
import { loadGroup, loadPosition, saveGroup, savePosition } from './presenter/session';
import { Presenter } from './presenter/Presenter';
import type { PresentationSession } from './presenter/session';
import type { PdfDocument } from './presenter/types';

const PDF_VIEW_TYPE = 'pdf';
const ICON = 'presentation';
/** Die Tinte liegt im Plugin-Ordner: Sie reist per iCloud mit, taucht aber nicht zwischen dem Material auf. */
const INK_FOLDER = 'tinte';
const NOTICE_MS = 8000;

/** Sitzung, deren letzter Schreibversuch fehlschlug. Sie bleibt im Speicher, bis es klappt. */
interface UnsavedSession {
  contentHash: string;
  session: PresentationSession;
}

/** Was aus dem Stundenentwurf kommt, aus dem die Präsentation gestartet wurde */
interface Lesson {
  notePath: string;
  plan: PlanRow[];
  files: TFile[];
  suggestions: string[];
}

interface PresentOptions {
  notePath?: string;
  group?: string;
  /** Die laufende Präsentation bleibt sichtbar, bis die neue steht. So blitzt der Vault nie auf. */
  switching?: boolean;
}

class PdfSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onPick: (file: TFile) => void, private candidates?: TFile[]) {
    super(app);
    this.setPlaceholder('PDF zum Präsentieren suchen …');
    this.emptyStateText = 'Kein passendes PDF gefunden.';
  }

  getItems(): TFile[] {
    const files = this.candidates ?? this.app.vault.getFiles().filter((file) => file.extension === 'pdf');
    return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}

const REFLECTION_AFTER_MS = 10 * 60_000;

export default class PdfPraesentationPlugin extends Plugin {
  private store!: InkStore;
  private unsaved = new Map<string, UnsavedSession>();
  private presenter: Presenter | null = null;
  private opening = false;
  private lesson: Lesson | null = null;
  private planStartedAt: number | null = null;
  private dwell = new Map<string, number>();
  private dwellLabel: string | null = null;
  private dwellSince = 0;
  private lastDwell = '';
  /** Wie lange die letzte Präsentation insgesamt lief */
  private lastDwellMs = 0;
  /** Das Speichern der gerade geschlossenen Präsentation */
  private closing: Promise<void> = Promise.resolve();
  private viewsWithAction = new WeakSet<FileView>();

  async onload(): Promise<void> {
    this.store = new InkStore(this.app.vault.adapter, `${this.manifest.dir}/${INK_FOLDER}`);

    this.addCommand({
      id: 'aktuelles-pdf',
      name: 'Aktuelles PDF präsentieren',
      icon: ICON,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== 'pdf') return false;
        if (!checking) void this.present(file);
        return true;
      },
    });

    this.addCommand({
      id: 'pdf-auswaehlen',
      name: 'PDF auswählen und präsentieren',
      icon: ICON,
      callback: () => this.pickAndPresent(),
    });

    this.addCommand({
      id: 'verweildauer-einfuegen',
      name: 'Verweildauer der letzten Präsentation einfügen',
      icon: 'clock',
      editorCallback: (editor: Editor) => {
        if (this.lastDwell) editor.replaceSelection(this.lastDwell);
        else new Notice('Noch keine Folie stand länger als eine Minute.');
      },
    });

    this.addRibbonIcon(ICON, 'PDF präsentieren', () => {
      const file = this.app.workspace.getActiveFile();
      if (file?.extension === 'pdf') void this.present(file);
      else this.pickAndPresent();
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'pdf') return;
        menu.addItem((item) =>
          item
            .setTitle('Präsentieren')
            .setIcon(ICON)
            .onClick(() => void this.present(file)),
        );
      }),
    );

    // Umbenennen und Verschieben in Obsidian lässt sich sicher erkennen. Die Tinte zieht gleich mit um.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== 'pdf' || this.presenter) return;
        void this.store.movePdf(oldPath, file.path).catch((error) => console.error('[pdf-praesentation]', error));
      }),
    );

    this.registerEvent(this.app.workspace.on('layout-change', () => this.addPdfViewActions()));
    this.app.workspace.onLayoutReady(() => this.addPdfViewActions());

    this.registerMarkdownPostProcessor((element, context) => this.addLinkButtons(element, context));

    // obsidian://pdf-praesentieren?file=Pfad/zur/Datei.pdf&page=3
    this.registerObsidianProtocolHandler('pdf-praesentieren', (parameters) => {
      const file = this.app.vault.getAbstractFileByPath(parameters.file ?? '');
      if (file instanceof TFile && file.extension === 'pdf') {
        void this.present(file, Number(parameters.page) || undefined);
      } else {
        new Notice(`PDF nicht gefunden: ${parameters.file ?? '(kein Pfad)'}`);
      }
    });
  }

  onunload(): void {
    this.presenter?.close();
  }

  private pickAndPresent(): void {
    new PdfSuggestModal(this.app, (file) => void this.present(file)).open();
  }

  /** Knopf in der Kopfzeile der PDF-Ansicht, damit das Starten auf dem iPad ein Fingertipp bleibt. */
  private addPdfViewActions(): void {
    this.app.workspace.getLeavesOfType(PDF_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (!(view instanceof FileView) || this.viewsWithAction.has(view)) return;
      this.viewsWithAction.add(view);
      view.addAction(ICON, 'Präsentieren', () => {
        if (view.file) void this.present(view.file);
      });
    });
  }

  /** Kleiner Startknopf hinter PDF-Links und PDF-Pfaden in der Leseansicht, etwa in Stundenentwürfen. */
  private addLinkButtons(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    element.querySelectorAll<HTMLAnchorElement>('a.internal-link').forEach((link) => {
      const target = link.getAttribute('data-href') ?? link.getAttribute('href');
      if (!target) return;
      const { path, subpath } = parseLinktext(target);
      const file = this.app.metadataCache.getFirstLinkpathDest(path, context.sourcePath);
      if (file?.extension !== 'pdf') return;
      const page = Number(/page=(\d+)/.exec(subpath)?.[1]) || undefined;
      link.after(this.startButton(`${file.basename} präsentieren`, () => void this.present(file, page, { notePath: context.sourcePath })));
    });

    // Die meisten Entwürfe nennen PDFs als Pfad in Backticks, nicht als Link.
    const codes = Array.from(element.querySelectorAll('code')).filter(
      (code) => !code.closest('pre') && looksLikePdfPath(code.textContent ?? ''),
    );
    if (!codes.length) return;
    const pdfs = this.app.vault.getFiles().filter((file) => file.extension === 'pdf');
    const paths = pdfs.map((file) => file.path);
    for (const code of codes) {
      const matches = findPdfs(code.textContent ?? '', paths);
      if (!matches.length) continue;
      const files = pdfs.filter((file) => matches.includes(file.path));
      code.after(
        this.startButton(`${code.textContent} präsentieren`, () => {
          const options = { notePath: context.sourcePath };
          if (files.length === 1) void this.present(files[0], undefined, options);
          else new PdfSuggestModal(this.app, (file) => void this.present(file, undefined, options), files).open();
        }),
      );
    }
  }

  private startButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'pp-link-button';
    button.setAttribute('aria-label', label);
    setIcon(button, ICON);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return button;
  }

  /** Liest Plan, Mappe und Kurse aus dem Entwurf. Fehlt etwas, bleibt das jeweilige Feld einfach weg. */
  private async loadLesson(notePath: string): Promise<Lesson | null> {
    const note = this.app.vault.getAbstractFileByPath(notePath);
    if (!(note instanceof TFile)) return null;
    const text = await this.app.vault.cachedRead(note);
    const pdfs = this.app.vault.getFiles().filter((entry) => entry.extension === 'pdf');
    const paths = pdfs.map((entry) => entry.path);
    const files: TFile[] = [];
    for (const name of digitalPdfNames(text)) {
      const matches = findPdfs(name, paths);
      const match = matches.length === 1 ? pdfs.find((entry) => entry.path === matches[0]) : undefined;
      if (match && !files.includes(match)) files.push(match);
    }
    const kurs: unknown = this.app.metadataCache.getFileCache(note)?.frontmatter?.kurs;
    const suggestions = Array.isArray(kurs) && kurs.length > 1 ? kurs.map((entry) => groupSlug(String(entry))).filter(Boolean) : [];
    return { notePath, plan: parsePlan(text), files, suggestions };
  }

  private markDwell(label: string | null): void {
    const now = Date.now();
    if (this.dwellLabel) this.dwell.set(this.dwellLabel, (this.dwell.get(this.dwellLabel) ?? 0) + now - this.dwellSince);
    this.dwellLabel = label;
    this.dwellSince = now;
  }

  private finishDwell(): void {
    this.markDwell(null);
    this.lastDwell = formatDwell([...this.dwell].map(([key, ms]) => ({ label: key, ms })));
    this.lastDwellMs = [...this.dwell.values()].reduce((sum, ms) => sum + ms, 0);
  }

  /**
   * Nach einer Präsentation aus einem Stundenentwurf, die mindestens zehn Minuten lief: drei Felder
   * für die Reflexion. Kurzes Zeigen oder Probieren am Schreibtisch fragt nicht.
   */
  private askReflection(): void {
    const lesson = this.lesson;
    if (!lesson || this.lastDwellMs < REFLECTION_AFTER_MS || !reflectionWanted()) return;
    const note = this.app.vault.getAbstractFileByPath(lesson.notePath);
    if (!(note instanceof TFile)) return;
    const dwell = this.lastDwell;
    new ReflectionModal(this.app, note.basename, dwell, (entries, withDwell) => {
      void this.app.vault
        .process(note, (text) => insertReflection(text, entries, withDwell ? dwell : ''))
        .then(() => new Notice(`Reflexion steht in „${note.basename}“.`))
        .catch(() => new Notice('Die Reflexion ließ sich nicht speichern. Bitte von Hand eintragen.', NOTICE_MS));
    }).open();
  }

  private async exportPdf(file: TFile, session: PresentationSession): Promise<void> {
    const notice = new Notice('PDF mit Tinte wird erstellt …', 0);
    try {
      const bytes = await exportWithInk(await this.app.vault.readBinary(file), session);
      const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
      let path = `${folder}${file.basename} mit Tinte.pdf`;
      for (let number = 2; this.app.vault.getAbstractFileByPath(path); number++) path = `${folder}${file.basename} mit Tinte ${number}.pdf`;
      await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      new Notice(`Gesichert: ${path}`, NOTICE_MS);
    } catch (error) {
      console.error('[pdf-praesentation]', error);
      new Notice('Das PDF mit Tinte ließ sich nicht erstellen.', NOTICE_MS);
    } finally {
      notice.hide();
    }
  }

  private async present(file: TFile, page?: number, options: PresentOptions = {}): Promise<void> {
    if (this.opening || (this.presenter && !options.switching)) return;
    this.opening = true;
    const notice = new Notice(`${file.basename} wird geladen …`, 0);
    let doc: PdfDocument | null = null;
    try {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await this.app.vault.readBinary(file));
      // Vor dem Öffnen rechnen: pdf.js übernimmt die Bytes und lässt sie danach nicht mehr lesen.
      const contentHash = hashBytes(bytes);
      doc = (await pdfjs.getDocument({ data: bytes }).promise) as PdfDocument;
      const openedDoc = doc;

      // Sofort wieder geöffnet: erst fertig speichern, sonst lädt die neue Sitzung den alten Stand.
      await this.closing;

      const group = options.group ?? loadGroup(file.path);
      const unsavedKey = `${file.path}#${group}`;

      // Ungespeicherte Tinte aus einer anderen Fassung des PDFs wird Nebendatei und gleich zusammengeführt.
      const stale = this.unsaved.get(unsavedKey);
      if (stale && stale.contentHash !== contentHash) {
        const text = serializeSession(stale.session, file.path);
        if (text !== null) await this.store.write(this.store.sideFileName(file.path, contentHash, group), text);
        this.unsaved.delete(unsavedKey);
      }

      const loaded = await this.store.load(
        file.path,
        contentHash,
        openedDoc.numPages,
        (path) => this.app.vault.getAbstractFileByPath(path) instanceof TFile,
        group,
      );
      const waiting = this.unsaved.get(unsavedKey);
      if (waiting) loaded.session = waiting.session;
      const session = loaded.session;
      const position = loadPosition(file.path) ?? loaded.storedCurrent;
      if (page) session.current = session.indexOfPage(page);
      else if (position !== null) session.current = Math.max(0, Math.min(session.slides.length - 1, position));
      loaded.notices.forEach((message) => new Notice(message, NOTICE_MS));

      const saver = InkSaver.fromLoad(
        this.store,
        file.path,
        contentHash,
        loaded,
        (error) => {
          console.error('[pdf-praesentation]', error);
          new Notice('Die Tinte ließ sich nicht speichern. Sie bleibt erhalten, bis Obsidian beendet wird.', NOTICE_MS);
        },
        () => new Notice('Ein anderes Gerät hat diese Tinte ebenfalls geändert. Beide Fassungen bleiben erhalten und werden beim nächsten Öffnen zusammengeführt.', NOTICE_MS),
        group,
      );

      if (waiting) saver.markUnsaved();

      const notePath = options.notePath ?? (options.switching ? this.lesson?.notePath : undefined);
      if (!options.switching) {
        const before = this.lesson?.notePath;
        this.lesson = notePath ? await this.loadLesson(notePath) : null;
        if (this.lesson?.notePath !== before) this.planStartedAt = null;
        this.dwell = new Map();
      }
      const lesson = this.lesson;
      const files = lesson?.files.length && !lesson.files.includes(file) ? [...lesson.files, file] : lesson?.files ?? [];
      const prefix = files.length > 1 ? `${file.basename} ` : '';

      const previous = this.presenter;
      saveGroup(file.path, group);
      const groups = await this.store.groups(file.path);
      const presenter: Presenter = new Presenter({
        doc: openedDoc,
        session,
        timer: previous?.currentTimer,
        plan: lesson?.plan,
        planStartedAt: this.planStartedAt,
        more: {
          group,
          groups,
          suggestions: lesson?.suggestions ?? [],
          files: files.map((entry) => ({ path: entry.path, label: entry.basename, current: entry === file })),
          canExport: true,
        },
        onPlanChange: (startedAt) => (this.planStartedAt = startedAt),
        onSwitchGroup: (name) => {
          const slug = groupSlug(name);
          if (slug !== group) void this.present(file, undefined, { switching: true, group: slug });
        },
        onSwitchFile: (path) => {
          const next = files.find((entry) => entry.path === path);
          if (next && next !== file) void this.present(next, undefined, { switching: true });
        },
        onExportPdf: () => void this.exportPdf(file, session),
        onChange: () => saver.schedule(),
        onPageChange: (index) => {
          savePosition(file.path, index);
          const slide = session.slides[index];
          this.markDwell(slide.pdfPage === null ? `${prefix}leere Seite` : `${prefix}S. ${slide.pdfPage}`);
        },
        onHidden: () => void saver.flush(),
        onClose: () => {
          if (this.presenter === presenter) {
            this.presenter = null;
            this.finishDwell();
            this.askReflection();
          }
          void openedDoc.destroy();
          const saved = saver.flush().then(() => {
            // Nur nach echtem Schreiben darf die Sitzung aus dem Speicher: Bei nicht lesbarer Datei wird nichts geschrieben.
            if (saver.failed || (loaded.readOnly && session.hasContent())) this.unsaved.set(unsavedKey, { contentHash, session });
            else this.unsaved.delete(unsavedKey);
          });
          this.closing = Promise.all([this.closing, saved]).then(() => undefined);
        },
      });
      this.presenter = presenter;
      previous?.close();
    } catch (error) {
      void doc?.destroy();
      console.error('[pdf-praesentation]', error);
      new Notice(`${file.basename} ließ sich nicht öffnen. Ist es passwortgeschützt oder noch nicht aus iCloud geladen?`);
    } finally {
      this.opening = false;
      notice.hide();
    }
  }
}
