import { describe, expect, it } from 'vitest';
import { appendPoint, cleanStroke, smoothedPoints, type Stroke } from '../src/presenter/ink';
import { SampleFilter, type PenSample } from '../src/presenter/samples';

const sample = (time: number, x: number, y = 0): PenSample => ({ timeStamp: time, clientX: x, clientY: y });

/** Anteil der Schritte, die gegen den vorigen Schritt laufen */
function backwardShare(points: { x: number; y: number }[]): number {
  let back = 0;
  for (let i = 2; i < points.length; i++) {
    const dot =
      (points[i].x - points[i - 1].x) * (points[i - 1].x - points[i - 2].x) +
      (points[i].y - points[i - 1].y) * (points[i - 1].y - points[i - 2].y);
    if (dot < 0) back++;
  }
  return back / Math.max(1, points.length - 2);
}

/** Echter Strich vom iPad, in CSS-Pixeln bei 1180 Punkten Seitenbreite, ungefiltert gespeichert in v0.5 */
const REAL_IPAD: [number, number][] = [
  [555, 386.5], [554, 386], [555, 386.5], [554, 386], [553, 386], [554, 386], [553, 386], [552, 385.49], [551, 386.5],
  [550.51, 387.5], [550, 389], [550.51, 387.5], [550, 389], [549.5, 390.5], [549, 392], [549.5, 390.5], [549, 392],
  [549, 393.49], [549, 394.5], [549.5, 395.5], [549, 393.49], [549, 394.5], [549.5, 395.5], [550.51, 396.5], [552, 397],
  [550, 396], [551, 397], [552, 397], [553, 397], [554.51, 397], [555.5, 397], [553, 397], [554.51, 397], [555.5, 397],
  [556.5, 396.5], [557.5, 396], [558.51, 395], [556.5, 396.5], [557.5, 396], [558.51, 395], [559.5, 394], [560, 393],
  [559.5, 394], [560, 393], [560.5, 391.5], [560.5, 390.5], [560.5, 391.5], [560.5, 390.5], [559.5, 390], [560.5, 390.5],
  [559.5, 390], [558.51, 390], [559.5, 390], [558.51, 390], [558, 391], [558.51, 390], [558, 391], [557.5, 392],
  [557.5, 391], [557.5, 392], [557.5, 393], [557.5, 394], [557.5, 392.5], [557.5, 393.49], [557.5, 394.5], [557.5, 395.5],
  [557.5, 394.5], [557.5, 395.5], [557.5, 396.5], [558, 397.49],
];

const realStroke = (): Stroke => ({
  kind: 'pen',
  color: '#000',
  width: 0.003,
  penType: 'ball',
  points: REAL_IPAD.map(([x, y]) => ({ x: x / 1180, y: y / 1180, p: 0.2, w: 0.003 })),
});

describe('SampleFilter', () => {
  it('lässt überlappende Listen mit eigenen Zeiten nur einmal durch', () => {
    const filter = new SampleFilter<PenSample>();
    filter.start(sample(0, 0));
    const a = sample(1, 1);
    const b = sample(2, 2);
    const c = sample(3, 3);
    const d = sample(4, 4);
    expect(filter.fresh([a, b], b)).toEqual([a, b]);
    expect(filter.fresh([a, b, c], c)).toEqual([c]);
    expect(filter.fresh([b, c, d], d)).toEqual([d]);
  });

  it('verwirft auch neu geschätzte Positionen mit alter Zeit', () => {
    const filter = new SampleFilter<PenSample>();
    filter.start(sample(0, 0));
    filter.fresh([sample(1, 1), sample(2, 2)], sample(2, 2));
    expect(filter.fresh([sample(2, 1.5), sample(3, 3)], sample(3, 3)).map((s) => s.clientX)).toEqual([3]);
  });

  it('erkennt Wiederholungen an der Position, wenn alle Punkte dieselbe Zeit tragen', () => {
    const filter = new SampleFilter<PenSample>();
    filter.start(sample(0, 0));
    filter.fresh([sample(5, 1), sample(5, 2)], sample(5, 2));
    expect(filter.fresh([sample(6, 1), sample(6, 2), sample(6, 3)], sample(6, 3)).map((s) => s.clientX)).toEqual([3]);
  });

  it('nimmt das Ereignis selbst, wenn die Liste leer ist, und wiederholt es nicht', () => {
    const filter = new SampleFilter<PenSample>();
    filter.start(sample(0, 0));
    expect(filter.fresh([], sample(1, 5))).toHaveLength(1);
    expect(filter.fresh([], sample(2, 5))).toHaveLength(0);
    expect(filter.fresh([], sample(3, 6))).toHaveLength(1);
  });

  it('ein neuer Strich fängt von vorn an, auch an derselben Stelle', () => {
    const filter = new SampleFilter<PenSample>();
    filter.start(sample(10, 1));
    filter.fresh([sample(11, 2)], sample(11, 2));
    filter.start(sample(20, 5));
    expect(filter.fresh([sample(21, 2)], sample(21, 2))).toHaveLength(1);
  });
});

