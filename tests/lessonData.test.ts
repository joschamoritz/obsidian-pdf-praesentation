import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportWithInk } from '../src/exportPdf';
import { digitalPdfNames, findLineBand, formatDwell, groupSlug, parsePlan, planLabel, type TextItem } from '../src/presenter/lessonData';
import { mergeInkFile, parseInkFile, restoreSession, serializeSession } from '../src/presenter/inkFile';
import { PresentationSession } from '../src/presenter/session';
import { CountdownTimer, formatOvertime } from '../src/presenter/timer';

const PLAN = `## Verlaufsplan

| Zeit | Phase | Arbeitsschritt (Sachaspekt) | Sozialform | Medien | Didaktischer Kommentar |
|---|---|---|---|---|---|
| 0–8′ (8′) | **Einstieg** | Bild<br>Fragen | UG | Folie | **STUNDENERÖFFNUNG** – FLZ 1. Heikel |
| 8–40′ (32′) | Erarbeitung<br>Teil 2 | Text | EA | AB | FLZ 2 |
| 40-90' (50') | Sicherung | Tafel | UG | Tafel | FLZ 3 |

Rest`;

describe('Verlaufsplan', () => {
  it('liest Zeit und Phase und lässt Kommentare weg', () => {
    expect(parsePlan(PLAN)).toEqual([
      { from: 0, to: 8, phase: 'Einstieg' },
      { from: 8, to: 40, phase: 'Erarbeitung' },
      { from: 40, to: 90, phase: 'Sicherung' },
    ]);
  });

  it('findet nichts in Notizen ohne Verlaufsplan', () => {
    expect(parsePlan('| A | B |\n|---|---|\n| 1 | 2 |')).toEqual([]);
    expect(parsePlan('Kein Plan')).toEqual([]);
  });

  it('zeigt die laufende Phase und das Ende', () => {
    const rows = parsePlan(PLAN);
    expect(planLabel(rows, 3)).toBe('Min. 3 · Einstieg, bis 8′');
    expect(planLabel(rows, 8)).toBe('Min. 8 · Erarbeitung, bis 40′');
    expect(planLabel(rows, 95)).toBe('Min. 95 · Planende überschritten');
  });
});

describe('Zeile „Digital“', () => {
  it('nimmt PDFs in Backticks und Links, nichts für die Lehrkraft', () => {
    const note = '> **Drucken:** –\n> **Digital:** `Folien DS1.pdf` · [[Tafelbilder DS1.pdf|Tafel]] · `Lehrerhand DS1.pdf` · `AB Lösung.pdf` · Film\n> **Dabei:** `Buch.pdf`';
    expect(digitalPdfNames(note)).toEqual(['Folien DS1.pdf', 'Tafelbilder DS1.pdf']);
  });

  it('kommt ohne die Zeile aus', () => {
    expect(digitalPdfNames('Text `a.pdf`')).toEqual([]);
  });
});

describe('Zeilenzählung', () => {
  const item = (text: string, x: number, y: number, width = 0.01): TextItem => ({ text, x, y, width });
  const column = [5, 10, 15, 20].map((n) => item(String(n), 0.08, 0.1 + n * 0.02));
  const body = [item('Text der Zeile', 0.12, 0.2, 0.7), item('weiter', 0.12, 0.3, 0.75)];

  it('rechnet die Lage auch zwischen den Marken aus', () => {
    const band = findLineBand([...column, ...body], 8);
    expect(band?.y).toBeCloseTo(0.1 + 8 * 0.02 - 0.02 * 0.85);
    expect(band?.x).toBeCloseTo(0.08);
    expect(band?.width).toBeCloseTo(0.87 - 0.08);
  });

  it('lässt sich nicht von anderen Zahlen auf der Seite täuschen', () => {
    const noise = [item('10', 0.5, 0.9), item('2026', 0.1, 0.02), item('15', 0.7, 0.05)];
    expect(findLineBand([...noise, ...column, ...body], 10)?.x).toBeCloseTo(0.08);
  });

  it('hält die Punktespalte einer Tabelle nicht für eine Zählung', () => {
    const table = [item('5', 0.42, 0.34), item('10', 0.42, 0.78), item('15', 0.42, 0.87)];
    expect(findLineBand([...table, item('Text', 0.5, 0.5, 0.3)], 7)).toBeNull();
  });

  it('gibt ohne Zählung oder außerhalb des Textes nichts zurück', () => {
    expect(findLineBand(body, 5)).toBeNull();
    expect(findLineBand([...column, ...body], 500)).toBeNull();
  });
});

