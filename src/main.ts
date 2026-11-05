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
import { hashBytes } from './presenter/inkFile';
import { InkSaver, InkStore } from './presenter/inkStore';
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
  constructor(app: App, private onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder('PDF zum Präsentieren suchen …');
    this.emptyStateText = 'Kein passendes PDF gefunden.';
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension === 'pdf')
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
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

  /** Kleiner Startknopf hinter PDF-Links in der Leseansicht, etwa in Stundenentwürfen. */
  private addLinkButtons(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    element.querySelectorAll<HTMLAnchorElement>('a.internal-link').forEach((link) => {
      const target = link.getAttribute('data-href') ?? link.getAttribute('href');
      if (!target) return;
      const { path, subpath } = parseLinktext(target);
      const file = this.app.metadataCache.getFirstLinkpathDest(path, context.sourcePath);
      if (file?.extension !== 'pdf') return;
      const page = Number(/page=(\d+)/.exec(subpath)?.[1]) || undefined;
      const button = document.createElement('button');
      button.className = 'pp-link-button';
      button.setAttribute('aria-label', `${file.basename} präsentieren`);
      setIcon(button, ICON);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.present(file, page);
      });
      link.after(button);
    });
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

      const loaded = await this.store.load(file.path, contentHash, openedDoc.numPages, (path) =>
        this.app.vault.getAbstractFileByPath(path) instanceof TFile,
      );
      const waiting = this.unsaved.get(file.path);
      const session = waiting?.contentHash === contentHash ? waiting.session : loaded.session;
      if (page) session.current = session.indexOfPage(page);
      loaded.notices.forEach((message) => new Notice(message, NOTICE_MS));

      const saver = new InkSaver(this.store, file.path, contentHash, session, loaded.fileName, loaded.readOnly, (error) => {
        console.error('[pdf-praesentation]', error);
        new Notice('Die Tinte ließ sich nicht speichern. Sie bleibt erhalten, bis Obsidian beendet wird.', NOTICE_MS);
      });

      if (waiting?.contentHash === contentHash) saver.markUnsaved();

      this.presenter = new Presenter({
        doc: openedDoc,
        session,
        onChange: () => saver.schedule(),
        onHidden: () => void saver.flush(),
        onClose: () => {
          this.presenter = null;
          void openedDoc.destroy();
          void saver.flush().then(() => {
            if (saver.failed) this.unsaved.set(file.path, { contentHash, session });
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