describe('Rücklauf im Strich', () => {
  it('der echte iPad-Strich läuft roh ständig rückwärts, aufgeräumt kaum noch', () => {
    const stroke = realStroke();
    expect(backwardShare(stroke.points)).toBeGreaterThan(0.3);
    const cleaned = cleanStroke(stroke);
    expect(backwardShare(cleaned.points)).toBeLessThan(0.05);
    // Die Form bleibt: Der Strich endet weiter an derselben Stelle und deckt denselben Bereich.
    const xs = (points: { x: number }[]) => points.map((point) => point.x);
    expect(Math.max(...xs(cleaned.points))).toBeCloseTo(Math.max(...xs(stroke.points)), 2);
    expect(Math.min(...xs(cleaned.points))).toBeCloseTo(Math.min(...xs(stroke.points)), 2);
    expect(cleaned.points[cleaned.points.length - 1].y).toBeCloseTo(397.49 / 1180, 3);
  });

  it('ein echter Richtungswechsel über mehr als ein paar Pixel bleibt erhalten', () => {
    const stroke: Stroke = { kind: 'pen', color: '#000', width: 0.003, penType: 'ball', points: [] };
    for (let i = 0; i < 30; i++) appendPoint(stroke, 0.1 + i * 0.002, 0.2, 0.5);
    for (let i = 1; i < 30; i++) appendPoint(stroke, 0.158 - i * 0.002, 0.2, 0.5);
    const xs = stroke.points.map((point) => point.x);
    expect(Math.max(...xs)).toBeCloseTo(0.158, 3);
    expect(xs[xs.length - 1]).toBeCloseTo(0.1, 3);
  });

  it('im Zoom Geschriebenes behält seine kleinen Bewegungen', () => {
    const stroke: Stroke = { kind: 'pen', color: '#000', width: 0.003, penType: 'ball', points: [] };
    for (let i = 0; i < 10; i++) appendPoint(stroke, 0.1 + i * 0.0003, 0.2, 0.5, 6);
    const before = stroke.points.length;
    appendPoint(stroke, 0.1 + 8 * 0.0003 - 0.0006, 0.2, 0.5, 6);
    expect(stroke.points.length).toBe(before + 1);
  });

  it('die Glättung nimmt die Pixelstufen, Anfang und Ende bleiben', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ x: i * 0.001, y: i % 2 ? 0.0004 : 0, p: 0.5, w: 0.003 }));
    const smooth = smoothedPoints(points);
    const jitter = (list: typeof points) => Math.max(...list.slice(3, -3).map((point) => point.y)) - Math.min(...list.slice(3, -3).map((point) => point.y));
    expect(jitter(smooth)).toBeLessThan(jitter(points) * 0.2);
    expect(smooth[0]).toEqual(points[0]);
    expect(smooth[smooth.length - 1]).toEqual(points[points.length - 1]);
  });
});
