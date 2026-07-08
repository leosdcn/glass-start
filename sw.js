const CACHE = 'favicon-cache-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', e => {
    if (!e.request.url.includes('favicon')) return;
    e.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(e.request);
            if (cached) return cached;
            try {
                const res = await fetch(e.request, { mode: 'no-cors' });
                if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
                return res;
            } catch {
                return cached || new Response('', { status: 404 });
            }
        })
    );
});
