import { describe, expect, it } from 'vitest';
import type { InkPoint, Stroke } from '../src/presenter/ink';
import { recolorStrokes, scaleStrokes } from '../src/presenter/lasso';
import { laserTrail } from '../src/presenter/laser';
import { insertReflection } from '../src/presenter/lessonData';
import { normalizePreferences } from '../src/presenter/session';
import { recognizeShape } from '../src/presenter/shapeRecognition';

const point = (x: number, y: number): InkPoint => ({ x, y, p: 0.5, w: 0.003 });
const shaky = (i: number) => Math.sin(i * 2.3) * 0.0008;

function path(corners: number[][], steps = 20): InkPoint[] {
  const points: InkPoint[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const [ax, ay] = corners[c];
      const [bx, by] = corners[c + 1];
      points.push(point(ax + (bx - ax) * t + shaky(i), ay + (by - ay) * t + shaky(i + 5)));
    }
  }
  const [lx, ly] = corners[corners.length - 1];
  points.push(point(lx, ly));
  return points;
}

describe('Zeichnen und halten: Dreieck und Pfeil', () => {
  it('erkennt ein Dreieck mit seinen Ecken', () => {
    const shape = recognizeShape(path([[0.3, 0.2], [0.4, 0.38], [0.2, 0.38], [0.3, 0.2]]));
    expect(shape?.type).toBe('triangle');
    if (shape?.type !== 'triangle') return;
    expect(shape.points).toHaveLength(4);
    expect(shape.points[0]).toEqual(shape.points[3]);
  });

  it('ein Rechteck bleibt ein Rechteck', () => {
    expect(recognizeShape(path([[0.2, 0.2], [0.4, 0.2], [0.4, 0.3], [0.2, 0.3], [0.2, 0.2]]))?.type).toBe('rectangle');
  });

  it('erkennt einen Pfeil in einem Zug: Schaft, dann ein Haken zurück', () => {
    const shape = recognizeShape(path([[0.1, 0.5], [0.4, 0.5], [0.36, 0.47]]));
    expect(shape?.type).toBe('arrow');
    expect(shape?.end.x).toBeCloseTo(0.4, 2);
  });

  it('auch mit beiden Haken', () => {
    expect(recognizeShape(path([[0.1, 0.5], [0.4, 0.5], [0.36, 0.47], [0.4, 0.5], [0.36, 0.53]]))?.type).toBe('arrow');
  });

  it('ein Haken nach vorn ist kein Pfeil, ein Haken am krummen Schaft auch nicht', () => {
    expect(recognizeShape(path([[0.1, 0.5], [0.4, 0.5], [0.44, 0.47]]))?.type).not.toBe('arrow');
    expect(recognizeShape(path([[0.1, 0.5], [0.25, 0.42], [0.4, 0.5], [0.36, 0.47]]))?.type).not.toBe('arrow');
  });
});

describe('Lasso: Größe und Farbe', () => {
  const stroke: Stroke = { kind: 'pen', color: '#000', width: 0.004, penType: 'ball', points: [point(0.2, 0.2), point(0.3, 0.25)] };

  it('vergrößert um die Ecke oben links, Strichstärke wächst mit', () => {
    const [scaled] = scaleStrokes([stroke], 0.2, 0.2, 2);
    expect(scaled.points[1].x).toBeCloseTo(0.4);
    expect(scaled.points[1].y).toBeCloseTo(0.3);
    expect(scaled.points[1].w).toBeCloseTo(0.006);
    expect(scaled.width).toBeCloseTo(0.008);
    expect(stroke.points[1].x).toBe(0.3);
  });

  it('färbt um, ohne die Punkte anzufassen', () => {
    const [colored] = recolorStrokes([stroke], '#d92626');
    expect(colored.color).toBe('#d92626');
    expect(colored.points).toBe(stroke.points);
  });
});

