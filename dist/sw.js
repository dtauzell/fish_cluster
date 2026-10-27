/* One complete app version per cache; updates wait until existing tabs close. */
importScripts('./offline-assets.js');

const { revision, assets } = self.FISH_CLUSTER_OFFLINE;
const scope = self.registration.scope;
const prefix = `fish-cluster-offline:${scope}:`;
const cacheName = `${prefix}${revision}`;
const assetURLs = new Set(assets.map(asset => new URL(asset, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      // Bypass the HTTP cache so a new revision gets the deployed files.
      await cache.addAll([...assetURLs].map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Existing CSS/entry-point version queries resolve to the same release asset.
  url.search = '';
  url.hash = '';
  if (url.href === scope) url.pathname += 'index.html';
  if (!assetURLs.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(url.href) || fetch(event.request);
  })());
});
