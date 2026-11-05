// Kopiert das gebaute Plugin in einen Vault: npm run install-plugin -- "/Pfad/zum/Vault"
// Nur die drei Laufzeitdateien wandern in den Vault. Direkt kopieren: Umbenennen nach dem
// Schreiben erzeugt in iCloud Konfliktkopien.
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error('Bitte den Vault angeben: npm run install-plugin -- "/Pfad/zum/Vault" oder OBSIDIAN_VAULT setzen.');
  process.exit(1);
}
const target = join(vault, '.obsidian', 'plugins', 'pdf-praesentation');

await mkdir(target, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(name, join(target, name));
}
console.log(`Installiert nach ${target}`);
