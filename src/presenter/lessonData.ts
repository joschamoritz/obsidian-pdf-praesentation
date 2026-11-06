// Liest aus Stundenentwürfen und PDFs, was während der Stunde helfen kann. Ohne DOM und ohne Obsidian.

export interface PlanRow {
  from: number;
  to: number;
  phase: string;
}

const TIME_CELL = /(\d+)\s*[–—-]\s*(\d+)\s*[′'’]/;

/** Der Verlaufsplan: eine Tabelle mit Spalten für Zeit und Phase, in der Form „16–42′ (26′)“. */
export function parsePlan(markdown: string): PlanRow[] {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = splitRow(lines[i]);
    const timeColumn = header.findIndex((cell) => /^\**zeit\**$/i.test(cell));
    const phaseColumn = header.findIndex((cell) => /^\**phase\**$/i.test(cell));
    if (timeColumn < 0 || phaseColumn < 0) continue;
    const rows: PlanRow[] = [];
    for (let j = i + 2; j < lines.length && lines[j].includes('|'); j++) {
      const cells = splitRow(lines[j]);
      const time = TIME_CELL.exec(cells[timeColumn] ?? '');
      if (!time) continue;
      rows.push({ from: Number(time[1]), to: Number(time[2]), phase: cleanPhase(cells[phaseColumn] ?? '') });
    }
    if (rows.length) return rows;
  }
  return [];
}

function splitRow(line: string): string[] {
  const text = line.replace(/^\s*>?\s*/, '').trim();
  if (!text.startsWith('|')) return [];
  return text
    .slice(1, text.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim());
}

function cleanPhase(cell: string): string {
  return cell
    .split(/<br\s*\/?>/i)[0]
    .replace(/[*_`]/g, '')
    .trim();
}

/** Text für die Planzeile. Nur Phase und Zeit: Die Klasse liest mit, Kommentare gehören nicht dorthin. */
export function planLabel(rows: PlanRow[], minute: number): string {
  const row = rows.find((entry) => minute < entry.to) ?? null;
  if (!row) return `Min. ${minute} · Planende überschritten`;
  return `Min. ${minute} · ${row.phase}, bis ${row.to}′`;
}

const NOT_FOR_THE_CLASS = /lehrerhand|lösung|loesung|erwartung|korrektur/i;

/** Die PDFs aus der Zeile „Digital“ im Block „Vor der Stunde“, ohne das, was nur für die Lehrkraft ist. */
export function digitalPdfNames(markdown: string): string[] {
  const line = markdown.split(/\r?\n/).find((entry) => /\*\*Digital:\*\*/.test(entry));
  if (!line) return [];
  const names: string[] = [];
  for (const match of line.matchAll(/`([^`]+\.pdf)`|\[\[([^\]|#]+\.pdf)/gi)) {
    const name = match[1] ?? match[2];
    if (!NOT_FOR_THE_CLASS.test(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** Zeilenhöhe in Seitenbreiten, von sehr kleiner Schrift bis zu großzügigem Zeilenabstand */
const MIN_LINE_STEP = 0.006;
const MAX_LINE_STEP = 0.05;

export interface LineBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Eine echte Zählung läuft gleichmäßig: Der Abstand je Zeile bleibt gleich und passt zu einer
 * Textzeile. Die Spalte „max. Punkte“ einer Tabelle (5, 10, 15) fällt damit durch.
 */
function isLineCounter(column: TextItem[]): boolean {
  if (column.length < 2) return false;
  const steps: number[] = [];
  for (let i = 1; i < column.length; i++) {
    const lines = Number(column[i].text) - Number(column[i - 1].text);
    if (lines <= 0) return false;
    steps.push((column[i].y - column[i - 1].y) / lines);
  }
  const smallest = Math.min(...steps);
  const largest = Math.max(...steps);
  return smallest >= MIN_LINE_STEP && largest <= MAX_LINE_STEP && largest <= smallest * 1.3;
}

/**
 * Sucht die Zeilenzählung (5, 10, 15 …) in einer senkrechten Spalte und rechnet daraus die
 * Lage von Zeile n. Koordinaten in Seitenbreiten, y von oben. Null, wenn es keine Zählung gibt.
 */
export function findLineBand(items: TextItem[], line: number): LineBand | null {
  const numbers = items.filter((item) => /^\d{1,3}$/.test(item.text.trim()) && Number(item.text) % 5 === 0 && Number(item.text) > 0);
  const columns: TextItem[][] = [];
  for (const item of numbers) {
    const column = columns.find((entries) => Math.abs(entries[0].x - item.x) < 0.015);
    if (column) column.push(item);
    else columns.push([item]);
  }
  const best = columns
    .map((column) => column.sort((a, b) => a.y - b.y))
    .filter(isLineCounter)
    .sort((a, b) => b.length - a.length)[0];
  if (!best) return null;

  const first = best[0];
  const last = best[best.length - 1];
  const step = (last.y - first.y) / (Number(last.text) - Number(first.text));
  if (!(step > 0)) return null;
  const below = best.find((item) => Number(item.text) >= line) ?? last;
  const y = below.y + (line - Number(below.text)) * step;
  if (y < first.y - 6 * step || y > last.y + 6 * step) return null;

  const left = Math.min(...best.map((item) => item.x));
  const row = items.filter((item) => item.y > first.y - step && item.y < last.y + step && item.x > left + 0.005 && !best.includes(item));
  if (!row.length) return null;
  const right = Math.max(...row.map((item) => item.x + item.width));
  return { x: left, y: y - step * 0.85, width: right - left, height: step * 1.15 };
}

/** Eine Zeile für die Reflexion: Wie lange stand welche Folie? Kurzes Durchblättern zählt nicht. */
export function formatDwell(entries: { label: string; ms: number }[]): string {
  const minutes = entries
    .map(({ label, ms }) => ({ label, minutes: Math.round(ms / 60_000) }))
    .filter((entry) => entry.minutes >= 1);
  if (!minutes.length) return '';
  return `Verweildauer: ${minutes.map((entry) => `${entry.label} ${entry.minutes}′`).join(' · ')}`;
}

/** Name eines Tintenstands für den Dateinamen: nur Kleinbuchstaben, Ziffern und Bindestriche. */
export function groupSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
