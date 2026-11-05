import { describe, expect, it } from 'vitest';
import { appendPoint, eraseFromStroke, outlinePoints, PageInk, shapePoints, strokeHit, widthAt, type Stroke } from '../src/presenter/ink';
import {
  normalizePreferences,
  PresentationSession,
  sliderToWidth,
  WIDTH_RANGES,
  widthToSlider,
  withCustomColor,
  withQuickColor,
} from '../src/presenter/session';
import { clampView, fitSheet, keyZoomFactor, rasterWidth, snapSize, snapView, visibleRegion, wheelAction, zoomAround } from '../src/presenter/view';

function stroke(...points: [number, number][]): Stroke {
  return { kind: 'pen', color: '#000', width: 0.002, points: points.map(([x, y]) => ({ x, y, p: 0.5, w: 0.002 })) };
}

describe('Stiftarten', () => {
  const pen = (penType: Stroke['penType']): Stroke => ({ kind: 'pen', color: '#000', width: 0.01, penType, points: [] });

  it('der Fineliner bleibt gleich breit, der Pinsel reagiert am stärksten auf Druck', () => {
    expect(widthAt(pen('fineliner'), 0.1)).toBe(widthAt(pen('fineliner'), 0.9));
    const spread = (type: Stroke['penType']) => widthAt(pen(type), 0.9) / widthAt(pen(type), 0.1);
    expect(spread('brush')).toBeGreaterThan(spread('fountain'));
    expect(spread('fountain')).toBeGreaterThan(spread('ball'));
  });

  it('der Füller wird quer zur Feder breit und längs zur Feder schmal', () => {
    const across = widthAt(pen('fountain'), 0.5, 1, 1);
    const along = widthAt(pen('fountain'), 0.5, 1, -1);
    expect(across).toBeGreaterThan(along * 2);
  });

  it('Formen und Marker behalten ihre Breite', () => {
    expect(widthAt({ ...pen('brush'), kind: 'marker' }, 0.9)).toBe(0.01);
    expect(widthAt({ ...pen('brush'), sharp: true }, 0.9)).toBe(0.01);
  });

  it('die Breite springt zwischen zwei Punkten nicht', () => {
    const s = pen('brush');
    appendPoint(s, 0, 0, 0);
    appendPoint(s, 0.05, 0, 1);
    const jump = widthAt(s, 1) - s.points[0].w;
    expect(s.points[1].w - s.points[0].w).toBeLessThan(jump);
  });
});

describe('Teilradierer', () => {
  it('teilt einen Strich in zwei Stücke und lässt das Original unverändert', () => {
    const s = stroke([0, 0.5], [1, 0.5]);
    const pieces = eraseFromStroke(s, 0.5, 0.5, 0.05);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].points.every((point) => point.x < 0.45)).toBe(true);
    expect(pieces[1].points.every((point) => point.x > 0.55)).toBe(true);
    expect(s.points).toHaveLength(2);
  });

  it('entfernt einen ganz getroffenen Strich', () => {
    expect(eraseFromStroke(stroke([0.5, 0.5], [0.51, 0.5]), 0.5, 0.5, 0.05)).toEqual([]);
  });

  it('lässt sich als ein Schritt zurücknehmen', () => {
    const ink = new PageInk();
    const s = stroke([0, 0.5], [1, 0.5]);
    ink.add(s);
    ink.beginErase();
    ink.eraseAt(0.3, 0.5, 0.05, true);
    ink.eraseAt(0.7, 0.5, 0.05, true);
    ink.endErase();
    expect(ink.strokes).toHaveLength(3);
    ink.undo();
    expect(ink.strokes).toEqual([s]);
  });
});

