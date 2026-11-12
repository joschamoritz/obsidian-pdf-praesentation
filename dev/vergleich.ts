// Zeichnet echte iPad-Striche so, wie sie auf dem iPad erscheinen (Seite 1180 Punkte breit, 2 Pixel
// je Punkt): einmal roh wie in v0.5 und einmal mit Aufräumen und Glätten. Rechts stark vergrößert.
import { getStroke } from 'perfect-freehand';
import { cleanStroke, drawStroke, outlinePoints, type Stroke } from '../src/presenter/ink';
import { parseInkFile, restoreSession } from '../src/presenter/inkFile';

const PAGE_WIDTH_PX = 1180 * 2;

const file = parseInkFile(await (await fetch('/dev/fixtures/ink-ipad.json')).text());
// Version vortäuschen, damit restoreSession nicht schon aufräumt: "vorher" soll roh bleiben.
file.version = 2;
const raw: Stroke[] = restoreSession(file, 40).session.slides[0].ink.strokes.filter((stroke) => stroke.kind === 'pen');

const params = new URLSearchParams(location.search);
const start = Number(params.get('von') ?? 0);
const count = Number(params.get('anzahl') ?? 60);
const selection = raw.slice(start, start + count);

const bounds = selection.flatMap((stroke) => stroke.points).reduce(
  (box, point) => ({
    minX: Math.min(box.minX, point.x),
    maxX: Math.max(box.maxX, point.x),
    minY: Math.min(box.minY, point.y),
    maxY: Math.max(box.maxY, point.y),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);

function panel(label: string, paint: (context: CanvasRenderingContext2D, stroke: Stroke) => void): void {
  const canvas = document.createElement('canvas');
  const width = 1000;
  const height = 300;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  const zoom = Number(params.get('zoom') ?? 1);
  const scale = PAGE_WIDTH_PX * zoom;
  context.setTransform(scale, 0, 0, scale, -bounds.minX * scale + 10, -bounds.minY * scale + 10);
  for (const stroke of selection) paint(context, stroke);
  const title = document.createElement('div');
  title.textContent = label;
  title.style.padding = '6px 8px 2px';
  document.getElementById('ausgabe')?.append(title, canvas);
}

panel('Vorher: rohe Punkte, Umriss wie in v0.5', (context, stroke) => {
  const outline = outlinePoints(stroke, false);
  context.fillStyle = stroke.color;
  context.beginPath();
  outline.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.fill();
});

if (params.get('glaettung') !== null) {
  for (const [level, label] of [['off', 'Glättung aus (bisher)'], ['light', 'Glättung leicht'], ['strong', 'Glättung stark']] as const) {
    panel(label, (context, stroke) => drawStroke(context, { ...cleanStroke(stroke), smoothing: level }));
  }
} else {
  panel('Nachher: aufgeräumt und geglättet', (context, stroke) => drawStroke(context, cleanStroke(stroke)));
}

Object.assign(window, { raw, cleanStroke, getStroke });
