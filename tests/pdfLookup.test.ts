import { describe, expect, it } from 'vitest';
import { findPdfs, looksLikePdfPath } from '../src/pdfLookup';
import { restoreSession, parseInkFile, serializeSession } from '../src/presenter/inkFile';
import { PresentationSession } from '../src/presenter/session';

const paths = [
  '1_Unterrichtsmaterial/10c/D10.3/Tafelbilder DS1 D10.3.pdf',
  '1_Unterrichtsmaterial/10c/D10.3/Korrektur/Rückmeldungen KA1.pdf',
  '1_Unterrichtsmaterial/8a/Tafelbilder.pdf',
  '1_Unterrichtsmaterial/8e/Tafelbilder.pdf',
];

describe('findPdfs', () => {
  it('findet genaue Pfade, Pfadenden und bloße Dateinamen', () => {
    expect(findPdfs(paths[0], paths)).toEqual([paths[0]]);
    expect(findPdfs('Korrektur/Rückmeldungen KA1.pdf', paths)).toEqual([paths[1]]);
    expect(findPdfs('Tafelbilder DS1 D10.3.pdf', paths)).toEqual([paths[0]]);
  });

  it('nennt alle Treffer, wenn ein Name mehrfach vorkommt', () => {
    expect(findPdfs('Tafelbilder.pdf', paths)).toEqual([paths[2], paths[3]]);
    expect(findPdfs('8e/Tafelbilder.pdf', paths)).toEqual([paths[3]]);
  });

  it('kommt mit gekürzten Pfaden, Backslashes und Groß- und Kleinschreibung klar', () => {
    expect(findPdfs('…/8e/Tafelbilder.pdf', paths)).toEqual([paths[3]]);
    expect(findPdfs('8a\\Tafelbilder.pdf', paths)).toEqual([paths[2]]);
    expect(findPdfs('tafelbilder ds1 d10.3.PDF', paths)).toEqual([paths[0]]);
  });

  it('erkennt Umlaute in beiden Kodierungen', () => {
    expect(findPdfs('Ru\u0308ckmeldungen KA1.pdf', paths)).toEqual([paths[1]]);
  });

  it('ein verschobenes PDF findet sich noch über den Dateinamen', () => {
    expect(findPdfs('Alter Ordner/Tafelbilder DS1 D10.3.pdf', paths)).toEqual([paths[0]]);
  });

  it('ignoriert andere Laufwerke, andere Dateien und Unbekanntes', () => {
    expect(findPdfs('D:\\Schule\\Archiv\\Tafelbilder.pdf', paths)).toEqual([]);
    expect(findPdfs('Notiz.md', paths)).toEqual([]);
    expect(findPdfs('Gibt es nicht.pdf', paths)).toEqual([]);
    expect(looksLikePdfPath('Tafel.pdf und mehr')).toBe(false);
    expect(looksLikePdfPath('  Tafel.pdf ')).toBe(true);
  });
});

describe('Gesperrte Seiten', () => {
  const session = () => {
    const created = new PresentationSession(5);
    created.setLocked(1, true);
    created.setLocked(2, true);
    return created;
  };

  it('Blättern überspringt gesperrte Seiten in beide Richtungen', () => {
    const s = session();
    expect(s.nextVisible(0, 1)).toBe(3);
    expect(s.nextVisible(3, -1)).toBe(0);
    expect(s.nextVisible(4, 1)).toBeNull();
    expect(s.nextVisible(0, -1)).toBeNull();
  });

  it('eine gesperrte letzte Seite ist vom Ende aus nicht erreichbar', () => {
    const s = new PresentationSession(3);
    s.setLocked(2, true);
    expect(s.nextVisible(1, 1)).toBeNull();
    expect(s.lastVisible()).toBe(1);
  });

  it('springt von einer gesperrten Seite zur nächsten sichtbaren, sonst zur vorigen', () => {
    const s = session();
    expect(s.nearestVisible(1)).toBe(3);
    expect(s.nearestVisible(0)).toBe(0);
    const end = new PresentationSession(3);
    end.setLocked(2, true);
    expect(end.nearestVisible(2)).toBe(1);
  });

  it('zählt für die Anzeige nur sichtbare Seiten', () => {
    expect(session().visiblePosition(3)).toEqual({ position: 2, total: 3 });
  });

  it('mindestens eine Seite bleibt sichtbar', () => {
    const s = new PresentationSession(2);
    expect(s.setLocked(0, true)).toBe(true);
    expect(s.setLocked(1, true)).toBe(false);
    expect(s.slides[1].locked).toBe(false);
    expect(s.setLocked(0, false)).toBe(true);
  });

  it('leere Seiten lassen sich nicht sperren', () => {
    const s = new PresentationSession(2);
    const blank = s.insertBlankAfter(0, 0.75);
    expect(s.setLocked(blank, true)).toBe(false);
  });

  it('die Sperre wird gespeichert und übersteht einen Neustart', () => {
    const text = serializeSession(session(), 'a.pdf') as string;
    const restored = restoreSession(parseInkFile(text), 5).session;
    expect(restored.slides.map((slide) => slide.locked)).toEqual([false, true, true, false, false]);
    expect(serializeSession(restored, 'a.pdf')).toBe(text);
  });

  it('eine Sperre allein ist Grund genug für eine Datei', () => {
    expect(serializeSession(session(), 'a.pdf')).not.toBeNull();
  });

  it('„Alle Tinte löschen“ lässt die Sperren stehen', () => {
    const s = session();
    s.slides[0].ink.add({ kind: 'pen', color: '#000', width: 0.003, points: [{ x: 0, y: 0, p: 0.5, w: 0.003 }] });
    expect(s.hasClearable()).toBe(true);
    s.clearAllInk();
    expect(s.hasClearable()).toBe(false);
    expect(s.slides[1].locked).toBe(true);
    expect(s.hasContent()).toBe(true);
  });

  it('bleibt bedienbar, wenn ein gekürztes PDF nur gesperrte Seiten übrig lässt', () => {
    const text = JSON.stringify({ version: 2, path: 'a.pdf', current: 0, slides: [{ p: 1, l: 1 }, { p: 2 }] });
    const restored = restoreSession(parseInkFile(text), 1).session;
    expect(restored.slides[0].locked).toBe(false);
  });
});
