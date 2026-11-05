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
  type MarkdownPostProcessorContext,
} from 'obsidian';
import { findPdfs, looksLikePdfPath } from './pdfLookup';
import { hashBytes } from './presenter/inkFile';
import { InkSaver, InkStore } from './presenter/inkStore';
import { serializeSession } from './presenter/inkFile';
import { loadPosition, savePosition } from './presenter/session';
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

export default class PdfPraesentationPlugin extends Plugin {
  private store!: InkStore;
  private unsaved = new Map<string, UnsavedSession>();
  private presenter: Presenter | null = null;
  private opening = false;
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
      link.after(this.startButton(`${file.basename} präsentieren`, () => void this.present(file, page)));
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
          if (files.length === 1) void this.present(files[0]);
          else new PdfSuggestModal(this.app, (file) => void this.present(file), files).open();
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

  private async present(file: TFile, page?: number): Promise<void> {
    if (this.presenter || this.opening) return;
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

      // Ungespeicherte Tinte aus einer anderen Fassung des PDFs wird Nebendatei und gleich zusammengeführt.
      const stale = this.unsaved.get(file.path);
      if (stale && stale.contentHash !== contentHash) {
        const text = serializeSession(stale.session, file.path);
        if (text !== null) await this.store.write(this.store.sideFileName(file.path, contentHash), text);
        this.unsaved.delete(file.path);
      }

      const loaded = await this.store.load(file.path, contentHash, openedDoc.numPages, (path) =>
        this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      );
      const waiting = this.unsaved.get(file.path);
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
      );

      if (waiting) saver.markUnsaved();

      this.presenter = new Presenter({
        doc: openedDoc,
        session,
        onChange: () => saver.schedule(),
        onPageChange: (index) => savePosition(file.path, index),
        onHidden: () => void saver.flush(),
        onClose: () => {
          this.presenter = null;
          void openedDoc.destroy();
          this.closing = saver.flush().then(() => {
            // Nur nach echtem Schreiben darf die Sitzung aus dem Speicher: Bei nicht lesbarer Datei wird nichts geschrieben.
            if (saver.failed || (loaded.readOnly && session.hasContent())) this.unsaved.set(file.path, { contentHash, session });
            else this.unsaved.delete(file.path);
          });
        },
      });
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
