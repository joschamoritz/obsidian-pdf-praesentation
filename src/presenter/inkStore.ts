// Liest und schreibt Tintendateien. Eine Datei heißt <Pfad-Hash>.<Inhalts-Hash>.json:
// Damit findet sich die Tinte per Dateiliste wieder, auch wenn das PDF außerhalb von
// Obsidian verschoben wurde, ohne dass dafür jede Datei gelesen werden muss.
//
// Grundsatz: Tinte aus dem Unterricht wird nie überschrieben, ohne dass ihr Stand bekannt ist.
// Was nicht zusammenpasst, landet in einer Nebendatei und wird beim nächsten Öffnen zusammengeführt.
import {
  emptyInkFile,
  hashText,
  InkFileError,
  mergeInkFile,
  parseInkFile,
  restoreSession,
  serializeSession,
  type InkFile,
} from './inkFile';
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
  stat(path: string): Promise<{ mtime: number } | null>;
}

export interface LoadResult {
  session: PresentationSession;
  /** Name der vorhandenen Datei, sonst null */
  fileName: string | null;
  /** Der Inhalt dieser Datei beim Laden. Vor jedem Schreiben wird dagegen geprüft. */
  diskText: string | null;
  /** Nebendateien, deren Tinte in die Sitzung übernommen wurde */
  mergedFiles: string[];
  /** Die Sitzung enthält Tinte, die noch nicht in der Hauptdatei steht. */
  dirty: boolean;
  /** Was die Lehrkraft erfahren sollte */
  notices: string[];
  /** Die Datei ließ sich nicht lesen. Dann darf sie auf keinen Fall überschrieben werden. */
  readOnly: boolean;
  /** Seite aus einer älteren Datei, die sie noch enthielt */
  storedCurrent: number | null;
}

/** Hauptdatei. Das strenge Muster hält iCloud-Konfliktkopien und Nebendateien davon fern. */
const MAIN_FILE = /^([0-9a-z]+)\.([0-9a-z]+)\.json$/;
/** Konfliktkopie von iCloud („abc.def 2.json“) oder eigene Nebendatei („abc.def konflikt-123.json“) */
const SIDE_FILE = /^([0-9a-z]+)\.([0-9a-z]+) (.+)\.json$/;

const UNREADABLE = 'Die Tinte ließ sich nicht laden, vielleicht fehlt sie noch aus iCloud. Änderungen werden nicht gespeichert.';

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Wie viele Pfadteile von hinten übereinstimmen. Dient dazu, ein verschobenes PDF zuzuordnen. */
function commonTail(a: string, b: string): number {
  const left = a.split('/').reverse();
  const right = b.split('/').reverse();
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count++;
  return count;
}

export class InkStore {
  private folderReady = false;

  constructor(private adapter: InkAdapter, private folder: string) {}

  fileName(pdfPath: string, contentHash: string): string {
    return `${hashText(pdfPath)}.${contentHash}.json`;
  }

  private fullPath(fileName: string): string {
    return `${this.folder}/${fileName}`;
  }

