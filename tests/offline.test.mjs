import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { offlineManifest } from '../scripts/offline-assets.mjs';

const manifest = await readFile(new URL('../dist/offline-assets.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');

function workerHarness(scope = 'https://fish.example/tools/fish/', { redirectHTML = false } = {}) {
  const handlers = new Map();
  const stores = new Map();
  let online = true;
  let claimed = false;
  let skippedWaiting = false;
  const fetch = async request => {
    if (!online) throw new Error('Network disconnected');
    const url = typeof request === 'string' ? request : request.url;
    const response = new Response(url, { headers: { 'Content-Type': url.endsWith('.html') ? 'text/html' : 'text/plain' } });
    if (redirectHTML && url.endsWith('.html')) Object.defineProperty(response, 'redirected', { value: true });
    return response;
  };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async requests => {
          const responses = await Promise.all(requests.map(fetch));
          requests.forEach((request, i) => store.set(request.url, responses[i]));
        },
        match: async url => {
          const stored = store.get(url);
          const copy = stored?.clone();
          if (stored?.redirected) Object.defineProperty(copy, 'redirected', { value: true });
          return copy;
        },
      };
    },
  };
  const self = {
    registration: { scope },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: async () => { skippedWaiting = true; },
    addEventListener: (name, handler) => handlers.set(name, handler),
  };
  const context = vm.createContext({ self, caches, fetch, URL, Request, Response,
    importScripts: path => {
      assert.equal(path, './offline-assets.js');
      vm.runInContext(manifest, context);
    },
  });
  vm.runInContext(workerSource, context);
  return {
    stores, caches, self, scope,
    disconnect: () => { online = false; },
    claimed: () => claimed,
    skippedWaiting: () => skippedWaiting,
    message: (data, ports = []) => {
      let completion;
      handlers.get('message')({ data, ports, waitUntil: promise => { completion = promise; } });
      return completion;
    },
    lifecycle: name => new Promise((resolve, reject) => handlers.get(name)({
      waitUntil: promise => promise.then(resolve, reject),
    })),
    request: (url, method = 'GET', redirect = 'follow') => {
      let response;
      handlers.get('fetch')({ request: new Request(url, { method, redirect }),
        respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test('offline inventory and release revision match all deployed source', async () => {
  // A committed snapshot records the Git state when prepared. Committing it
  // necessarily advances HEAD; verify assets using that recorded stamp.
  const snapshot = { self: {} };
  vm.runInNewContext(manifest, snapshot);
  assert.equal(manifest, await offlineManifest({ version: snapshot.self.FISH_CLUSTER_OFFLINE.version }),
    'Run npm run offline:prepare after editing dist/');
});

test('updates wait for open tabs unless Force refresh explicitly requests activation', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  assert.equal(worker.skippedWaiting(), false);
  assert.equal(worker.message({ type: 'UNRELATED' }), undefined);
  assert.equal(worker.skippedWaiting(), false);
  await worker.message({ type: 'ACTIVATE_UPDATE' });
  assert.equal(worker.skippedWaiting(), true);
});

test('the serving worker reports its own cached commit and date without checking the network', () => {
  const worker = workerHarness();
  worker.disconnect();
  let metadata;
  worker.message({ type: 'GET_APP_VERSION' }, [{ postMessage: value => { metadata = value; } }]);
  assert.equal(metadata.revision, worker.self.FISH_CLUSTER_OFFLINE.revision);
  assert.deepEqual(metadata.version, worker.self.FISH_CLUSTER_OFFLINE.version);
  assert.ok(Object.hasOwn(metadata.version, 'commitDate'));
});

test('first installation caches every asset, including unvisited help and modules, for offline reloads', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.equal(worker.claimed(), true);
  worker.disconnect();
  for (const asset of worker.self.FISH_CLUSTER_OFFLINE.assets) {
    const url = new URL(asset, worker.scope).href;
    const response = await worker.request(url);
    assert.equal(await response.text(), url);
  }
  for (const path of ['', '?source=bookmark', 'index.html?v=44', 'style.css?v=29', 'about.html', 'csv-guide.html']) {
    const response = await worker.request(new URL(path, worker.scope).href);
    assert.equal(response.status, 200, path);
  }
});

test('Cloudflare redirects are safe to serve to offline navigation requests on refresh', async () => {
  const worker = workerHarness(undefined, { redirectHTML: true });
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  worker.disconnect();
  const stored = [...worker.stores.values()][0].get(`${worker.scope}index.html`);
  assert.equal(stored.redirected, true, 'Reproduce a cached response that followed a redirect');
  for (const path of ['', '?refresh=1', 'index.html', 'about.html', 'about', 'csv-guide', 'background-test']) {
    const response = await worker.request(new URL(path, worker.scope).href, 'GET', 'manual');
    assert.ok(response, path);
    assert.equal(response.redirected, false, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Content-Type'), 'text/html', path);
    const asset = !path || path.startsWith('?') ? 'index.html' : path.endsWith('.html') ? path : `${path}.html`;
    assert.equal(await response.text(), `${worker.scope}${asset}`, path);
  }
});

test('activation deletes only obsolete caches for this app scope', async () => {
  const worker = workerHarness();
  const prefix = `fish-cluster-offline:${worker.scope}:`;
  await worker.caches.open(`${prefix}old`);
  await worker.caches.open('another-application');
  await worker.caches.open('fish-cluster-offline:https://fish.example/other/:old');
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.equal(worker.stores.has(`${prefix}old`), false);
  assert.equal(worker.stores.has('another-application'), true);
  assert.equal(worker.stores.has('fish-cluster-offline:https://fish.example/other/:old'), true);
  assert.equal(worker.stores.size, 3);
});

test('a failed download cannot replace an existing offline installation', async () => {
  const worker = workerHarness();
  const oldCache = `fish-cluster-offline:${worker.scope}:old`;
  await worker.caches.open(oldCache);
  worker.disconnect();
  await assert.rejects(worker.lifecycle('install'), /Network disconnected/);
  assert.deepEqual([...worker.stores.keys()], [oldCache]);
});

test('remote models, local videos, other routes, and non-GET requests are not intercepted', () => {
  const worker = workerHarness();
  for (const url of ['https://cdn.jsdelivr.net/model.js', 'blob:https://fish.example/video',
    'https://fish.example/other/index.html', `${worker.scope}missing.html`]) {
    assert.equal(worker.request(url), undefined);
  }
  assert.equal(worker.request(`${worker.scope}index.html`, 'POST'), undefined);
});
