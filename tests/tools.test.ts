import { describe, expect, it } from 'vitest';
import { PageInk, type InkPoint, type Stroke } from '../src/presenter/ink';
import { insideBounds, moveStrokes, pointInPolygon, replaceStrokes, selectInLasso, selectionBounds } from '../src/presenter/lasso';
import { normalizePreferences, slotMatches } from '../src/presenter/session';
import { recognizeShape } from '../src/presenter/shapeRecognition';
import { soundPlan, TIMER_SOUNDS } from '../src/presenter/sound';
import { readableOn } from '../src/presenter/timer';

const point = (x: number, y: number): InkPoint => ({ x, y, p: 0.5, w: 0.003 });
const pen = (points: InkPoint[]): Stroke => ({ kind: 'pen', color: '#000', width: 0.003, penType: 'ball', points });

/** Von Hand gezogen: etwas Zittern auf jeder Form */
const shaky = (i: number) => Math.sin(i * 2.3) * 0.0012;

describe('Zeichnen und halten', () => {
  it('macht aus einem fast geraden Strich eine Linie', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(0.1 + i * 0.005, 0.3 + i * 0.002 + shaky(i)));
    const shape = recognizeShape(points);
    expect(shape?.type).toBe('line');
    expect(shape?.start).toEqual({ x: points[0].x, y: points[0].y });
  });

  it('erkennt eine Ellipse und ein Rechteck', () => {
    const ellipse = Array.from({ length: 80 }, (_, i) => {
      const angle = (i / 79) * Math.PI * 2;
      return point(0.5 + 0.1 * Math.cos(angle) + shaky(i), 0.4 + 0.05 * Math.sin(angle) + shaky(i + 7));
    });
    expect(recognizeShape(ellipse)?.type).toBe('ellipse');
    // Sauber gezogen, ohne Zittern: Der Weg ist kaum länger als 1,57 × (Breite + Höhe)
    const clean = Array.from({ length: 80 }, (_, i) => point(0.5 + 0.08 * Math.cos((i / 79) * Math.PI * 2), 0.4 + 0.08 * Math.sin((i / 79) * Math.PI * 2)));
    expect(recognizeShape(clean)?.type).toBe('ellipse');

    const corners = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.3], [0.2, 0.3], [0.2, 0.2]];
    const rectangle: InkPoint[] = [];
    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < 20; i++) {
        const t = i / 20;
        const [ax, ay] = corners[c];
        const [bx, by] = corners[c + 1];
        rectangle.push(point(ax + (bx - ax) * t + shaky(i) * 0.5, ay + (by - ay) * t + shaky(i + 3) * 0.5));
      }
    }
    const shape = recognizeShape(rectangle);
    expect(shape?.type).toBe('rectangle');
    expect(shape?.start.x).toBeCloseTo(0.2, 2);
    expect(shape?.end.y).toBeCloseTo(0.3, 2);
  });

  it('lässt Schrift und kleine Buchstaben in Ruhe', () => {
    const word = Array.from({ length: 60 }, (_, i) => point(0.1 + i * 0.001, 0.3 + Math.abs(Math.sin(i / 3)) * 0.012));
    expect(recognizeShape(word)).toBeNull();
    const smallO = Array.from({ length: 30 }, (_, i) => {
      const angle = (i / 29) * Math.PI * 2;
      return point(0.5 + 0.006 * Math.cos(angle), 0.4 + 0.006 * Math.sin(angle));
    });
    expect(recognizeShape(smallO)).toBeNull();
    expect(recognizeShape([point(0.1, 0.1), point(0.105, 0.1)])).toBeNull();
  });
});

