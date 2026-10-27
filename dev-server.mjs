import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { offlineManifest } from './scripts/offline-assets.mjs';

const root = resolve('dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname) === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (!path.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try {
    // Reflect edits made while npm run dev is running, without requiring a
    // separate offline:prepare command before the Force refresh action.
    const body = path === resolve(root, 'offline-assets.js') ? await offlineManifest() : await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(8000, '127.0.0.1', () => console.log('Fish Cluster: http://localhost:8000'));