describe('Formen', () => {
  const start = { x: 0.1, y: 0.1 };
  const end = { x: 0.5, y: 0.3 };

  it('schließt Rechteck und Ellipse', () => {
    for (const type of ['rectangle', 'ellipse'] as const) {
      const points = shapePoints(type, start, end, 0.003);
      expect(points[0].x).toBeCloseTo(points[points.length - 1].x);
      expect(points[0].y).toBeCloseTo(points[points.length - 1].y);
    }
  });

  it('der Pfeil endet mit der Spitze am Zielpunkt', () => {
    const points = shapePoints('arrow', start, end, 0.003);
    expect(points[1]).toMatchObject(end);
    expect(points[3]).toMatchObject(end);
    expect(points).toHaveLength(5);
  });

  it('die Ellipse bleibt im aufgezogenen Rechteck', () => {
    for (const point of shapePoints('ellipse', start, end, 0.003)) {
      expect(point.x).toBeGreaterThanOrEqual(start.x - 1e-9);
      expect(point.x).toBeLessThanOrEqual(end.x + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(start.y - 1e-9);
      expect(point.y).toBeLessThanOrEqual(end.y + 1e-9);
    }
  });
});

describe('Einstellungen', () => {
  it('der Regler trifft beide Enden und findet seinen Wert wieder', () => {
    expect(sliderToWidth('pen', 0)).toBeCloseTo(WIDTH_RANGES.pen.min);
    expect(sliderToWidth('pen', 1)).toBeCloseTo(WIDTH_RANGES.pen.max);
    expect(widthToSlider('marker', sliderToWidth('marker', 0.37))).toBeCloseTo(0.37);
  });

  it('übernimmt alte Einstellungen vom iPad, verwirft Unbrauchbares', () => {
    const stored = { tool: 'pen', widthStep: 1, penColor: '#d92626', penWidth: 'dick', quickPen: null };
    const preferences = normalizePreferences(stored);
    expect(preferences.penColor).toBe('#d92626');
    expect(preferences.penWidth).toBeGreaterThan(0);
    expect(preferences.quickPen).toHaveLength(4);
    expect(normalizePreferences({ tool: 'gibtsnicht' }).tool).toBe('pen');
    expect(normalizePreferences(null).tool).toBe('pen');
  });

  it('eine neue Schnellfarbe ersetzt nur die letzte', () => {
    expect(withQuickColor(['a', 'b', 'c', 'd'], 'x')).toEqual(['a', 'b', 'c', 'x']);
    expect(withQuickColor(['a', 'b', 'c', 'd'], 'b')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('merkt sich höchstens sechs eigene Farben ohne Doppelte', () => {
    expect(withCustomColor(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(withCustomColor(['1', '2', '3', '4', '5', '6'], 'x')).toEqual(['x', '1', '2', '3', '4', '5']);
  });
});

describe('PageInk', () => {
  it('nimmt das Hinzufügen zurück', () => {
    const ink = new PageInk();
    ink.add(stroke([0, 0]));
    expect(ink.undo()).toBe(true);
    expect(ink.strokes).toHaveLength(0);
    expect(ink.undo()).toBe(false);
  });

  it('stellt Radiertes an alter Stelle wieder her, ein Radiergang zählt als ein Schritt', () => {
    const ink = new PageInk();
    const [a, b, c] = [stroke([0.1, 0.1], [0.2, 0.1]), stroke([0.5, 0.5], [0.6, 0.5]), stroke([0.9, 0.9], [0.95, 0.9])];
    [a, b, c].forEach((s) => ink.add(s));
    ink.beginErase();
    expect(ink.eraseAt(0.15, 0.1, 0.01)).toBe(true);
    expect(ink.eraseAt(0.92, 0.9, 0.01)).toBe(true);
    expect(ink.eraseAt(0.3, 0.3, 0.01)).toBe(false);
    ink.endErase();
    expect(ink.strokes).toEqual([b]);
    ink.undo();
    expect(ink.strokes).toEqual([a, b, c]);
  });

  it('macht "Seite leeren" rückgängig, in alter Reihenfolge', () => {
    const ink = new PageInk();
    const [a, b] = [stroke([0, 0]), stroke([1, 1])];
    ink.add(a);
    ink.add(b);
    ink.clear();
    expect(ink.strokes).toHaveLength(0);
    ink.undo();
    expect(ink.strokes).toEqual([a, b]);
  });

  it('wiederholt Zurückgenommenes, ein neuer Strich beendet das', () => {
    const ink = new PageInk();
    const [a, b] = [stroke([0, 0]), stroke([1, 1])];
    ink.add(a);
    ink.undo();
    expect(ink.canRedo).toBe(true);
    expect(ink.redo()).toBe(true);
    expect(ink.strokes).toEqual([a]);
    ink.undo();
    ink.add(b);
    expect(ink.canRedo).toBe(false);
    expect(ink.strokes).toEqual([b]);
  });

  it('legt für einen Radiergang ohne Treffer keinen Schritt an', () => {
    const ink = new PageInk();
    ink.beginErase();
    ink.eraseAt(0.5, 0.5, 0.01);
    ink.endErase();
    expect(ink.canUndo).toBe(false);
  });
});

describe('Strich', () => {
  it('überspringt Punkte, die zu dicht liegen', () => {
    const s = stroke();
    expect(appendPoint(s, 0.5, 0.5, 0.5)).toBe(true);
    expect(appendPoint(s, 0.50001, 0.5, 0.5)).toBe(false);
    expect(appendPoint(s, 0.51, 0.5, 0.5)).toBe(true);
    expect(s.points).toHaveLength(2);
  });

  it('erkennt Treffer auf der Linie, nicht daneben', () => {
    const s = stroke([0, 0], [1, 0]);
    expect(strokeHit(s, 0.5, 0.005, 0.01)).toBe(true);
    expect(strokeHit(s, 0.5, 0.1, 0.01)).toBe(false);
  });
});

describe('Ansicht', () => {
  const stage = { width: 1024, height: 768 };

  it('passt Querformat und A4 in die Bühne ein', () => {
    expect(fitSheet(stage, 9 / 16)).toEqual({ width: 1024, height: 576 });
    const a4 = fitSheet(stage, Math.SQRT2);
    expect(a4.height).toBeCloseTo(768);
    expect(a4.width).toBeCloseTo(768 / Math.SQRT2);
  });

  it('hält eine kleinere Seite mittig', () => {
    const sheet = fitSheet(stage, 9 / 16);
    expect(clampView({ zoom: 1, x: 500, y: 500 }, sheet, stage)).toEqual({ zoom: 1, x: 0, y: 96 });
  });

  it('lässt beim Zoomen keine Lücke am Rand', () => {
    const sheet = fitSheet(stage, 0.75);
    const view = clampView({ zoom: 2, x: 100, y: -5000 }, sheet, stage);
    expect(view.x).toBe(0);
    expect(view.y).toBe(768 - 1536);
  });

  it('hält den Punkt unter den Fingern beim Zoomen fest', () => {
    const view = zoomAround({ zoom: 1, x: 0, y: 0 }, 200, 100, 2, 0, 0);
    expect(view).toEqual({ zoom: 2, x: -200, y: -100 });
  });

  it('begrenzt den Zoom', () => {
    expect(zoomAround({ zoom: 5, x: 0, y: 0 }, 0, 0, 10, 0, 0).zoom).toBe(6);
    expect(zoomAround({ zoom: 1, x: 0, y: 0 }, 0, 0, 0.1, 0, 0).zoom).toBe(1);
  });

  it('deckelt die Rastergröße', () => {
    const width = rasterWidth(1024, 0.75, 12, 16_000_000);
    expect(width * width * 0.75).toBeLessThanOrEqual(16_100_000);
    expect(rasterWidth(1024, 0.75, 2, 16_000_000)).toBe(2048);
  });
});

describe('Pixelraster und sichtbarer Ausschnitt', () => {
  it('setzt Größe und Lage auf ganze Gerätepixel', () => {
    expect(snapSize({ width: 1160.36, height: 820.2 }, 2)).toEqual({ width: 1160.5, height: 820 });
    expect(snapView({ zoom: 1.3, x: 9.81, y: 22.18 }, 2)).toEqual({ zoom: 1.3, x: 10, y: 22 });
  });

  it('nimmt bei starkem Zoom nur die Bühne, nicht die ganze Seite', () => {
    const stage = { width: 1000, height: 700 };
    const sheet = { width: 1000, height: 700 };
    const region = visibleRegion({ zoom: 6, x: -2000, y: -1000 }, sheet, stage, 2);
    expect(region).toMatchObject({ left: 0, top: 0, width: 2000, height: 1400, pageWidth: 12000, offsetX: -4000, offsetY: -2000 });
  });

  it('endet am Seitenrand, wenn die Seite kleiner ist als die Bühne', () => {
    const region = visibleRegion({ zoom: 1.5, x: 200, y: 0 }, { width: 400, height: 800 }, { width: 1000, height: 800 }, 2);
    expect(region).toMatchObject({ left: 400, width: 1200, height: 1600, offsetX: 0 });
  });
});

describe('Umriss eines Stiftstrichs', () => {
  const stroke = (points: [number, number, number][]): Stroke => ({
    kind: 'pen',
    color: '#000',
    width: 0.004,
    points: points.map(([x, y, w]) => ({ x, y, p: 0.5, w })),
  });
  const line = (width: number): [number, number, number][] =>
    Array.from({ length: 60 }, (_, i) => [0.1 + i * 0.005, 0.2, width]);

  it('ist so breit wie der Strich', () => {
    const outline = outlinePoints(stroke(line(0.004)));
    const ys = outline.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.004, 3);
  });

  it('folgt der Breite je Punkt, damit Füller und Pinsel ihren Charakter behalten', () => {
    const points: [number, number, number][] = Array.from({ length: 80 }, (_, i) => [0.1 + i * 0.005, 0.2, 0.002 + (i / 79) * 0.01]);
    const outline = outlinePoints(stroke(points));
    const heightAt = (from: number, to: number) => {
      const ys = outline.filter(([x]) => x >= from && x <= to).map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(heightAt(0.45, 0.48)).toBeGreaterThan(heightAt(0.12, 0.15) * 2.5);
  });

  it('übersteht Spitzkehren, einzelne Punkte und Punkte an derselben Stelle', () => {
    const cusp: [number, number, number][] = [
      ...Array.from({ length: 20 }, (_, i): [number, number, number] => [0.1 + i * 0.005, 0.2, 0.004]),
      ...Array.from({ length: 20 }, (_, i): [number, number, number] => [0.2 - i * 0.005, 0.2001, 0.004]),
    ];
    for (const points of [cusp, [[0.5, 0.5, 0.004]], [[0.5, 0.5, 0.004], [0.5, 0.5, 0.004]]] as [number, number, number][][]) {
      const outline = outlinePoints(stroke(points));
      expect(outline.length).toBeGreaterThan(0);
      expect(outline.flat().every(Number.isFinite)).toBe(true);
    }
  });

  it('bleibt rechnerisch schnell genug für den laufenden Strich', () => {
    const long: [number, number, number][] = Array.from({ length: 1000 }, (_, i) => [0.1 + Math.sin(i / 20) * 0.1 + i * 0.0005, 0.3 + Math.cos(i / 20) * 0.1, 0.004]);
    const start = performance.now();
    outlinePoints(stroke(long));
    expect(performance.now() - start).toBeLessThan(16);
  });
});

describe('Zoomen am PC', () => {
  const wheel = (deltaY: number, ctrlKey: boolean, deltaX = 0, deltaMode = 0) => ({ deltaX, deltaY, deltaMode, ctrlKey });

  it('Strg + Rad nach vorn zoomt hinein, nach hinten heraus', () => {
    const closer = wheelAction(wheel(-100, true), false);
    const farther = wheelAction(wheel(100, true), true);
    expect(closer).toMatchObject({ type: 'zoom' });
    expect(closer && closer.type === 'zoom' && closer.factor).toBeGreaterThan(1);
    expect(farther && farther.type === 'zoom' && farther.factor).toBeLessThan(1);
  });

  it('eine Raste am Mausrad bleibt ein überschaubarer Schritt, auch als Zeilenangabe', () => {
    for (const event of [wheel(-100, true), wheel(-3, true, 0, 1)]) {
      const action = wheelAction(event, false);
      expect(action && action.type === 'zoom' && action.factor).toBeCloseTo(Math.exp(0.2));
    }
  });

  it('die Trackpad-Geste zoomt in kleinen Schritten', () => {
    const action = wheelAction(wheel(-2, true), false);
    expect(action && action.type === 'zoom' && action.factor).toBeCloseTo(Math.exp(0.02));
  });

  it('ohne Strg verschiebt das Rad nur eine gezoomte Seite und blättert nie', () => {
    expect(wheelAction(wheel(100, false), false)).toBeNull();
    expect(wheelAction(wheel(40, false, 10), true)).toEqual({ type: 'pan', dx: -10, dy: -40 });
    expect(wheelAction(wheel(3, false, 0, 1), true)).toEqual({ type: 'pan', dx: -0, dy: -48 });
  });

  it('die Tasten + und - gleichen sich aus, 0 setzt zurück, andere Tasten zählen nicht', () => {
    expect(keyZoomFactor('+')).toBe(keyZoomFactor('='));
    expect((keyZoomFactor('+') as number) * (keyZoomFactor('-') as number)).toBeCloseTo(1);
    expect(keyZoomFactor('0')).toBe(0);
    expect(keyZoomFactor('a')).toBeNull();
    expect(keyZoomFactor('ArrowRight')).toBeNull();
  });
});

describe('PresentationSession', () => {
  it('fügt leere Seiten ein und entfernt nur diese', () => {
    const session = new PresentationSession(3);
    const position = session.insertBlankAfter(0, 0.75);
    expect(position).toBe(1);
    expect(session.slides.map((slide) => slide.pdfPage)).toEqual([1, null, 2, 3]);
    expect(session.removeBlank(0)).toBe(false);
    session.current = 3;
    expect(session.removeBlank(1)).toBe(true);
    expect(session.slides.map((slide) => slide.pdfPage)).toEqual([1, 2, 3]);
    expect(session.current).toBe(2);
  });

  it('findet PDF-Seiten auch hinter eingefügten Seiten', () => {
    const session = new PresentationSession(3);
    session.insertBlankAfter(0, 0.75);
    expect(session.indexOfPage(3)).toBe(3);
    expect(session.indexOfPage(99)).toBe(0);
  });
});
