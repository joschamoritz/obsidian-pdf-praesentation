import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke } from '../src/presenter/ink';
import { hashBytes, hashText, INK_FILE_VERSION, parseInkFile, restoreSession, serializeSession } from '../src/presenter/inkFile';
import { InkSaver, InkStore, SAVE_DELAY_MS, type InkAdapter } from '../src/presenter/inkStore';
import { PresentationSession } from '../src/presenter/session';

const stroke = (x = 0.1): Stroke => ({
  kind: 'pen',
  color: '#d92626',
  width: 0.0032,
  penType: 'fountain',
  points: [
    { x, y: 0.2, p: 0.5, w: 0.003 },
    { x: x + 0.1, y: 0.25, p: 0.7, w: 0.0035 },
  ],
});

function memoryAdapter(): InkAdapter & { files: Map<string, string>; writes: string[]; failRead: boolean; failWrite: boolean } {
  const files = new Map<string, string>();
  const adapter = {
    files,
    writes: [] as string[],
    failRead: false,
    failWrite: false,
    exists: async (path: string) => path === 'tinte' || files.has(path),
    list: async () => ({ files: [...files.keys()], folders: [] }),
    read: async (path: string) => {
      if (adapter.failRead) throw new Error('nicht geladen');
      const value = files.get(path);
      if (value === undefined) throw new Error('fehlt');
      return value;
    },
    write: async (path: string, data: string) => {
      if (adapter.failWrite) throw new Error('kein Platz');
      adapter.writes.push(path);
      files.set(path, data);
    },
    remove: async (path: string) => void files.delete(path),
    mkdir: async () => undefined,
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
  };
  return adapter;
}

