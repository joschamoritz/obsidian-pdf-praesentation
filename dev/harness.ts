// Testseite ohne Obsidian: dieselbe Präsentation mit pdf.js aus npm.
import * as pdfjs from 'pdfjs-dist';
import { hashBytes } from '../src/presenter/inkFile';
import { InkSaver, InkStore, type InkAdapter } from '../src/presenter/inkStore';
import { Presenter } from '../src/presenter/Presenter';
import type { PdfDocument } from '../src/presenter/types';

/** Dateien im localStorage, damit das Speichern auch ohne Obsidian einen Neustart übersteht. */
const PREFIX = 'pp-datei:';
const fakeAdapter: InkAdapter = {
  exists: async (path) => path === 'tinte' || localStorage.getItem(PREFIX + path) !== null,
  list: async () => ({
    files: Object.keys(localStorage).filter((key) => key.startsWith(PREFIX)).map((key) => key.slice(PREFIX.length)),
    folders: [],
  }),
  read: async (path) => {
    const value = localStorage.getItem(PREFIX + path);
    if (value === null) throw new Error('Datei fehlt');
    return value;
  },
  write: async (path, data) => localStorage.setItem(PREFIX + path, data),
  remove: async (path) => localStorage.removeItem(PREFIX + path),
  mkdir: async () => undefined,
  stat: async (path) => (localStorage.getItem(PREFIX + path) === null ? null : { mtime: 1 }),
  rename: async (from, to) => {
    localStorage.setItem(PREFIX + to, localStorage.getItem(PREFIX + from) ?? '');
    localStorage.removeItem(PREFIX + from);
  },
};

pdfjs.GlobalWorkerOptions.workerSrc = '/dev/pdf.worker.mjs';

const parameters = new URLSearchParams(location.search);
// Ein verdecktes Fenster liefert keine Animationsframes, und pdf.js würde ewig darauf warten.
if (parameters.has('ohneframes')) {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);
}

const name = parameters.get('pdf') ?? 'folien';
const path = `dev/fixtures/${name}.pdf`;
const bytes = new Uint8Array(await (await fetch(`/${path}`)).arrayBuffer());
const contentHash = hashBytes(bytes);
const doc = (await pdfjs.getDocument({ data: bytes }).promise) as unknown as PdfDocument;
const store = new InkStore(fakeAdapter, 'tinte');
const loaded = await store.load(path, contentHash, doc.numPages, () => true);
const { session } = loaded;
const saver = InkSaver.fromLoad(store, path, contentHash, loaded, (error) => console.error(error), () => console.warn('Konflikt'));
const presenter = new Presenter({
  doc,
  session,
  onChange: () => saver.schedule(),
  onHidden: () => void saver.flush(),
  onClose: () => {
    void saver.flush();
    void doc.destroy();
  },
});

// Für die Prüfung aus der Browser-Konsole.
Object.assign(window, { presenter, session, saver, loaded });
