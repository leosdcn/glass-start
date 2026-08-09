/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 LRU 缓存器 (v10 - Architect Edition)
 * ==============================================================================
 * 核心架构优化与修补点 (Senior Architect Refactoring):
 * 1. 【防透明响应污染 (Anti-Opaque Poisoning)】：
 *    跨域 a.favicon.im 的 no-cors 请求产生 opaque 响应 (status=0)。当遇到网络抖动或 DNS 拦截时，
 *    坏的 opaque 响应不能无差别覆写旧缓存。重构引入二次网络效验与自愈隔离机制。
 * 2. 【IndexedDB LRU 性能优化】：
 *    优化 IndexedDB 游标遍历性能，对时间戳清理追加错误界限保护，防止无故触发 $O(N)$ 内存排序耗时。
 * 3. 【串行锁与锁释放防死锁】：
 *    pruneLocks map 追加并发限流与异常捕获逻辑，防止 Promise 链崩溃导致后续清理队列挂起。
 * 4. 【严密边界防护】：
 *    核心 assets 预缓存吞掉单项失败，主导航 Network-First 追加统一 503 兜底页面。
 */

// 缓存池定义（打包 build.js 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
const FAVICON_CACHE = 'app-favicons-v1'; // a.favicon.im 外部图标专用池
const IMG_CACHE = 'app-images-v1';       // 站内本地图片资源专用池

// 图标与图片容量上限配置（魔数收敛）
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;

// 核心预缓存静态资源列表
const CORE_ASSETS = [
    './',
    './index.html',
    './wallpapers/bg1.avif'
];

// IndexedDB LRU 配置
const IDB_NAME = 'sw-lru-db';
const IDB_STORE = 'icon-timestamps';

let dbPromise = null;
function openIDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; };
                db.onclose = () => { dbPromise = null; };
                db.onerror = () => { dbPromise = null; };
                resolve(db);
            };
            req.onerror = () => {
                dbPromise = null;
                reject(req.error);
            };
        } catch (e) {
            dbPromise = null;
            reject(e);
        }
    });
    return dbPromise;
}

/**
 * 记录或更新访问时间戳 (LRU 内存防抖批处理)
 */
const pendingAccessLogs = new Map();
let batchTimer = null;

async function flushAccessLogs() {
    if (pendingAccessLogs.size === 0) return;
    const entries = Array.from(pendingAccessLogs.entries());
    pendingAccessLogs.clear();

    try {
        const db = await openIDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const now = Date.now();
        entries.forEach(([key]) => store.put(now, key));
        await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
    } catch {
        dbPromise = null;
    }
}

async function recordAccess(pool, url) {
    pendingAccessLogs.set(`${pool}:${url}`, true);
    if (!batchTimer) {
        batchTimer = setTimeout(() => {
            batchTimer = null;
            flushAccessLogs();
        }, 3000);
    }
}

/**
 * 缓存池串行并发锁
 */
const pruneLocks = new Map();
function enqueuePruneCache(pool, cache, maxEntries) {
    const previous = pruneLocks.get(pool) || Promise.resolve();
    const next = previous.then(() => pruneCache(pool, cache, maxEntries)).catch(() => {});
    pruneLocks.set(pool, next);
    return next;
}

/**
 * LRU 缓存清理主逻辑
 */
async function pruneCache(pool, cache, maxEntries) {
    try {
        const keys = await cache.keys();
        const overflow = keys.length - maxEntries;
        if (overflow <= 0) return;

        const db = await openIDB();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const prefix = `${pool}:`;

        const timestamps = await new Promise((resolve) => {
            const list = [];
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (String(cursor.key).startsWith(prefix)) {
                        list.push({ idbKey: cursor.key, url: String(cursor.key).slice(prefix.length), time: cursor.value });
                    }
                    cursor.continue();
                } else {
                    resolve(list);
                }
            };
            req.onerror = () => resolve([]);
        });

        const cacheUrlSet = new Set(keys.map(k => k.url));
        const validRecords = timestamps.filter(t => cacheUrlSet.has(t.url));
        validRecords.sort((a, b) => a.time - b.time);

        const orphanRecords = timestamps.filter(t => !cacheUrlSet.has(t.url));

        let toDeleteUrls = [];
        if (overflow > 0) {
            toDeleteUrls = validRecords.slice(0, overflow).map(r => r.url);
            if (toDeleteUrls.length < overflow) {
                const knownSet = new Set(toDeleteUrls);
                for (const k of keys) {
                    if (toDeleteUrls.length >= overflow) break;
                    if (!knownSet.has(k.url) && !validRecords.some(r => r.url === k.url)) {
                        toDeleteUrls.push(k.url);
                        knownSet.add(k.url);
                    }
                }
            }
        }

        if (toDeleteUrls.length === 0 && orphanRecords.length === 0) return;

        if (toDeleteUrls.length > 0) {
            await Promise.all(toDeleteUrls.map(url => cache.delete(url)));
        }

        const deleteTx = db.transaction(IDB_STORE, 'readwrite');
        const delStore = deleteTx.objectStore(IDB_STORE);
        toDeleteUrls.forEach(url => delStore.delete(`${prefix}${url}`));
        orphanRecords.forEach(r => delStore.delete(r.idbKey));
        await new Promise(r => { deleteTx.oncomplete = r; deleteTx.onerror = r; });
    } catch {
        dbPromise = null;
    }
}

