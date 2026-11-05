import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke } from '../src/presenter/ink';
import { hashBytes, hashText, INK_FILE_VERSION, mergeInkFile, parseInkFile, restoreSession, serializeSession } from '../src/presenter/inkFile';
import { InkSaver, InkStore, SAVE_DELAY_MS, SAVE_MAX_WAIT_MS, type InkAdapter } from '../src/presenter/inkStore';
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

function memoryAdapter(): InkAdapter & { files: Map<string, string>; writes: string[]; times: Map<string, number>; failRead: boolean; failWrite: boolean } {
  const files = new Map<string, string>();
  const adapter = {
    files,
    writes: [] as string[],
    times: new Map<string, number>(),
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
    stat: async (path: string) => (files.has(path) ? { mtime: adapter.times.get(path) ?? 0 } : null),
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
  it('stellt Tinte und leere Seiten wieder her, die Seitenposition gehört nicht in die Datei', () => {
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
    expect(restored.current).toBe(0);
    expect(parseInkFile(text).current).toBeUndefined();
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

    // Die fehlende Seite reist in der Datei mit und kommt zurück.
    const kept = serializeSession(shorter.session, 'a.pdf') as string;
    expect(restoreSession(parseInkFile(kept), 3).session.slides[2].ink.strokes).toHaveLength(1);
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

  it('liest die Seite aus älteren Dateien noch aus', async () => {
    const name = store.fileName('a.pdf', 'h1');
    adapter.files.set(`tinte/${name}`, JSON.stringify({ version: 2, path: 'a.pdf', current: 1, slides: [{ p: 1 }, { p: 2, l: 1 }] }));
    expect((await store.load('a.pdf', 'h1', 2, noPdf)).storedCurrent).toBe(1);
  });

  describe('mehrere Fassungen', () => {
    const fileWith = (count: number, x = 0.1) => {
      const session = new PresentationSession(2);
      for (let i = 0; i < count; i++) session.slides[0].ink.add(stroke(x + i * 0.01));
      return serializeSession(session, 'a.pdf') as string;
    };

    it('die exakte Datei gewinnt, auch wenn eine alte in der Liste vorn steht', async () => {
      const old = `tinte/${store.fileName('a.pdf', '0alt')}`;
      const exact = `tinte/${store.fileName('a.pdf', 'h1')}`;
      adapter.files.set(old, fileWith(1));
      adapter.files.set(exact, fileWith(5, 0.3));
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(result.session.slides[0].ink.strokes).toHaveLength(5);
      expect(result.notices).toEqual([]);
      const saver = InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => undefined);
      await saver.flush();
      expect(parseInkFile(adapter.files.get(exact) as string).slides[0].s).toHaveLength(5);
    });

    it('ohne exakte Datei nimmt es die neueste', async () => {
      const older = `tinte/${store.fileName('a.pdf', 'h8')}`;
      const newer = `tinte/${store.fileName('a.pdf', 'h9')}`;
      adapter.files.set(older, fileWith(1));
      adapter.files.set(newer, fileWith(4));
      adapter.times.set(older, 10);
      adapter.times.set(newer, 20);
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(result.fileName).toBe(store.fileName('a.pdf', 'h9'));
      expect(result.notices[0]).toMatch(/geändert/);
    });

    it('führt iCloud-Konfliktkopien zusammen und legt sie erst nach dem Schreiben beiseite', async () => {
      const name = store.fileName('a.pdf', 'h1');
      const copy = name.replace('.json', ' 2.json');
      adapter.files.set(`tinte/${name}`, fileWith(2));
      adapter.files.set(`tinte/${copy}`, fileWith(3, 0.5));
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(result.session.slides[0].ink.strokes).toHaveLength(5);
      expect(result.notices[0]).toMatch(/3 Striche/);
      expect(adapter.files.has(`tinte/${copy}`)).toBe(true);
      await InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => undefined).flush();
      expect(parseInkFile(adapter.files.get(`tinte/${name}`) as string).slides[0].s).toHaveLength(5);
      expect(adapter.files.has(`tinte/${copy}`)).toBe(false);
      expect([...adapter.files.keys()].some((key) => key.includes('.uebernommen-'))).toBe(true);
      // Beim nächsten Öffnen kommt nichts doppelt.
      const again = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(again.session.slides[0].ink.strokes).toHaveLength(5);
      expect(again.notices).toEqual([]);
    });

    it('eine unlesbare Konfliktkopie bleibt liegen und blockiert nichts', async () => {
      const name = store.fileName('a.pdf', 'h1');
      const copy = name.replace('.json', ' 2.json');
      adapter.files.set(`tinte/${name}`, fileWith(2));
      adapter.files.set(`tinte/${copy}`, '{kaputt');
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(result.session.slides[0].ink.strokes).toHaveLength(2);
      expect(result.notices[0]).toMatch(/weitere Fassung/);
      expect(adapter.files.get(`tinte/${copy}`)).toBe('{kaputt');
    });

    it('ändert ein anderes Gerät die Datei, wird sie nicht überschrieben', async () => {
      const name = store.fileName('a.pdf', 'h1');
      adapter.files.set(`tinte/${name}`, fileWith(2));
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      let conflicts = 0;
      const saver = InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => conflicts++);
      const fromOtherDevice = fileWith(9, 0.2);
      adapter.files.set(`tinte/${name}`, fromOtherDevice);
      result.session.slides[1].ink.add(stroke(0.7));
      await saver.flush();
      expect(adapter.files.get(`tinte/${name}`)).toBe(fromOtherDevice);
      expect(conflicts).toBe(1);
      const side = [...adapter.files.keys()].find((key) => key.includes(' konflikt-')) as string;
      expect(side).toBeTruthy();
      // Weitere Striche gehen in dieselbe Nebendatei.
      result.session.slides[1].ink.add(stroke(0.8));
      await saver.flush();
      expect(parseInkFile(adapter.files.get(side) as string).slides[1].s).toHaveLength(2);
      expect(conflicts).toBe(1);
      expect(adapter.files.get(`tinte/${name}`)).toBe(fromOtherDevice);
      // Beim nächsten Öffnen ist alles beisammen.
      const merged = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(merged.session.slides[0].ink.strokes.length).toBe(11);
      expect(merged.session.slides[1].ink.strokes).toHaveLength(2);
    });

    it('reines Blättern schreibt nichts', async () => {
      const name = store.fileName('a.pdf', 'h1');
      adapter.files.set(`tinte/${name}`, fileWith(2));
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      const saver = InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => undefined);
      result.session.current = 1;
      await saver.flush();
      expect(adapter.writes).toHaveLength(0);
    });

    it('ein Datei, die während der Sitzung neu entsteht, wird nicht überschrieben', async () => {
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      const saver = InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => undefined);
      const name = `tinte/${store.fileName('a.pdf', 'h1')}`;
      adapter.files.set(name, fileWith(4));
      result.session.slides[0].ink.add(stroke());
      await saver.flush();
      expect(parseInkFile(adapter.files.get(name) as string).slides[0].s).toHaveLength(4);
    });
  });

  describe('kürzeres PDF', () => {
    it('die Tinte fehlender Seiten bleibt erhalten und kommt mit dem vollen PDF zurück', async () => {
      const full = new PresentationSession(5);
      full.slides[4].ink.add(stroke());
      full.slides[0].ink.add(stroke(0.3));
      adapter.files.set(`tinte/${store.fileName('a.pdf', 'voll')}`, serializeSession(full, 'a.pdf') as string);

      const short = await store.load('a.pdf', 'teil', 2, noPdf);
      expect(short.notices.join(' ')).toMatch(/aufbewahrt/);
      await InkSaver.fromLoad(store, 'a.pdf', 'teil', short, () => undefined, () => undefined).flush();

      const back = await store.load('a.pdf', 'neu', 5, noPdf);
      expect(back.session.slides[4].ink.strokes).toHaveLength(1);
      expect(back.session.slides[0].ink.strokes).toHaveLength(1);
    });
  });

  describe('Verschieben', () => {
    const fileAt = (path: string, count: number) => {
      const session = new PresentationSession(2);
      for (let i = 0; i < count; i++) session.slides[0].ink.add(stroke(0.1 + i * 0.01));
      return serializeSession(session, path) as string;
    };

    it('bei identischen Kopien im Ordnerumzug gewinnt der passendere Pfad', async () => {
      adapter.files.set(`tinte/${store.fileName('alt/8a/T.pdf', 'h1')}`, fileAt('alt/8a/T.pdf', 3));
      adapter.files.set(`tinte/${store.fileName('alt/8e/T.pdf', 'h1')}`, fileAt('alt/8e/T.pdf', 7));
      const a = await store.load('neu/8a/T.pdf', 'h1', 2, noPdf);
      expect(a.session.slides[0].ink.strokes).toHaveLength(3);
      const e = await store.load('neu/8e/T.pdf', 'h1', 2, noPdf);
      expect(e.session.slides[0].ink.strokes).toHaveLength(7);
    });

    it('ist es nicht zu entscheiden, startet das PDF leer und lässt die anderen in Ruhe', async () => {
      adapter.files.set(`tinte/${store.fileName('x/T.pdf', 'h1')}`, fileAt('x/T.pdf', 3));
      adapter.files.set(`tinte/${store.fileName('y/T.pdf', 'h1')}`, fileAt('y/T.pdf', 7));
      const result = await store.load('z/T.pdf', 'h1', 2, noPdf);
      expect(result.session.hasContent()).toBe(false);
      expect(result.notices[0]).toMatch(/mehrere/);
    });

    it('eine unlesbare Datei gleichen Inhalts sperrt das Schreiben', async () => {
      adapter.files.set(`tinte/${store.fileName('alt/T.pdf', 'h1')}`, fileAt('alt/T.pdf', 3));
      adapter.failRead = true;
      const result = await store.load('neu/T.pdf', 'h1', 2, noPdf);
      expect(result.readOnly).toBe(true);
      expect(result.notices[0]).toMatch(/nicht gespeichert/);
    });

    it('ein iCloud-Platzhalter sperrt das Schreiben', async () => {
      adapter.files.set(`tinte/.${store.fileName('a.pdf', 'h1')}.icloud`, '');
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(result.readOnly).toBe(true);
    });

    it('zieht beim Umbenennen in Obsidian mit um und überschreibt nichts', async () => {
      adapter.files.set(`tinte/${store.fileName('alt.pdf', 'h1')}`, fileAt('alt.pdf', 3));
      adapter.files.set(`tinte/${store.fileName('alt.pdf', 'h1').replace('.json', ' 2.json')}`, fileAt('alt.pdf', 2));
      await store.movePdf('alt.pdf', 'neu.pdf');
      const moved = await store.load('neu.pdf', 'h1', 2, noPdf);
      expect(moved.session.slides[0].ink.strokes).toHaveLength(3);
      expect(parseInkFile(adapter.files.get(`tinte/${store.fileName('neu.pdf', 'h1')}`) as string).path).toBe('neu.pdf');
      expect(adapter.files.has(`tinte/${store.fileName('alt.pdf', 'h1')}`)).toBe(false);

      adapter.files.set(`tinte/${store.fileName('b.pdf', 'h1')}`, fileAt('b.pdf', 1));
      adapter.files.set(`tinte/${store.fileName('c.pdf', 'h1')}`, fileAt('c.pdf', 6));
      await store.movePdf('b.pdf', 'c.pdf');
      expect(parseInkFile(adapter.files.get(`tinte/${store.fileName('c.pdf', 'h1')}`) as string).slides[0].s).toHaveLength(6);
      expect(adapter.files.has(`tinte/${store.fileName('b.pdf', 'h1')}`)).toBe(true);
    });
  });

  describe('Sicherung', () => {
    it('hält den Stand vom Sitzungsbeginn fest und hilft bei einer beschädigten Datei', async () => {
      const name = store.fileName('a.pdf', 'h1');
      const session = new PresentationSession(2);
      session.slides[0].ink.add(stroke());
      adapter.files.set(`tinte/${name}`, serializeSession(session, 'a.pdf') as string);
      const result = await store.load('a.pdf', 'h1', 2, noPdf);
      const saver = InkSaver.fromLoad(store, 'a.pdf', 'h1', result, () => undefined, () => undefined);
      result.session.slides[0].ink.add(stroke(0.4));
      await saver.flush();
      result.session.slides[0].ink.add(stroke(0.5));
      await saver.flush();
      const backup = parseInkFile(adapter.files.get(`tinte/${name}.sicherung`) as string);
      expect(backup.slides[0].s).toHaveLength(1);

      adapter.files.set(`tinte/${name}`, '{"abgeschnitten');
      const restored = await store.load('a.pdf', 'h1', 2, noPdf);
      expect(restored.session.slides[0].ink.strokes).toHaveLength(1);
      expect(restored.dirty).toBe(true);
      expect(restored.notices[0]).toMatch(/Beginn der letzten Sitzung/);
      expect([...adapter.files.keys()].some((key) => key.includes('.defekt-'))).toBe(true);
    });
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
    const damaged = [...adapter.files.keys()].find((key) => key.includes('.defekt-')) as string;
    expect(adapter.files.get(damaged)).toBe('{kaputt');
  });

  it('legt ohne Tinte keine Datei an', async () => {
    const session = new PresentationSession(1);
    session.current = 0;
    const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
    saver.markUnsaved();
    await saver.flush();
    expect(adapter.files.size).toBe(0);
  });

  it('schreibt auch ohne Pause spätestens nach der Höchstwartezeit', async () => {
    vi.useFakeTimers();
    try {
      const session = new PresentationSession(1);
      const saver = new InkSaver(store, 'a.pdf', 'h1', session, null, false, () => undefined);
      for (let elapsed = 0; elapsed < SAVE_MAX_WAIT_MS + 1000; elapsed += 1000) {
        session.slides[0].ink.add(stroke(0.1 + elapsed * 1e-6));
        saver.schedule();
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(adapter.writes.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
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

describe('Zusammenführen', () => {
  it('fügt nur Fehlendes hinzu und nimmt nichts weg', () => {
    const session = new PresentationSession(2);
    const shared = stroke(0.1);
    session.slides[0].ink.add(shared);
    session.slides[0].ink.add(stroke(0.2));
    const other = new PresentationSession(2);
    other.slides[0].ink.add(shared);
    other.slides[1].ink.add(stroke(0.5));
    other.insertBlankAfter(1, 0.75);
    other.slides[2].ink.add(stroke(0.6));
    const added = mergeInkFile(session, parseInkFile(serializeSession(other, 'a.pdf') as string), 2);
    expect(added).toBe(2);
    expect(session.slides[0].ink.strokes).toHaveLength(2);
    expect(session.slides[1].ink.strokes).toHaveLength(1);
    expect(session.slides[2].pdfPage).toBeNull();
    expect(mergeInkFile(session, parseInkFile(serializeSession(other, 'a.pdf') as string), 2)).toBe(0);
  });

  it('übernimmt Sperren, ohne alle Seiten zu verbergen', () => {
    const session = new PresentationSession(2);
    const other = new PresentationSession(2);
    other.setLocked(0, true);
    mergeInkFile(session, parseInkFile(serializeSession(other, 'a.pdf') as string), 2);
    expect(session.slides[0].locked).toBe(true);
    const third = new PresentationSession(2);
    third.setLocked(1, true);
    mergeInkFile(session, parseInkFile(serializeSession(third, 'a.pdf') as string), 2);
    expect(session.slides.filter((slide) => !slide.locked)).toHaveLength(1);
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
