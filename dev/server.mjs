// Statischer Server nur für die lokale Testseite.
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT ?? 5199);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
};

createServer((request, response) => {
  // Speichert ein Bild der Vergleichsseite, damit es sich in voller Auflösung ansehen lässt.
  if (request.method === 'POST' && request.url === '/bild') {
    const parts = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => {
      writeFileSync(join(root, 'dev/fixtures/vergleich.png'), Buffer.concat(parts));
      response.writeHead(204).end();
    });
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'dev/harness.html' : pathname.slice(1);
  const file = normalize(join(root, relative));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('Nicht gefunden');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