describe('Verweildauer', () => {
  it('nennt nur Folien ab einer Minute', () => {
    expect(formatDwell([{ label: 'S. 1', ms: 240_000 }, { label: 'S. 2', ms: 5_000 }, { label: 'S. 3', ms: 720_000 }])).toBe('Verweildauer: S. 1 4′ · S. 3 12′');
    expect(formatDwell([{ label: 'S. 1', ms: 5_000 }])).toBe('');
  });
});

describe('Name eines Tintenstands', () => {
  it('passt in einen Dateinamen', () => {
    expect(groupSlug('8a Geschichte')).toBe('8a-geschichte');
    expect(groupSlug('  Q2 ZK / Müller ')).toBe('q2-zk-mueller');
  });
});

describe('Timer nach dem Ablauf', () => {
  it('zählt die Überzeit', () => {
    let time = 0;
    const timer = new CountdownTimer(1, () => time);
    timer.start();
    time = 60_000 + 80_000;
    expect(timer.overtime).toBe(80_000);
    expect(formatOvertime(timer.overtime)).toBe('+1:20');
  });
});

describe('Abdeckungen', () => {
  const stored = () => {
    const session = new PresentationSession(2);
    session.slides[0].covers.push({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    return session;
  };

  it('werden gespeichert und sind allein Grund für eine Datei', () => {
    const text = serializeSession(stored(), 'a.pdf') as string;
    const restored = restoreSession(parseInkFile(text), 2).session;
    expect(restored.slides[0].covers).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }]);
    expect(serializeSession(restored, 'a.pdf')).toBe(text);
  });

  it('bleiben nach „Alle Tinte löschen“, das sind vorbereitete Stunden', () => {
    const session = stored();
    session.clearAllInk();
    expect(session.slides[0].covers).toHaveLength(1);
    expect(session.hasClearable()).toBe(false);
  });

  it('werden beim Zusammenführen nicht verdoppelt', () => {
    const session = stored();
    const other = stored();
    other.slides[1].covers.push({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
    mergeInkFile(session, parseInkFile(serializeSession(other, 'a.pdf') as string), 2);
    expect(session.slides[0].covers).toHaveLength(1);
    expect(session.slides[1].covers).toHaveLength(1);
  });
});

describe('Als PDF sichern', () => {
  it('übernimmt Seiten und leere Seiten, gesperrte bleiben draußen', async () => {
    const source = await PDFDocument.create();
    source.addPage([800, 450]);
    source.addPage([800, 450]);
    source.addPage([800, 450]);
    const bytes = await source.save();

    const session = new PresentationSession(3);
    const stroke = { kind: 'pen' as const, color: '#d92626', width: 0.003, penType: 'ball' as const, points: Array.from({ length: 20 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.2, p: 0.5, w: 0.003 })) };
    session.slides[0].ink.add(stroke);
    session.slides[0].ink.add({ kind: 'marker', color: '#ffe14d', width: 0.02, points: stroke.points });
    session.slides[0].ink.add({ kind: 'pen', color: '#111111', width: 0.003, sharp: true, points: stroke.points.slice(0, 2) });
    session.setLocked(1, true);
    session.insertBlankAfter(2, 0.75);

    const exported = await PDFDocument.load(await exportWithInk(bytes, session));
    expect(exported.getPageCount()).toBe(3);
    expect(exported.getPage(0).getWidth()).toBe(800);
    expect(exported.getPage(2).getHeight()).toBe(600);
  });
});
