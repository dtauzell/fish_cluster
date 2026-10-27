import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const files = await readdir(root);

test('all local application imports and page assets exist in the deployable site', async () => {
  for (const file of files.filter(file => /\.(html|mjs|js)$/.test(file))) {
    const source = await readFile(new URL(file, root), 'utf8');
    const matches = file.endsWith('.html')
      ? source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)
      : source.matchAll(/\b(?:from\s*|importScripts\(\s*)["'](\.[^"']+)["']/g);
    for (const [, reference] of matches) {
      if (/^(?:#|[a-z]+:|\/\/)/i.test(reference)) continue;
      const asset = new URL(reference, new URL(file, root));
      asset.search = ''; asset.hash = '';
      await assert.doesNotReject(access(asset), `${file} references missing asset ${reference}`);
    }
  }
});

test('literal application control references still match controls in the main page', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const file of ['app.mjs', 'human-ui.mjs', 'velocity-ui.mjs']) {
    const source = await readFile(new URL(file, root), 'utf8');
    for (const [, id] of source.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(ids.has(id), `${file} references missing control ${id}`);
    }
  }
});
