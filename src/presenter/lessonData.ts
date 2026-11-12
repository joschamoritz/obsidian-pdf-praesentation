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

export interface ReflectionEntries {
  good: string;
  change: string;
  observe: string;
}

const REFLECTION_SECTION = '## Reflexion & Notizen';
const REFLECTION_HEADINGS: [keyof ReflectionEntries, string][] = [
  ['good', '### Was hat gut funktioniert?'],
  ['change', '### Was würde ich beim nächsten Mal ändern?'],
  ['observe', '### Besondere Beobachtungen zur Lerngruppe'],
];

const isHeading = (line: string, maxLevel: number) => new RegExp(`^#{1,${maxLevel}}\\s`).test(line);
/** Ein Trennstrich beendet den Abschnitt ebenfalls, darunter stehen in den Entwürfen oft Verweise */
const isBreak = (line: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

/**
 * Schreibt die Reflexion unter die drei Überschriften des Stundenentwurfs (Standard des Vaults).
 * Vorhandener Text bleibt stehen, Neues kommt darunter. Fehlt der Abschnitt, entsteht er am Ende.
 * Die Verweildauer steht als Zeile direkt unter „Reflexion & Notizen“.
 */
export function insertReflection(markdown: string, entries: ReflectionEntries, dwell = ''): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let section = lines.findIndex((line) => line.trim() === REFLECTION_SECTION);
  if (section < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', REFLECTION_SECTION, '');
    for (const [, heading] of REFLECTION_HEADINGS) lines.push(heading, '', '');
    section = lines.findIndex((line) => line.trim() === REFLECTION_SECTION);
  }
  const sectionEnd = () => {
    const next = lines.findIndex((line, index) => index > section && (isHeading(line, 2) || isBreak(line)));
    return next < 0 ? lines.length : next;
  };

  for (const [key, heading] of REFLECTION_HEADINGS) {
    const text = entries[key].trim();
    if (!text) continue;
    let at = lines.findIndex((line, index) => index > section && index < sectionEnd() && line.trim() === heading);
    if (at < 0) {
      // Überschrift fehlt: ans Ende des Abschnitts
      let end = sectionEnd();
      while (end > section + 1 && lines[end - 1].trim() === '') end--;
      lines.splice(end, 0, '', heading, '');
      at = end + 1;
    }
    let end = lines.findIndex((line, index) => index > at && (isHeading(line, 3) || isBreak(line)));
    if (end < 0) end = lines.length;
    let insert = end;
    while (insert > at + 1 && lines[insert - 1].trim() === '') insert--;
    const block = text.split(/\r?\n/);
    const before = insert === at + 1 ? [] : [''];
    // Nur eine Leerzeile zur nächsten Überschrift, der Rest der Notiz bleibt unberührt
    const after = insert < lines.length && lines[insert].trim() !== '' ? [''] : [];
    lines.splice(insert, 0, ...before, ...block, ...after);
  }

  if (dwell && !lines.some((line) => line.trim() === dwell)) lines.splice(section + 1, 0, '', dwell);
  return lines.join(newline);
}