  private async allNames(): Promise<string[]> {
    if (!(await this.adapter.exists(this.folder))) return [];
    const { files } = await this.adapter.list(this.folder);
    return files.map(baseName);
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
      diskText: null,
      mergedFiles: [],
      dirty: false,
      notices: [],
      readOnly: false,
      storedCurrent: null,
      ...extra,
    });

    let names: string[];
    try {
      names = await this.allNames();
    } catch {
      return fresh({ readOnly: true, notices: [UNREADABLE] });
    }
    const pathHash = hashText(pdfPath);
    const mains = names.filter((name) => MAIN_FILE.test(name));
    const samePath = mains.filter((name) => name.startsWith(`${pathHash}.`));
    const exact = this.fileName(pdfPath, contentHash);

    let result: LoadResult;
    if (samePath.includes(exact)) {
      // Die exakte Datei gewinnt immer. Eine ältere daneben kann iCloud zurückgebracht haben.
      result = await this.readFile(exact, pageCount, fresh, false);
    } else if (samePath.length) {
      result = await this.readFile(await this.newest(samePath), pageCount, fresh, true);
    } else if (names.some((name) => name.endsWith('.icloud') && name.includes(`${pathHash}.`))) {
      // iCloud meldet Dateien, die noch nicht auf dem Gerät liegen, als Platzhalter.
      return fresh({ readOnly: true, notices: [UNREADABLE] });
    } else {
      result = await this.adoptByContent(pdfPath, contentHash, mains, pageCount, pdfExists, fresh);
    }
    if (!result.readOnly) await this.mergeSideFiles(names, pathHash, pageCount, result);
    return result;
  }

  private async newest(names: string[]): Promise<string> {
    let best = names[0];
    let bestTime = -Infinity;
    for (const name of names) {
      const stat = await this.adapter.stat(this.fullPath(name));
      if (stat && stat.mtime > bestTime) {
        best = name;
        bestTime = stat.mtime;
      }
    }
    return best;
  }

  /** Gleicher Inhalt unter anderem Pfad: Liegt das alte PDF nicht mehr dort, wurde es verschoben. */
  private async adoptByContent(
    pdfPath: string,
    contentHash: string,
    mains: string[],
    pageCount: number,
    pdfExists: (path: string) => boolean,
    fresh: (extra?: Partial<LoadResult>) => LoadResult,
  ): Promise<LoadResult> {
    const candidates: { name: string; score: number }[] = [];
    for (const name of mains.filter((entry) => entry.endsWith(`.${contentHash}.json`))) {
      let file: InkFile;
      try {
        file = parseInkFile(await this.adapter.read(this.fullPath(name)));
      } catch {
        // Das kann genau die Tinte dieses PDFs sein. Lieber nichts schreiben als sie überdecken.
        return fresh({ readOnly: true, notices: [UNREADABLE] });
      }
      // Liegt das alte PDF noch dort, ist dies eine Kopie, und die Tinte bleibt beim Original.
      if (!pdfExists(file.path)) candidates.push({ name, score: commonTail(file.path, pdfPath) });
    }
    if (!candidates.length) return fresh();
    const best = Math.max(...candidates.map((candidate) => candidate.score));
    const top = candidates.filter((candidate) => candidate.score === best);
    if (top.length > 1) {
      return fresh({ notices: ['Für dieses PDF kommen mehrere Tintenstände infrage. Es startet ohne Tinte, die anderen bleiben unberührt.'] });
    }
    return this.readFile(top[0].name, pageCount, fresh, false);
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
      return fresh({ fileName: name, readOnly: true, notices: [UNREADABLE] });
    }
    try {
      const file = parseInkFile(text);
      const { session, droppedInk } = restoreSession(file, pageCount);
      const notices: string[] = [];
      if (pdfChanged) notices.push('Das PDF wurde seit dem Schreiben geändert. Die Tinte kann verrutscht sein.');
      if (droppedInk) notices.push('Das PDF hat weniger Seiten als vorher. Die Tinte der fehlenden Seiten bleibt aufbewahrt, bis sie wieder da sind.');
      return fresh({
        session,
        fileName: name,
        diskText: text,
        notices,
        storedCurrent: Number.isInteger(file.current) ? (file.current as number) : null,
      });
    } catch (error) {
      if (error instanceof InkFileError && error.newerVersion) {
        return fresh({ fileName: name, readOnly: true, notices: [`${error.message} Änderungen werden nicht gespeichert.`] });
      }
      return this.recoverDamaged(name, pageCount, fresh);
    }
  }

  /** Beschädigt: beiseitelegen statt überschreiben, und wenn möglich die Sicherung nehmen. */
  private async recoverDamaged(
    name: string,
    pageCount: number,
    fresh: (extra?: Partial<LoadResult>) => LoadResult,
  ): Promise<LoadResult> {
    try {
      await this.adapter.rename(this.fullPath(name), this.fullPath(`${name}.defekt-${Date.now()}`));
    } catch {
      return fresh({ fileName: name, readOnly: true, notices: ['Die Tintendatei ist beschädigt. Änderungen werden nicht gespeichert.'] });
    }
    try {
      const backup = this.fullPath(`${name}.sicherung`);
      if (await this.adapter.exists(backup)) {
        const { session } = restoreSession(parseInkFile(await this.adapter.read(backup)), pageCount);
        return fresh({ session, dirty: true, notices: ['Die Tintendatei war beschädigt. Geladen ist der Stand vom Beginn der letzten Sitzung.'] });
      }
    } catch {
      // Dann bleibt nur der Neubeginn. Die beschädigte Datei liegt noch daneben.
    }
    return fresh({ notices: ['Die Tintendatei war beschädigt und wurde beiseitegelegt. Es geht ohne Tinte weiter.'] });
  }

  /** Übernimmt Tinte aus Konfliktkopien und Nebendateien, damit keine Fassung stillschweigend liegen bleibt. */
  private async mergeSideFiles(names: string[], pathHash: string, pageCount: number, result: LoadResult): Promise<void> {
    let added = 0;
    for (const name of names) {
      const match = SIDE_FILE.exec(name);
      if (!match || match[1] !== pathHash) continue;
      try {
        added += mergeInkFile(result.session, parseInkFile(await this.adapter.read(this.fullPath(name))), pageCount);
        result.mergedFiles.push(name);
      } catch {
        result.notices.push('Eine weitere Fassung der Tinte ließ sich nicht lesen. Sie bleibt liegen und wird beim nächsten Öffnen erneut versucht.');
      }
    }
    if (result.mergedFiles.length) result.dirty = true;
    if (added) result.notices.push(`Zweite Fassung der Tinte gefunden: ${added} Striche übernommen. Gelöschte Striche können dadurch wieder auftauchen.`);
  }

  async write(fileName: string, text: string): Promise<void> {
    if (!this.folderReady) {
      if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
      this.folderReady = true;
    }
    // Direkt schreiben: Umbenennen nach dem Schreiben erzeugt in iCloud Konfliktkopien.
    await this.adapter.write(this.fullPath(fileName), text);
  }

  async remove(fileName: string): Promise<void> {
    const path = this.fullPath(fileName);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }

  async rename(fileName: string, newName: string): Promise<void> {
    await this.adapter.rename(this.fullPath(fileName), this.fullPath(newName));
  }

  /** Inhalt einer Datei oder null, wenn es sie nicht gibt. Ein Lesefehler wird weitergereicht. */
  async readIfExists(fileName: string): Promise<string | null> {
    const path = this.fullPath(fileName);
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  sideFileName(pdfPath: string, contentHash: string): string {
    return `${hashText(pdfPath)}.${contentHash} konflikt-${Date.now()}.json`;
  }

  /** Ein PDF wurde in Obsidian umbenannt: Die Tinte zieht sofort mit um. */
  async movePdf(oldPath: string, newPath: string): Promise<void> {
    const oldHash = hashText(oldPath);
    const newHash = hashText(newPath);
    const names = await this.allNames();
    for (const name of names) {
      const match = MAIN_FILE.exec(name) ?? SIDE_FILE.exec(name);
      if (!match || match[1] !== oldHash) continue;
      const target = `${newHash}${name.slice(oldHash.length)}`;
      // Liegt dort schon etwas, bleibt beides stehen. Überschreiben käme hier nie infrage.
      if (names.includes(target)) continue;
      const file = JSON.parse(await this.adapter.read(this.fullPath(name)));
      file.path = newPath;
      await this.adapter.write(this.fullPath(target), JSON.stringify(file));
      await this.adapter.remove(this.fullPath(name));
    }
  }
}

