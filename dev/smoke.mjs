// Rauchtest der Testseite im echten Browser: die Abläufe, die Unit-Tests nicht erreichen.
// Start: npm run smoke. Braucht keine eigenen Unterrichts-PDFs, das Test-PDF entsteht hier.
// Prüft nicht: echten Pencil-Druck, iPad, AirPlay, Ton. Das bleibt der Test am Gerät.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Ein freier Port: Ein fester könnte schon von einem anderen Werkzeug belegt sein. */
const PORT = await new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
}

async function testPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([1280, 720]);
    page.drawText(`Rauchtest Folie ${i}`, { x: 60, y: 640, size: 40, font, color: rgb(0.05, 0.3, 0.6) });
  }
  mkdirSync('dev/fixtures', { recursive: true });
  writeFileSync('dev/fixtures/rauchtest.pdf', await pdf.save());
}

await testPdf();
const server = spawn(process.execPath, ['dev/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`${BASE}/dev/harness.html`)).ok) break;
  } catch {
    // Server startet noch
  }
  await wait(250);
}

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.SMOKE_DEBUG) page.on('console', (m) => console.log('Konsole:', m.text()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${BASE}/dev/harness.html?pdf=rauchtest`);
  await page.waitForFunction(() => !!window.presenter, null, { timeout: 30000, polling: 250 });
  await wait(1000);
  await page.evaluate(() => {
    localStorage.removeItem('pdf-praesentation-einstellungen');
    for (const slide of session.slides) slide.ink.strokes = [];
    presenter.changePreferences({ tool: 'pen', holdToShape: true });
  });
  const strokes = () =>
    page.evaluate(() => session.slides[session.current].ink.strokes.map((s) => ({ sharp: !!s.sharp, n: s.points.length, color: s.color, width: s.width })));
  const drag = async (points, holdMs = 0, after = []) => {
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (let i = 1; i < points.length; i++) await page.mouse.move(points[i][0], points[i][1], { steps: 12 });
    if (holdMs) await wait(holdMs);
    for (const [x, y] of after) await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.up();
    await wait(150);
  };

  // Leiste passt quer auf dem iPad in eine Zeile
  await page.getByRole('button', { name: 'Werkzeuge einblenden' }).click();
  await wait(300);
  const barHeight = await page.evaluate(() => document.querySelector('.pp-toolbar').getBoundingClientRect().height);
  check('Werkzeugleiste in einer Zeile bei 1180 px', barHeight < 70, `${Math.round(barHeight)} px hoch`);
  await page.evaluate(() => presenter.toolbar.collapse());

  // Freier Strich bleibt frei
  await drag([[200, 600], [260, 640], [320, 600], [380, 640]]);
  let list = await strokes();
  check('Freier Strich wird gespeichert', list.length === 1 && !list[0].sharp);

  // Zeichnen und halten
  await drag([[200, 250], [500, 260]], 800, [[560, 300]]);
  list = await strokes();
  check('Halten macht eine Linie, das Ende folgt dem Stift', list.length === 2 && list[1].sharp && list[1].n === 2);
  const circle = Array.from({ length: 41 }, (_, i) => [800 + 90 * Math.cos((i / 40) * Math.PI * 2), 300 + 60 * Math.sin((i / 40) * Math.PI * 2)]);
  await drag(circle, 800);
  list = await strokes();
  check('Halten macht eine Ellipse', list.length === 3 && list[2].sharp && list[2].n > 20);
  await drag([[400, 420], [480, 560], [320, 560], [400, 420]], 800);
  list = await strokes();
  check('Halten macht ein Dreieck', list.length === 4 && list[3].sharp && list[3].n === 4);

  // Lasso: alles einfangen, umfärben, vergrößern, rückgängig
  await page.evaluate(() => presenter.changePreferences({ tool: 'lasso' }));
  await drag([[150, 200], [1000, 200], [1000, 700], [150, 700], [150, 205]]);
  const selected = await page.evaluate(() => presenter.selection?.length ?? 0);
  check('Lasso wählt alle Striche aus', selected === 4, `${selected} ausgewählt`);
  await page.locator('[aria-label="Auswahl umfärben"]').click();
  await page.locator('[aria-label="Auswahl in #1f5fd6 färben"]').click();
  await wait(150);
  list = await strokes();
  check('Lasso färbt um', list.every((s) => s.color === '#1f5fd6'));
  const corner = await page.evaluate(() => {
    const sheet = document.querySelector('.pp-sheet').getBoundingClientRect();
    let maxX = -1;
    let maxY = -1;
    for (const s of presenter.selection) for (const p of s.points) {
      maxX = Math.max(maxX, p.x + s.width / 2);
      maxY = Math.max(maxY, p.y + s.width / 2);
    }
    return [sheet.left + maxX * sheet.width + 8, sheet.top + maxY * sheet.width + 8];
  });
  const widthBefore = list[0].width;
  await drag([corner, [corner[0] + 60, corner[1] + 40]]);
  list = await strokes();
  check('Lasso vergrößert am Griff', list[0].width > widthBefore * 1.02);
  await page.keyboard.press('Escape');
  check('Esc hebt die Auswahl auf, Präsentation bleibt offen', await page.evaluate(() => presenter.selection === null && !presenter.closed));
  await page.evaluate(() => presenter.undo());
  list = await strokes();
  check('Rückgängig nimmt das Vergrößern zurück', Math.abs(list[0].width - widthBefore) < 1e-9);

  // Laser: Spur hält, nach dem Absetzen ist sie weg
  await page.evaluate(() => presenter.changePreferences({ tool: 'laser', pointerMode: 'laser', laserHold: true }));
  const painted = () =>
    page.evaluate(() => {
      const canvas = document.querySelectorAll('.pp-layer')[2];
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    });
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 20 });
  await wait(1500);
  const holding = await painted();
  await page.mouse.up();
  await wait(900);
  const after = await painted();
  check('Laserspur bleibt, solange der Stift aufliegt', holding > 1000);
  check('Laserspur verschwindet nach dem Absetzen', after === 0);

  // Timer: Ablauf löst den Effekt aus
  await page.evaluate(() => {
    presenter.changePreferences({ timerEffect: 'flash', timerSound: 'off' });
    presenter.timer.timer.setMinutes(1);
    presenter.timer.timer.start();
    presenter.timer.timer.endAt = Date.now() + 300;
    presenter.timer.render();
  });
  await wait(900);
  const timer = await page.evaluate(() => [presenter.timer.timer.status, document.querySelector('.pp-flash').classList.contains('is-flashing')]);
  check('Timer läuft ab und leuchtet auf', timer[0] === 'finished' && timer[1]);
  await page.evaluate(() => {
    presenter.timer.timer.reset();
    presenter.timer.render();
  });

  // Stiftablage
  await page.evaluate(() => {
    presenter.changePreferences({ tool: 'pen', penType: 'fountain', penColor: '#1f5fd6', penWidth: 0.008, penSlot: 2 });
    presenter.storePenSlot();
    presenter.selectPenSlot(0);
    presenter.selectPenSlot(2);
  });
  const pen = await page.evaluate(() => [presenter.preferences.penType, presenter.preferences.penColor]);
  check('Stiftablage legt ab und nimmt wieder auf', pen[0] === 'fountain' && pen[1] === '#1f5fd6');

  check('Keine Fehler auf der Seite', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} von ${results.length} Prüfungen bestanden`);
process.exit(failed.length ? 1 : 0);
