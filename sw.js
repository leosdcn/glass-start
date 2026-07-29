const CACHE = 'favicon-cache-v3';
const MAX_ENTRIES = 500;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
));

self.addEventListener('fetch', e => {
    const url = e.request.url.toLowerCase();
    if (!url.includes('favicon') && !url.includes('.ico') && !url.includes('icon')) return;
    e.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(e.request);
            if (cached) return cached;
            try {
                const res = await fetch(e.request, { mode: 'no-cors' });
                if (res.ok || res.type === 'opaque') {
                    cache.put(e.request, res.clone());
                    const keys = await cache.keys();
                    if (keys.length > MAX_ENTRIES) await cache.delete(keys[0]);
                }
                return res;
            } catch {
                return new Response('', { status: 404 });
            }
        })
    );
});
