/* One complete app version per cache; updates wait until existing tabs close. */
importScripts('./offline-assets.js');

const { revision, assets } = self.FISH_CLUSTER_OFFLINE;
const scope = self.registration.scope;
const prefix = `fish-cluster-offline:${scope}:`;
const cacheName = `${prefix}${revision}`;
const assetURLs = new Set(assets.map(asset => new URL(asset, scope).href));
// Cloudflare Pages redirects index.html to its directory and other HTML to
// extensionless URLs. Both spellings must work without asking the server.
const htmlAliases = new Map([...assetURLs].filter(url => url.endsWith('.html'))
  .map(url => [url.endsWith('/index.html') ? url.slice(0, -10) : url.slice(0, -5), url]));

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

// Only the explicit Force refresh action activates an update over open tabs.
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Existing CSS/entry-point version queries resolve to the same release asset.
  url.search = '';
  url.hash = '';
  const assetURL = assetURLs.has(url.href) ? url.href : htmlAliases.get(url.href);
  if (!assetURL) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(assetURL);
    if (!cached) return fetch(event.request);
    // A precache fetch may follow a host redirect. Navigation requests use
    // redirect: 'manual' and reject responses carrying that redirect history.
    // Rebuild the final response while preserving its body, status, and headers.
    return cached.redirected ? new Response(cached.body, {
      status: cached.status, statusText: cached.statusText, headers: cached.headers,
    }) : cached;
  })());
});
