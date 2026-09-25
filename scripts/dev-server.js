#!/usr/bin/env node
// Minimal static file server for public/. No dependencies.
// Usage: npm run dev [-- --port 5173]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const ROOT = path.join(PROJECT, 'public');

// The app lives in public/, but its modules live in src/ so the source tree
// stays readable. Mount src/ rather than duplicating or bundling it.
const MOUNTS = [
  { prefix: '/src/', dir: path.join(PROJECT, 'src') },
  // Test fixtures, so the suite can load real API responses without a network.
  { prefix: '/fixtures/', dir: path.join(PROJECT, 'tests', 'fixtures') }
];

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.csv': 'text/csv; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const mount = MOUNTS.find((m) => urlPath.startsWith(m.prefix));
  const base = mount ? mount.dir : ROOT;
  const filePath = mount
    ? path.join(mount.dir, urlPath.slice(mount.prefix.length))
    : path.join(ROOT, urlPath);

  // Refuse anything that escapes the mount it was resolved against.
  if (!filePath.startsWith(base + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Election Map Studio — serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/`);
});