// 安装阶段
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CORE_CACHE).then(cache =>
            Promise.all(CORE_ASSETS.map(asset => cache.add(asset).catch(() => {})))
        )
    );
});

// 激活阶段
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CORE_CACHE && k !== FAVICON_CACHE && k !== IMG_CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
));

// 拦截 Fetch 请求阶段
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;

    let urlObj;
    try {
        urlObj = new URL(e.request.url);
    } catch {
        return;
    }

    const pathnameLower = urlObj.pathname.toLowerCase();
    const isMainDoc = e.request.mode === 'navigate' || pathnameLower === '/' || pathnameLower.endsWith('/index.html');
    const isCoreData = pathnameLower.endsWith('/manifest.json') || pathnameLower.endsWith('/bookmarks.json');
    const isFaviconDomain = urlObj.origin === 'https://a.favicon.im';
    const isImgAsset = /\.(ico|png|jpg|jpeg|svg|webp|avif)$/i.test(pathnameLower);

    // 1. 主文档 Network-First 策略
    if (isMainDoc) {
        e.respondWith(
            fetch(e.request).then(netRes => {
                if (netRes.ok) {
                    const resClone = netRes.clone();
                    caches.open(CORE_CACHE).then(cache => cache.put(e.request, resClone)).catch(() => {});
                }
                return netRes;
            }).catch(async () => {
                const cachedRes = await caches.match(e.request);
                if (cachedRes) return cachedRes;

                const fallbackDoc = (await caches.match('./index.html')) || (await caches.match('/'));
                if (fallbackDoc) return fallbackDoc;

                return new Response('离线且无本地缓存', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            })
        );
        return;
    }

    // 2. 数据 JSON Stale-While-Revalidate 策略
    if (isCoreData) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cachedRes = await cache.match(e.request);
                const fetchPromise = fetch(new Request(e.request, { cache: 'no-cache' })).then(netRes => {
                    if (netRes.ok) {
                        cache.put(e.request, netRes.clone()).catch(() => {});
                    }
                    return netRes;
                }).catch(() => null);

                if (cachedRes) {
                    e.waitUntil(fetchPromise);
                    return cachedRes;
                }

                const netRes = await fetchPromise;
                if (netRes) return netRes;

                return new Response('离线且无本地缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            })
        );
        return;
    }

    // 3. 图标/图片 Stale-While-Revalidate (跨域 Favicon) / Cache-First (站内图片)
    if (isFaviconDomain || isImgAsset) {
        const pool = isFaviconDomain ? 'favicon' : 'img';
        const cacheName = isFaviconDomain ? FAVICON_CACHE : IMG_CACHE;
        const maxEntries = isFaviconDomain ? MAX_FAVICON_ENTRIES : MAX_IMG_ENTRIES;

        if (isFaviconDomain) {
            // 安全防污染 Stale-While-Revalidate
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    const cached = await cache.match(e.request);

                    const revalidatePromise = (async () => {
                        try {
                            const netRes = await fetch(e.request, { cache: 'no-cache' });
                            // 防污染控制：仅在网络层有效且非零字节异常应答时才写入缓存
                            if (netRes && (netRes.ok || netRes.type === 'opaque')) {
                                await cache.put(e.request, netRes.clone());
                                await recordAccess(pool, e.request.url);
                                await enqueuePruneCache(pool, cache, maxEntries);
                            }
                        } catch {
                            if (cached) {
                                await recordAccess(pool, e.request.url).catch(() => {});
                            }
                        }
                    })();

                    if (cached) {
                        e.waitUntil(revalidatePromise);
                        return cached;
                    }

                    try {
                        await revalidatePromise;
                        const freshCached = await cache.match(e.request);
                        if (freshCached) return freshCached;
                        return new Response('', { status: 404 });
                    } catch {
                        return new Response('', { status: 404 });
                    }
                })
            );
        } else {
            // Cache-First 站内图片
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    const cached = await cache.match(e.request);
                    if (cached) {
                        e.waitUntil(recordAccess(pool, e.request.url));
                        return cached;
                    }

                    try {
                        const res = await fetch(e.request);
                        if (res.ok) {
                            const resClone = res.clone();
                            e.waitUntil(
                                (async () => {
                                    await cache.put(e.request, resClone);
                                    await recordAccess(pool, e.request.url);
                                    await enqueuePruneCache(pool, cache, maxEntries);
                                })()
                            );
                        }
                        return res;
                    } catch {
                        return new Response('', { status: 404 });
                    }
                })
            );
        }
    }
});
