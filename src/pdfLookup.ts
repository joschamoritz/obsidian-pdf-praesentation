// Stundenentwürfe nennen PDFs meist als Pfad in Backticks, oft nur mit dem Dateinamen
// oder dem hinteren Teil des Pfads. Hier wird daraus die passende Datei im Vault.

/** Dateinamen vom iPad und vom PC können Umlaute verschieden kodieren. */
function normalize(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/** Sieht der Text nach einem PDF aus? Pfade auf ein anderes Laufwerk liegen nicht im Vault. */
export function looksLikePdfPath(text: string): boolean {
  const value = text.trim();
  return /\.pdf$/i.test(value) && !/^[a-z]:[\\/]/i.test(value);
}

/**
 * Alle Dateien, die der Text meinen kann, die beste Sorte zuerst: genauer Pfad, dann Ende des
 * Pfads, dann nur der Dateiname. Mehr als ein Treffer heißt, dass nachgefragt werden muss.
 */
export function findPdfs(text: string, paths: readonly string[]): string[] {
  if (!looksLikePdfPath(text)) return [];
  const wanted = normalize(
    text
      .trim()
      .replace(/\\/g, '/')
      .replace(/^(…|\.\.\.)\/?/, '')
      .replace(/^\.?\/+/, ''),
  );
  const exact = paths.filter((path) => normalize(path) === wanted);
  if (exact.length) return exact;
  const suffix = paths.filter((path) => normalize(path).endsWith(`/${wanted}`));
  if (suffix.length) return suffix;
  const name = wanted.slice(wanted.lastIndexOf('/') + 1);
  return paths.filter((path) => {
    const candidate = normalize(path);
    return candidate.slice(candidate.lastIndexOf('/') + 1) === name;
  });
}
