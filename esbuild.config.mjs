import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

const shared = {
  bundle: true,
  target: 'es2020',
  loader: { '.svg': 'text' },
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  format: 'cjs',
  external: ['obsidian', 'electron'],
  minify: true,
});

if (process.argv.includes('--harness')) {
  await build({
    ...shared,
    entryPoints: ['dev/harness.ts', 'dev/vergleich.ts'],
    outdir: 'dev/bundle',
    entryNames: '[name]',
    format: 'esm',
    target: 'esnext',
    sourcemap: true,
  });
  await copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dev/pdf.worker.mjs');
}
