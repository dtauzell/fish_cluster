import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { offlineManifest } from '../scripts/offline-assets.mjs';

const manifest = await readFile(new URL('../dist/offline-assets.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');

function workerHarness(scope = 'https://fish.example/tools/fish/') {
  const handlers = new Map();
  const stores = new Map();
  let online = true;
  let claimed = false;
  const fetch = async request => {
    if (!online) throw new Error('Network disconnected');
    const url = typeof request === 'string' ? request : request.url;
    return new Response(url);
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
        match: async url => store.get(url)?.clone(),
      };
    },
  };
  const self = {
    registration: { scope },
    clients: { claim: async () => { claimed = true; } },
    addEventListener: (name, handler) => handlers.set(name, handler),
  };
  const context = vm.createContext({ self, caches, fetch, URL, Request,
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
    lifecycle: name => new Promise((resolve, reject) => handlers.get(name)({
      waitUntil: promise => promise.then(resolve, reject),
    })),
    request: (url, method = 'GET') => {
      let response;
      handlers.get('fetch')({ request: new Request(url, { method }),
        respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test('offline inventory and release revision match all deployed source', async () => {
  assert.equal(manifest, await offlineManifest(), 'Run npm run offline:prepare after editing dist/');
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