describe('Laserspur', () => {
  const points = [0, 100, 200, 300].map((time, i) => ({ x: 0.1 + i * 0.05, y: 0.2, time }));

  it('ohne Halten wird der Schweif zum Ende dünner', () => {
    const trail = laserTrail(points, 300, false);
    expect(trail[0][2]).toBeLessThan(trail[3][2]);
  });

  it('mit Halten bleibt auch die älteste Stelle sichtbar', () => {
    const trail = laserTrail(points, 60_000, true);
    expect(Math.min(...trail.map((entry) => entry[2]))).toBeGreaterThan(0.3);
  });

  it('Stärke Mittel ist voreingestellt, Unbrauchbares fällt darauf zurück', () => {
    expect(normalizePreferences({}).laserSize).toBe('medium');
    expect(normalizePreferences({ laserSize: 'riesig' }).laserSize).toBe('medium');
    expect(normalizePreferences({ laserSize: 'thin' }).laserSize).toBe('thin');
  });

  it('Halten ist voreingestellt', () => {
    expect(normalizePreferences({}).laserHold).toBe(true);
    expect(normalizePreferences({ laserHold: 'ja' }).laserHold).toBe(true);
    expect(normalizePreferences({ laserHold: false }).laserHold).toBe(false);
  });
});

describe('Nach der Stunde', () => {
  const NOTE = [
    '# DS 3',
    '',
    '## Material',
    'Text',
    '',
    '## Reflexion & Notizen',
    '',
    '### Was hat gut funktioniert?',
    '',
    '',
    '### Was würde ich beim nächsten Mal ändern?',
    '',
    '',
    '### Besondere Beobachtungen zur Lerngruppe',
    '',
  ].join('\n');

  it('schreibt unter die passenden Überschriften und lässt leere Felder leer', () => {
    const result = insertReflection(NOTE, { good: 'Einstieg mit Bild', change: '', observe: 'Gruppe 2 schnell fertig' }, 'Verweildauer: S. 1 4′');
    const lines = result.split('\n');
    const good = lines.indexOf('### Was hat gut funktioniert?');
    expect(lines[good + 1]).toBe('Einstieg mit Bild');
    const change = lines.indexOf('### Was würde ich beim nächsten Mal ändern?');
    expect(lines.slice(change + 1, change + 3).join('')).toBe('');
    expect(lines[lines.indexOf('### Besondere Beobachtungen zur Lerngruppe') + 1]).toBe('Gruppe 2 schnell fertig');
    expect(lines[lines.indexOf('## Reflexion & Notizen') + 2]).toBe('Verweildauer: S. 1 4′');
    expect(result.startsWith('# DS 3\n\n## Material\nText\n')).toBe(true);
  });

  it('hängt an vorhandenen Text an und trägt die Verweildauer nur einmal ein', () => {
    const once = insertReflection(NOTE, { good: 'Erster Punkt', change: '', observe: '' }, 'Verweildauer: S. 1 4′');
    const twice = insertReflection(once, { good: 'Zweiter Punkt', change: '', observe: '' }, 'Verweildauer: S. 1 4′');
    const lines = twice.split('\n');
    const good = lines.indexOf('### Was hat gut funktioniert?');
    expect(lines.slice(good + 1, good + 4)).toEqual(['Erster Punkt', '', 'Zweiter Punkt']);
    expect(lines.filter((line) => line.startsWith('Verweildauer')).length).toBe(1);
  });

  it('ein Trennstrich mit Verweisen darunter bleibt am Ende', () => {
    const note = NOTE + '\n---\nGehört zu: [[Reihe]]\n';
    const result = insertReflection(note, { good: '', change: '', observe: 'Beobachtung' });
    const lines = result.split('\n');
    expect(lines[lines.indexOf('### Besondere Beobachtungen zur Lerngruppe') + 1]).toBe('Beobachtung');
    expect(result.endsWith('---\nGehört zu: [[Reihe]]\n')).toBe(true);
  });

  it('behält die Zeilenenden der Notiz', () => {
    const crlf = NOTE.replace(/\n/g, '\r\n');
    const result = insertReflection(crlf, { good: 'gut', change: '', observe: '' });
    expect(result.includes('gut')).toBe(true);
    expect(result.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('legt den Abschnitt an, wenn er fehlt, und lässt Leerzeilen anderswo stehen', () => {
    const note = '# Notiz\n\n\n\nAbsatz mit Abstand\n';
    const result = insertReflection(note, { good: 'gut', change: 'anders', observe: '' });
    expect(result.startsWith('# Notiz\n\n\n\nAbsatz mit Abstand')).toBe(true);
    expect(result).toContain('## Reflexion & Notizen');
    expect(result.split('\n')[result.split('\n').indexOf('### Was würde ich beim nächsten Mal ändern?') + 1]).toBe('anders');
  });
});