describe('Hash', () => {
  it('ist stabil und unterscheidet Inhalte', () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).toBe(hashBytes(new Uint8Array([1, 2, 3])));
    expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([1, 2, 4])));
    expect(hashText('a/b.pdf')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('Dateiformat', () => {
  it('stellt Tinte, leere Seiten und Position wieder her', () => {
    const session = new PresentationSession(3);
    session.slides[1].ink.add(stroke());
    session.insertBlankAfter(0, 0.6);
    session.slides[1].ink.add(stroke(0.4));
    session.current = 2;

    const text = serializeSession(session, 'a.pdf')!;
    const { session: restored, droppedInk } = restoreSession(parseInkFile(text), 3);

    expect(droppedInk).toBe(false);
    expect(restored.slides.map((slide) => slide.pdfPage)).toEqual([1, null, 2, 3]);
    expect(restored.slides[1].aspect).toBe(0.6);
    expect(restored.current).toBe(2);
    expect(restored.slides[2].ink.strokes[0]).toMatchObject({ kind: 'pen', color: '#d92626', penType: 'fountain' });
    expect(restored.slides[2].ink.strokes[0].points[1].x).toBeCloseTo(0.2);
    // Beim erneuten Speichern ändert sich nichts, sonst schriebe jeder Start die Datei neu.
    expect(serializeSession(restored, 'a.pdf')).toBe(text);
  });

  it('hält Formen und geraden Marker scharf', () => {
    const session = new PresentationSession(1);
    session.slides[0].ink.add({ ...stroke(), kind: 'marker', sharp: true, penType: undefined });
    const restored = restoreSession(parseInkFile(serializeSession(session, 'a.pdf')!), 1).session;
    expect(restored.slides[0].ink.strokes[0]).toMatchObject({ kind: 'marker', sharp: true });
  });

  it('braucht ohne Inhalt keine Datei', () => {
    expect(serializeSession(new PresentationSession(3), 'a.pdf')).toBeNull();
  });

  it('das PDF hat Vorrang, wenn sich die Seitenzahl geändert hat', () => {
    const session = new PresentationSession(3);
    session.slides[2].ink.add(stroke());
    const text = serializeSession(session, 'a.pdf')!;

    const shorter = restoreSession(parseInkFile(text), 2);
    expect(shorter.droppedInk).toBe(true);
    expect(shorter.session.slides.map((slide) => slide.pdfPage)).toEqual([1, 2]);

    const longer = restoreSession(parseInkFile(text), 5);
    expect(longer.droppedInk).toBe(false);
    expect(longer.session.slides.map((slide) => slide.pdfPage)).toEqual([1, 2, 3, 4, 5]);
    expect(longer.session.slides[2].ink.strokes).toHaveLength(1);
  });

  it('überspringt kaputte Striche, statt alles zu verlieren', () => {
    const file = {
      version: 1,
      path: 'a.pdf',
      current: 99,
      slides: [{ p: 1, s: [{ k: 'p', c: '#000', b: 0.003, d: [0.1, 0.1, 0.5, 0.003] }, { k: 'p', c: '#000', b: 0.003, d: [1, 2] }, null] }, null],
    };
    const { session } = restoreSession(parseInkFile(JSON.stringify(file)), 2);
    expect(session.slides[0].ink.strokes).toHaveLength(1);
    expect(session.current).toBe(1);
  });

  it('lehnt Unlesbares und neuere Versionen ab', () => {
    expect(() => parseInkFile('{kaputt')).toThrow();
    expect(() => parseInkFile('{"slides":1}')).toThrow();
    expect(() => parseInkFile(JSON.stringify({ version: INK_FILE_VERSION + 1, slides: [] }))).toThrow(/neueren/);
  });
});

describe('InkStore und InkSaver', () => {
  let adapter: ReturnType<typeof memoryAdapter>;
  let store: InkStore;
  const noPdf = () => false;

  beforeEach(() => {
    adapter = memoryAdapter();
    store = new InkStore(adapter, 'tinte');
  });

  async function saveInk(path: string, hash: string): Promise<string> {
    const session = new PresentationSession(2);
    const saver = new InkSaver(store, path, hash, session, null, false, () => undefined);
    session.slides[0].ink.add(stroke());
    await saver.flush();
    return store.fileName(path, hash);
  }

  it('findet gespeicherte Tinte wieder', async () => {
    await saveInk('a.pdf', 'h1');
    const result = await store.load('a.pdf', 'h1', 2, noPdf);
    expect(result.session.slides[0].ink.strokes).toHaveLength(1);
    expect(result.notices).toEqual([]);
  });

  it('findet die Tinte eines außerhalb von Obsidian verschobenen PDFs', async () => {
    await saveInk('alt/a.pdf', 'h1');
    const result = await store.load('neu/a.pdf', 'h1', 2, noPdf);
    expect(result.session.slides[0].ink.strokes).toHaveLength(1);
    expect(result.fileName).toBe(store.fileName('alt/a.pdf', 'h1'));
  });

  it('räumt nach dem Verschieben die alte Datei weg', async () => {
    await saveInk('alt/a.pdf', 'h1');
    const result = await store.load('neu/a.pdf', 'h1', 2, noPdf);
    await new InkSaver(store, 'neu/a.pdf', 'h1', result.session, result.fileName, false, () => undefined).flush();
    expect([...adapter.files.keys()]).toEqual([`tinte/${store.fileName('neu/a.pdf', 'h1')}`]);
  });

  it('eine inhaltsgleiche Kopie übernimmt die Tinte des Originals nicht', async () => {
    await saveInk('a.pdf', 'h1');
    const result = await store.load('kopie.pdf', 'h1', 2, (path) => path === 'a.pdf');
    expect(result.session.hasContent()).toBe(false);
  });

  it('warnt, wenn das PDF geändert wurde, und behält die Tinte', async () => {
    await saveInk('a.pdf', 'h1');
    const result = await store.load('a.pdf', 'h2', 2, noPdf);
    expect(result.session.slides[0].ink.strokes).toHaveLength(1);
    expect(result.notices[0]).toMatch(/geändert/);
  });

  it('ignoriert iCloud-Konfliktkopien', async () => {
    const name = await saveInk('a.pdf', 'h1');
    adapter.files.set(`tinte/${name.replace('.json', ' 2.json')}`, 'egal');
    adapter.files.delete(`tinte/${name}`);
    const result = await store.load('a.pdf', 'h1', 2, noPdf);
    expect(result.fileName).toBeNull();
  });

  it('überschreibt nichts, wenn die Datei gerade nicht lesbar ist', async () => {
    const name = await saveInk('a.pdf', 'h1');
    const before = adapter.files.get(`tinte/${name}`);
    adapter.failRead = true;
    const result = await store.load('a.pdf', 'h1', 2, noPdf);
    expect(result.readOnly).toBe(true);
    expect(result.notices[0]).toMatch(/nicht gespeichert/);

    result.session.slides[0].ink.add(stroke());
    await new InkSaver(store, 'a.pdf', 'h1', result.session, result.fileName, result.readOnly, () => undefined).flush();
    expect(adapter.files.get(`tinte/${name}`)).toBe(before);
  });

  it('legt eine beschädigte Datei beiseite', async () => {
    const name = await saveInk('a.pdf', 'h1');
    adapter.files.set(`tinte/${name}`, '{kaputt');
    const result = await store.load('a.pdf', 'h1', 2, noPdf);
    expect(result.readOnly).toBe(false);
    expect(result.session.hasContent()).toBe(false);
    expect(adapter.files.get(`tinte/${name}.defekt`)).toBe('{kaputt');
  });

  it('legt ohne Tinte keine Datei an', async () => {
    const session = new PresentationSession(1);
    session.current = 0;
    const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
    saver.markUnsaved();
    await saver.flush();
    expect(adapter.files.size).toBe(0);
  });

  it('schreibt nach einer Pause, fasst mehrere Striche zusammen, schreibt Unverändertes nicht', async () => {
    vi.useFakeTimers();
    try {
      const session = new PresentationSession(1);
      const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
      session.slides[0].ink.add(stroke());
      saver.schedule();
      session.slides[0].ink.add(stroke(0.5));
      saver.schedule();
      expect(adapter.writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
      expect(adapter.writes).toHaveLength(1);
      await saver.flush();
      expect(adapter.writes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leert die Datei, wenn alle Tinte weg ist, statt sie zu löschen', async () => {
    const session = new PresentationSession(1);
    const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
    session.slides[0].ink.add(stroke());
    await saver.flush();
    expect(adapter.files.size).toBe(1);
    session.clearAllInk();
    await saver.flush();
    expect(adapter.files.size).toBe(1);
    const result = await store.load('a.pdf', 'h1', 1, noPdf);
    expect(result.session.hasContent()).toBe(false);
    expect(result.session.slides).toHaveLength(1);
    expect(result.notices).toEqual([]);

    // Danach bleibt die leere Datei in Ruhe, und neue Tinte landet wieder darin.
    adapter.writes.length = 0;
    const next = new InkSaver(store, 'a.pdf', 'h1', result.session, result.fileName, false, () => undefined);
    await next.flush();
    expect(adapter.writes).toHaveLength(0);
    result.session.slides[0].ink.add(stroke());
    await next.flush();
    expect(adapter.writes).toHaveLength(1);
    expect((await store.load('a.pdf', 'h1', 1, noPdf)).session.hasContent()).toBe(true);
  });

  it('meldet einen Schreibfehler einmal und schafft es beim nächsten Versuch', async () => {
    const onError = vi.fn();
    const session = new PresentationSession(1);
    const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, onError);
    session.slides[0].ink.add(stroke());
    adapter.failWrite = true;
    await saver.flush();
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.failed).toBe(true);
    adapter.failWrite = false;
    await saver.flush();
    expect(saver.failed).toBe(false);
    expect(adapter.files.size).toBe(1);
  });
});

describe('Alte Tintendateien', () => {
  it('räumt Striche aus Version 1 auf, spätere bleiben unberührt', () => {
    const d = [0.5, 0.3, 0.2, 0.003, 0.501, 0.3, 0.2, 0.003, 0.5, 0.3, 0.2, 0.003, 0.501, 0.3, 0.2, 0.003, 0.502, 0.3, 0.2, 0.003, 0.503, 0.3, 0.2, 0.003];
    const file = (version: number) => ({ version, path: 'a.pdf', current: 0, slides: [{ p: 1, s: [{ k: 'p', c: '#000', b: 0.003, d }] }] });
    const points = (version: number) => restoreSession(file(version) as never, 1).session.slides[0].ink.strokes[0].points.length;
    expect(points(1)).toBe(4);
    expect(points(INK_FILE_VERSION)).toBe(6);
  });
});

describe('Nicht gespeicherte Sitzung', () => {
  it('wird beim nächsten Öffnen nachgeholt, auch ohne neuen Strich', async () => {
    const adapter = memoryAdapter();
    const store = new InkStore(adapter, 'tinte');
    const session = new PresentationSession(1);
    session.slides[0].ink.add(stroke());
    const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
    await saver.flush();
    expect(adapter.files.size).toBe(0);
    saver.markUnsaved();
    await saver.flush();
    expect(adapter.files.size).toBe(1);
  });
});

describe('Alle Tinte löschen', () => {
  it('entfernt Tinte und leere Seiten, die PDF-Seiten bleiben', () => {
    const session = new PresentationSession(2);
    session.slides[0].ink.add(stroke());
    session.insertBlankAfter(1, 0.75);
    session.current = 2;
    session.clearAllInk();
    expect(session.slides.map((slide) => slide.pdfPage)).toEqual([1, 2]);
    expect(session.hasContent()).toBe(false);
    expect(session.current).toBe(1);
  });
});