/** Kurz nach dem letzten Strich schreiben: oft genug gegen Verlust, selten genug für iCloud. */
export const SAVE_DELAY_MS = 2000;
/** Wer ohne Pause schreibt, soll trotzdem nicht ungesichert bleiben. */
export const SAVE_MAX_WAIT_MS = 20_000;

export class InkSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPending: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Stand der Sitzung beim letzten Schreiben. undefined heißt: Es ist auf jeden Fall etwas zu schreiben. */
  private lastText: string | null | undefined;
  private currentName: string | null;
  private targetName: string;
  /** Was auf der Platte stehen muss, damit wir schreiben dürfen. undefined heißt: unbekannt, keine Prüfung. */
  private expected: string | null | undefined;
  private conflictName: string | null = null;
  private backedUp = false;
  private mergedFiles: string[] = [];
  private onConflict: () => void = () => undefined;
  /** Der letzte Schreibversuch ist fehlgeschlagen. */
  failed = false;

  constructor(
    private store: InkStore,
    private pdfPath: string,
    private contentHash: string,
    private session: PresentationSession,
    existingName: string | null,
    private readOnly: boolean,
    private onError: (error: unknown) => void,
  ) {
    this.currentName = existingName;
    this.targetName = store.fileName(pdfPath, contentHash);
    this.lastText = serializeSession(session, pdfPath);
    this.expected = existingName ? undefined : null;
  }

  static fromLoad(
    store: InkStore,
    pdfPath: string,
    contentHash: string,
    loaded: LoadResult,
    onError: (error: unknown) => void,
    onConflict: () => void,
  ): InkSaver {
    const saver = new InkSaver(store, pdfPath, contentHash, loaded.session, loaded.fileName, loaded.readOnly, onError);
    saver.expected = loaded.diskText;
    saver.mergedFiles = loaded.mergedFiles;
    saver.onConflict = onConflict;
    if (loaded.dirty) saver.markUnsaved();
    return saver;
  }

  /** Für eine Sitzung, deren Inhalt die Datei noch nicht kennt. */
  markUnsaved(): void {
    this.lastText = undefined;
  }

  schedule(): void {
    if (this.readOnly) return;
    const now = Date.now();
    this.firstPending ??= now;
    if (this.timer !== null) clearTimeout(this.timer);
    const wait = Math.min(SAVE_DELAY_MS, SAVE_MAX_WAIT_MS - (now - this.firstPending));
    this.timer = setTimeout(() => void this.flush(), Math.max(0, wait));
  }

  /** Schreibt sofort, was noch offen ist. Aufträge laufen nacheinander, nie gleichzeitig. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.firstPending = null;
    if (this.readOnly) return this.queue;
    this.queue = this.queue.then(() => this.write());
    return this.queue;
  }

  /** Hat seit dem Laden jemand anderes geschrieben, etwa ein anderes Gerät über iCloud? */
  private async diskChanged(moved: boolean): Promise<boolean> {
    if (this.currentName && this.expected !== undefined) {
      const onDisk = await this.store.readIfExists(this.currentName);
      if (onDisk !== null && onDisk !== this.expected) return true;
    }
    if (moved || !this.currentName) {
      if (this.expected === undefined) return false;
      const atTarget = await this.store.readIfExists(this.targetName);
      if (atTarget !== null && (moved || atTarget !== this.expected)) return true;
    }
    return false;
  }

  /** Einmal je Sitzung: Der Stand vom Beginn bleibt erhalten, falls ein Schreiben mittendrin abbricht. */
  private async backupOnce(): Promise<void> {
    if (this.backedUp) return;
    this.backedUp = true;
    if (this.currentName && this.expected) await this.store.write(`${this.currentName}.sicherung`, this.expected);
  }

  private async write(): Promise<void> {
    const text = serializeSession(this.session, this.pdfPath);
    const moved = this.currentName !== null && this.currentName !== this.targetName;
    if (text === this.lastText && !moved) return;
    try {
      if (this.conflictName) {
        if (text !== null) await this.store.write(this.conflictName, text);
      } else {
        // Ohne Tinte und ohne vorhandene Datei gibt es nichts zu tun.
        const content = text ?? (this.currentName ? emptyInkFile(this.pdfPath) : null);
        if (content !== null) {
          if (await this.diskChanged(moved)) {
            this.conflictName = this.store.sideFileName(this.pdfPath, this.contentHash);
            if (text !== null) await this.store.write(this.conflictName, text);
            this.onConflict();
          } else {
            await this.backupOnce();
            await this.store.write(this.targetName, content);
            if (moved && this.currentName) await this.store.remove(this.currentName);
            this.currentName = this.targetName;
            this.expected = content;
            await this.retireMergedFiles();
          }
        }
      }
      this.lastText = text;
      this.failed = false;
    } catch (error) {
      if (!this.failed) this.onError(error);
      this.failed = true;
    }
  }

  /** Erst jetzt, wo ihre Tinte sicher in der Hauptdatei steht. Löschen wäre möglich, Aufheben ist sicherer. */
  private async retireMergedFiles(): Promise<void> {
    const files = this.mergedFiles;
    this.mergedFiles = [];
    for (const name of files) {
      try {
        await this.store.rename(name, `${name}.uebernommen-${Date.now()}`);
      } catch {
        // Bleibt sie liegen, wird sie beim nächsten Öffnen erneut geprüft. Doppelte Striche fallen dabei weg.
      }
    }
  }
}