describe('Lasso', () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  it('weiß, was innen liegt', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false);
  });

  it('nimmt Striche, die überwiegend im Lasso liegen', () => {
    const inside = pen([point(0.2, 0.2), point(0.3, 0.3), point(0.4, 0.2)]);
    const mostly = pen([point(0.8, 0.5), point(0.9, 0.5), point(1.2, 0.5)]);
    const outside = pen([point(1.2, 0.2), point(1.4, 0.3)]);
    expect(selectInLasso([inside, mostly, outside], square)).toEqual([inside, mostly]);
    expect(selectInLasso([inside], square.slice(0, 2))).toEqual([]);
  });

  it('verschiebt mit neuen Strichen und behält die Reihenfolge', () => {
    const a = pen([point(0.1, 0.1), point(0.2, 0.1)]);
    const b = pen([point(0.5, 0.5), point(0.6, 0.5)]);
    const c = pen([point(0.7, 0.7), point(0.8, 0.7)]);
    const moved = moveStrokes([b], 0.1, -0.1);
    expect(moved[0]).not.toBe(b);
    expect(moved[0].points[0]).toMatchObject({ x: 0.6, y: 0.4 });
    expect(b.points[0]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(replaceStrokes([a, b, c], [b], moved)).toEqual([a, moved[0], c]);
  });

  it('kennt den Rahmen der Auswahl', () => {
    const bounds = selectionBounds([pen([point(0.1, 0.2), point(0.3, 0.4)])]);
    expect(bounds?.minX).toBeCloseTo(0.1 - 0.0015);
    expect(bounds?.maxY).toBeCloseTo(0.4 + 0.0015);
    expect(insideBounds({ x: 0.2, y: 0.3 }, bounds!, 0)).toBe(true);
    expect(insideBounds({ x: 0.5, y: 0.3 }, bounds!, 0.01)).toBe(false);
    expect(selectionBounds([])).toBeNull();
  });

  it('Verschieben über viele Bilder ist ein Schritt für Rückgängig, Löschen auch', () => {
    const ink = new PageInk();
    const a = pen([point(0.1, 0.1), point(0.2, 0.1)]);
    ink.add(a);
    ink.beginChange();
    ink.setStrokes(moveStrokes([a], 0.01, 0));
    ink.setStrokes(moveStrokes([a], 0.05, 0));
    ink.endChange();
    expect(ink.strokes[0].points[0].x).toBeCloseTo(0.15);
    ink.replace([]);
    expect(ink.strokes).toEqual([]);
    ink.undo();
    expect(ink.strokes[0].points[0].x).toBeCloseTo(0.15);
    ink.undo();
    expect(ink.strokes).toEqual([a]);
  });
});

describe('Timer am Ende', () => {
  it('jeder Ton außer „Aus“ klingt, und nicht länger als ein paar Sekunden', () => {
    for (const { sound } of TIMER_SOUNDS) {
      const tones = soundPlan(sound);
      if (sound === 'off') {
        expect(tones).toEqual([]);
        continue;
      }
      expect(tones.length).toBeGreaterThan(0);
      expect(Math.max(...tones.map((tone) => tone.at + tone.duration))).toBeLessThan(5);
      expect(tones.every((tone) => tone.gain > 0 && tone.gain <= 0.5 && tone.frequency > 50)).toBe(true);
    }
  });

  it('Schrift auf der Timerfarbe bleibt lesbar', () => {
    expect(readableOn('#141416')).toBe('#fff');
    expect(readableOn('#ffffff')).toBe('#111');
    expect(readableOn('#1f4fa8')).toBe('#fff');
    expect(readableOn('kaputt')).toBe('#fff');
  });

  it('Farbe, Effekt und Ton fallen bei Unbrauchbarem auf die Vorgabe zurück', () => {
    const p = normalizePreferences({ timerColor: 'rot', timerEffect: 'feuerwerk', timerSound: 'trompete' });
    expect(p.timerColor).toBe('#141416');
    expect(p.timerEffect).toBe('blink');
    expect(p.timerSound).toBe('off');
  });
});

describe('Stiftablage', () => {
  it('hat immer vier Fächer, anfangs aus den Schnellfarben', () => {
    const p = normalizePreferences({ quickPen: ['#111111', '#d92626'], penWidth: 0.004 });
    expect(p.penSlots).toHaveLength(4);
    expect(p.penSlots.map((slot) => slot.color)).toEqual(['#111111', '#d92626', '#111111', '#d92626']);
    expect(p.penSlots[0].width).toBe(0.004);
  });

  it('behält gespeicherte Fächer und verwirft kaputte', () => {
    const good = { color: '#1f5fd6', penType: 'fountain', width: 0.006, smoothing: 'strong' };
    const p = normalizePreferences({ penSlots: [good, { color: 3 }], penSlot: 9 });
    expect(p.penSlots[0]).toEqual(good);
    expect(p.penSlots).toHaveLength(4);
    expect(p.penSlot).toBe(0);
  });

  it('erkennt, welches Fach gerade in der Hand ist', () => {
    const p = normalizePreferences({});
    const slot = { color: p.penColor, penType: p.penType, width: p.penWidth, smoothing: p.penSmoothing };
    expect(slotMatches(slot, p)).toBe(true);
    expect(slotMatches({ ...slot, penType: 'brush' }, p)).toBe(false);
  });
});
