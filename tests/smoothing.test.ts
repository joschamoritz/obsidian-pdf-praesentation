import { describe, expect, it } from 'vitest';
import { outlinePoints, stabilizedPoints, stabilizerSigma, type InkPoint, type Stroke } from '../src/presenter/ink';
import { parseInkFile, restoreSession, serializeSession } from '../src/presenter/inkFile';
import { normalizePreferences, PresentationSession } from '../src/presenter/session';

/** Eine waagerechte Linie mit Zittern quer zur Schreibrichtung, so wie eine unruhige Hand. Im Zoom ist beides feiner. */
function wobbly(step = 0.0015, count = 60): InkPoint[] {
  return Array.from({ length: count }, (_, i) => ({ x: 0.1 + i * step, y: 0.2 + Math.sin(i * 1.7) * step * 0.8, p: 0.5, w: 0.003 }));
}
const spread = (points: InkPoint[]) => {
  const inner = points.slice(8, -8).map((point) => point.y);
  return Math.max(...inner) - Math.min(...inner);
};
const pen = (points: InkPoint[], smoothing?: Stroke['smoothing']): Stroke => ({ kind: 'pen', color: '#000', width: 0.003, penType: 'ball', smoothing, points });

describe('Glättung wie ein Stabilisator', () => {
  it('nimmt das Zittern, stark mehr als leicht', () => {
    const points = wobbly();
    const light = stabilizedPoints(points, stabilizerSigma(pen(points, 'light')));
    const strong = stabilizedPoints(points, stabilizerSigma(pen(points, 'strong')));
    expect(spread(light)).toBeLessThan(spread(points) * 0.6);
    expect(spread(strong)).toBeLessThan(spread(light));
  });

  it('lässt Anfang und Ende stehen, damit die Spitze beim Schreiben am Stift bleibt', () => {
    const points = wobbly();
    const smooth = stabilizedPoints(points, 0.004);
    expect(smooth[0]).toEqual(points[0]);
    expect(smooth[smooth.length - 1]).toEqual(points[points.length - 1]);
    expect(smooth).toHaveLength(points.length);
  });

  it('ändert die gespeicherten Punkte nicht', () => {
    const points = wobbly();
    const copy = JSON.parse(JSON.stringify(points));
    outlinePoints(pen(points, 'strong'));
    expect(points).toEqual(copy);
  });

  it('ältere Striche ohne Angabe und gerade Formen bleiben, wie sie waren', () => {
    const points = wobbly();
    expect(stabilizerSigma(pen(points))).toBe(0);
    expect(stabilizerSigma(pen(points, 'off'))).toBe(0);
    expect(stabilizerSigma({ ...pen(points, 'strong'), sharp: true })).toBe(0);
    expect(outlinePoints(pen(points))).toEqual(outlinePoints(pen(points, 'off')));
  });

  it('im Zoom Geschriebenes wird feiner geglättet', () => {
    const normal = stabilizerSigma(pen(wobbly(0.0015), 'light'));
    const zoomed = stabilizerSigma(pen(wobbly(0.0002), 'light'));
    expect(zoomed).toBeLessThan(normal / 2);
  });
});

describe('Glättung in Datei und Einstellungen', () => {
  it('wird je Strich gespeichert und gelesen', () => {
    const session = new PresentationSession(1);
    session.slides[0].ink.add(pen(wobbly(), 'strong'));
    session.slides[0].ink.add(pen(wobbly()));
    const text = serializeSession(session, 'a.pdf') as string;
    const strokes = restoreSession(parseInkFile(text), 1).session.slides[0].ink.strokes;
    expect(strokes[0].smoothing).toBe('strong');
    expect(strokes[1].smoothing).toBeUndefined();
  });

  it('neue Striche sind leicht geglättet, Unbrauchbares fällt darauf zurück', () => {
    expect(normalizePreferences({}).penSmoothing).toBe('light');
    expect(normalizePreferences({ penSmoothing: 'sehr' }).penSmoothing).toBe('light');
    expect(normalizePreferences({ penSmoothing: 'off' }).penSmoothing).toBe('off');
  });
});
