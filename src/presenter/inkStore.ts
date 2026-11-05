// Liest und schreibt Tintendateien. Eine Datei heißt <Pfad-Hash>.<Inhalts-Hash>.json:
// Damit findet sich die Tinte per Dateiliste wieder, auch wenn das PDF außerhalb von
// Obsidian verschoben wurde, ohne dass dafür jede Datei gelesen werden muss.
import { emptyInkFile, hashText, InkFileError, parseInkFile, restoreSession, serializeSession } from './inkFile';
import { PresentationSession } from './session';

/** Der Teil von Obsidians DataAdapter, der hier gebraucht wird. */
export interface InkAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
}

export interface LoadResult {
  session: PresentationSession;
  /** Name der vorhandenen Datei, sonst null */
  fileName: string | null;
  /** Was die Lehrkraft erfahren sollte */
  notices: string[];
  /** Die Datei ließ sich nicht lesen. Dann darf sie auf keinen Fall überschrieben werden. */
  readOnly: boolean;
}

/** Strenges Muster: iCloud-Konfliktkopien wie "abc.def 2.json" sollen nicht als Tinte gelten. */
const FILE_NAME = /^([0-9a-z]+)\.([0-9a-z]+)\.json$/;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export class InkStore {
  constructor(private adapter: InkAdapter, private folder: string) {}

  fileName(pdfPath: string, contentHash: string): string {
    return `${hashText(pdfPath)}.${contentHash}.json`;
  }

  private fullPath(fileName: string): string {
    return `${this.folder}/${fileName}`;
  }

  private async fileNames(): Promise<string[]> {
    if (!(await this.adapter.exists(this.folder))) return [];
    const { files } = await this.adapter.list(this.folder);
    return files.map(baseName).filter((name) => FILE_NAME.test(name));
  }

  async load(
    pdfPath: string,
    contentHash: string,
    pageCount: number,
    pdfExists: (path: string) => boolean,
  ): Promise<LoadResult> {
    const fresh = (extra: Partial<LoadResult> = {}): LoadResult => ({
      session: new PresentationSession(pageCount),
      fileName: null,
      notices: [],
      readOnly: false,
      ...extra,
    });

    let names: string[];
    try {
      names = await this.fileNames();
    } catch {
      return fresh({ readOnly: true, notices: ['Die Tinte ließ sich nicht laden. Änderungen werden nicht gespeichert.'] });
    }
    const pathHash = hashText(pdfPath);
    const samePath = names.find((name) => name.startsWith(`${pathHash}.`));
    if (samePath) {
      const changed = !samePath.endsWith(`.${contentHash}.json`);
      return this.readFile(samePath, pageCount, fresh, changed);
    }

    // Gleicher Inhalt unter anderem Pfad: Liegt das alte PDF nicht mehr dort, wurde es verschoben.
    // Liegt es noch dort, ist dies eine Kopie, und die Tinte bleibt beim Original.
    for (const name of names.filter((entry) => entry.endsWith(`.${contentHash}.json`))) {
      try {
        const file = parseInkFile(await this.adapter.read(this.fullPath(name)));
        if (!pdfExists(file.path)) return this.readFile(name, pageCount, fresh, false);
      } catch {
        // Eine unlesbare fremde Datei geht dieses PDF nichts an.
      }
    }
    return fresh();
  }

  private async readFile(
    name: string,
    pageCount: number,
    fresh: (extra?: Partial<LoadResult>) => LoadResult,
    pdfChanged: boolean,
  ): Promise<LoadResult> {
    let text: string;
    try {
      text = await this.adapter.read(this.fullPath(name));
    } catch {
      // Auf dem iPad kann das heißen: iCloud hat die Datei noch nicht heruntergeladen.
      return fresh({
        fileName: name,
        readOnly: true,
        notices: ['Die Tinte ließ sich nicht laden, vielleicht fehlt sie noch aus iCloud. Änderungen werden nicht gespeichert.'],
      });
    }
    try {
      const { session, droppedInk } = restoreSession(parseInkFile(text), pageCount);
      const notices: string[] = [];
      if (pdfChanged) notices.push('Das PDF wurde seit dem Schreiben geändert. Die Tinte kann verrutscht sein.');
      if (droppedInk) notices.push('Das PDF hat weniger Seiten als vorher. Tinte auf den fehlenden Seiten fällt weg.');
      return { session, fileName: name, notices, readOnly: false };
    } catch (error) {
      if (error instanceof InkFileError && error.newerVersion) {
        return fresh({ fileName: name, readOnly: true, notices: [`${error.message} Änderungen werden nicht gespeichert.`] });
      }
      // Beschädigt: beiseitelegen statt überschreiben, falls sich noch etwas retten lässt.
      try {
        await this.adapter.rename(this.fullPath(name), this.fullPath(`${name}.defekt`));
      } catch {
        return fresh({ fileName: name, readOnly: true, notices: ['Die Tintendatei ist beschädigt. Änderungen werden nicht gespeichert.'] });
      }
      return fresh({ notices: ['Die Tintendatei war beschädigt und wurde beiseitegelegt. Es geht ohne Tinte weiter.'] });
    }
  }

  async write(fileName: string, text: string): Promise<void> {
    if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
    // Direkt schreiben: Umbenennen nach dem Schreiben erzeugt in iCloud Konfliktkopien.
    await this.adapter.write(this.fullPath(fileName), text);
  }

  async remove(fileName: string): Promise<void> {
    const path = this.fullPath(fileName);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }
}

/** Kurz nach dem letzten Strich schreiben: oft genug gegen Verlust, selten genug für iCloud. */
export const SAVE_DELAY_MS = 2000;

export class InkSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Stand der Datei. undefined heißt: Es ist noch etwas zu schreiben, egal wie die Sitzung aussieht. */
  private lastText: string | null | undefined;
  private currentName: string | null;
  private targetName: string;
  /** Der letzte Schreibversuch ist fehlgeschlagen. */
  failed = false;

  constructor(
    private store: InkStore,
    private pdfPath: string,
    contentHash: string,
    private session: PresentationSession,
    existingName: string | null,
    private readOnly: boolean,
    private onError: (error: unknown) => void,
  ) {
    this.currentName = existingName;
    this.targetName = store.fileName(pdfPath, contentHash);
    this.lastText = serializeSession(session, pdfPath);
  }

  /** Für eine Sitzung, deren Inhalt die Datei noch nicht kennt. */
  markUnsaved(): void {
    this.lastText = undefined;
  }

  schedule(): void {
    if (this.readOnly) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Schreibt sofort, was noch offen ist. Aufträge laufen nacheinander, nie gleichzeitig. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.readOnly) return this.queue;
    this.queue = this.queue.then(() => this.write());
    return this.queue;
  }

  private async write(): Promise<void> {
    const text = serializeSession(this.session, this.pdfPath);
    const moved = this.currentName !== null && this.currentName !== this.targetName;
    if (text === this.lastText && !moved) return;
    try {
      // Ohne Tinte und ohne vorhandene Datei gibt es nichts zu tun.
      const content = text ?? (this.currentName ? emptyInkFile(this.pdfPath) : null);
      if (content !== null) {
        await this.store.write(this.targetName, content);
        if (moved && this.currentName) await this.store.remove(this.currentName);
        this.currentName = this.targetName;
      }
      this.lastText = text;
      this.failed = false;
    } catch (error) {
      if (!this.failed) this.onError(error);
      this.failed = true;
    }
  }
}
