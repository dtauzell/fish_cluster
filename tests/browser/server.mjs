import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { offlineManifest } from '../../scripts/offline-assets.mjs';

// Freeze application files for the run. Releases differ only in their prepared
// Git metadata; both exercise the real service worker and version indicator.
const root = new URL('../../dist/', import.meta.url);
async function snapshot(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? snapshot(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
    : [[`${prefix}${entry.name}`, await readFile(new URL(entry.name, directory))]]))).flat();
}
const files = new Map(await snapshot(root));
const releases = new Map();
for (const release of ['a', 'b']) {
  releases.set(release, await offlineManifest({ version: {
    commit: release.repeat(40), commitDate: `2026-01-0${release === 'a' ? 1 : 2}T12:00:00Z`, dirty: false,
  } }));
}
const scopes = new Map();
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/__test/health') { response.end('ready'); return; }
    if (url.pathname === '/__test/release' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { scope, release } = JSON.parse(body);
      if (!/^offline-[a-z0-9-]+$/.test(scope) || !releases.has(release)) { response.writeHead(400).end(); return; }
      scopes.set(scope, release);
      response.end('updated');
      return;
    }
    const match = url.pathname.match(/^\/(offline-[a-z0-9-]+)(\/.*)?$/);
    const scope = match?.[1], prefix = scope ? `/${scope}` : '';
    let path = scope ? match[2] : url.pathname;
    if (!path) { response.writeHead(308, { Location: `${prefix}/` }).end(); return; }
    // Match Cloudflare Pages canonical HTML redirects, including index.html→/.
    if (path.endsWith('.html')) {
      const canonical = path.endsWith('/index.html') ? path.slice(0, -10) : path.slice(0, -5);
      response.writeHead(308, { Location: `${prefix}${canonical}` }).end();
      return;
    }
    if (path === '/') path = '/index.html';
    else if (!extname(path)) path += '.html';
    const asset = path.slice(1);
    const body = asset === 'offline-assets.js' ? releases.get(scopes.get(scope) || 'a') : files.get(asset);
    if (body === undefined) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': types[extname(asset)] || 'application/octet-stream',
      'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Test server failed');
  }
});
const port = Number(process.env.FISH_BROWSER_TEST_PORT || 8138);
server.listen(port, '127.0.0.1', () => console.log(`Browser test server: http://127.0.0.1:${port}`));
