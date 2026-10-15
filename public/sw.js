/* The scope works at / locally and /yoga_studio/ on GitHub Pages. */
const ROOT = new URL('./', self.registration.scope);
const PREFIX = `yoga-studio:${ROOT.pathname}:`;
const CACHE = `${PREFIX}__BUILD_ID__`;
const local = path => new URL(path, ROOT).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(ROOT, {cache:'reload'});
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => new URL(match[1], ROOT))
      .filter(url => url.origin === ROOT.origin && url.pathname.startsWith(`${ROOT.pathname}assets/`))
      .map(url => url.href);
    const cache = await caches.open(CACHE);
    await cache.addAll([ROOT.href,local('manifest.webmanifest'),local('icon.svg'),local('icon-192.png'),local('icon-512.png'),...assets]);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Never delete caches belonging to another Pages project on the same origin.
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(ROOT.href)));
    return;
  }
  // Only static app resources are cacheable, not arbitrary authenticated responses.
  const isAsset = url.pathname.startsWith(`${ROOT.pathname}assets/`);
  const isPublic = ['manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].some(path => url.href === local(path));
  if (!isAsset && !isPublic) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request,{ignoreVary:true});
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request,response.clone());
    return response;
  })());
});
