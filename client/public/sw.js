// The service worker (registered by src/main.tsx). Push notifications: shown, and a tap opens their page.
// In development it's registered as /sw.js?dev and only does push: no caching of Vite's ever-changing files.
// Built files (hashed names), icons and uploaded images never change under the same address: served from the cache.
// Pages come from the network, with the last copy kept for reading offline (posts carry their text in the page).
// The API and everything else go to the network as usual.
const DEV = new URL(self.location.href).searchParams.has('dev');
const STATIC = 'static-v1';
const IMAGES = 'images-v1';
const PAGES = 'pages-v1';

const OFFLINE = `<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title><body style="display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;font-family:system-ui,sans-serif;text-align:center;background:#050918;color:#e9ecff">
<div><p style="margin:0;font-size:3rem;color:#f2c46d">☾</p><h1 style="font-size:1.4rem">Ești offline</h1>
<p>Articolele citite deja se deschid și fără internet. Restul revine odată cu conexiunea.</p></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![STATIC, IMAGES, PAGES].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps a cache to its newest `max` entries. */
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)));
}

async function cacheFirst(request, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trim(name, max);
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      void trim(PAGES, 40);
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('/')) ||
      new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (DEV || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) event.respondWith(cacheFirst(request, STATIC, 150));
  else if (url.pathname.startsWith('/uploads/')) event.respondWith(cacheFirst(request, IMAGES, 150));
});

// A push from the server (server/src/lib/push.ts): { title, body, url, tag }. The same tag replaces an older one.
self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { title: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || '', {
      body: message.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: message.tag,
      renotify: Boolean(message.tag),
      data: { url: message.url || '/' },
    }),
  );
});

// A tap: the site's open tab goes to that page (or a new one opens).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((client) => new URL(client.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        if ('navigate' in tab) await tab.navigate(url).catch(() => self.clients.openWindow(url));
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
