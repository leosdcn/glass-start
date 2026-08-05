/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 LRU 缓存器 (v9)
 * ==============================================================================
 * 核心功能与安全保障：
 * 1. 【三 Cache 缓存池隔离】：CORE_CACHE 存核心静态资源（永不删）；FAVICON_CACHE 存 a.favicon.im 外部图标；
 *    IMG_CACHE 存站内本地图片资源。三者独立限额，互不挤占，导航站大量图标场景下更稳。
 * 2. 【IndexedDB 真时间戳 LRU】：在 IDB 中维护访问时间戳，按真实时间精准淘汰，不依赖 Cache.keys() 排序实现细节。
 *    favicon 与本地图片的时间戳分别用不同 key 前缀区分，避免互相覆盖。
 * 3. 【Network-First 503 兜底】：断网且无本地缓存时兜底返回可控 503 响应，主文档导航自动尝试退回 index.html。
 * 4. 【e.waitUntil 竞态保护】：背景异步调序/时间戳更新由 e.waitUntil(...) 延展 SW 生命周期，防进程提前终止。
 * 5. 【批量淘汰】：一次性清理到限额以内，而非每次只删 1 条，应对图标突增场景更及时。
 * 6. 【全资源精准匹配】：涵盖 HTML, CSS, JSON, SVG, PNG, ICO, WebP, AVIF 及 a.favicon.im 外部图标。
 */

// 缓存池定义（打包 build.js 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1785905314218';
const FAVICON_CACHE = 'app-favicons-v1'; // a.favicon.im 外部图标专用池
const IMG_CACHE = 'app-images-v1';       // 站内本地图片资源专用池

// 图标是导航站核心功能，量大，各自独立限额
const MAX_FAVICON_ENTRIES = 800; // a.favicon.im 外部图标上限
const MAX_IMG_ENTRIES = 200;     // 站内本地图片上限

// 核心预缓存静态资源列表（PWA 离线打不开保障，CSS 已全量内嵌在 index.html 中）
// 注意：manifest.json 在构建时已被 build.js 内联为 data URI（dist 产物中不存在该文件），
// icon.svg 亦不存在于仓库与构建产物中；二者均不能作为预缓存目标，
// 否则 cache.addAll 会因任一 404 而整批失败（连 './' 与 './index.html' 也一起回滚丢失）
const CORE_ASSETS = [
    './',
    './index.html',
    './wallpapers/bg1.avif'
];

// IndexedDB LRU 时间戳管理
const IDB_NAME = 'sw-lru-db';
const IDB_STORE = 'icon-timestamps';

// 复用同一个 IDB 连接，避免每次访问图标都重新 open 一次数据库
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
                dbPromise = null; // 打开失败时重置，允许下次重试
                reject(req.error);
            };
        } catch (e) {
            dbPromise = null;
            reject(e);
        }
    });
    return dbPromise;
}

// 记录或刷新条目最后访问时间戳
// key 加上 pool 前缀（favicon: / img:），避免两个缓存池的同名时间戳互相覆盖
async function recordAccess(pool, url) {
    try {
        const db = await openIDB();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(Date.now(), `${pool}:${url}`);
        await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
    } catch {
        dbPromise = null; // 异常时清空连接句柄，以便下次重新建连
    }
}

// 同一缓存池互斥串行锁，消除并发请求并发执行 pruneCache 导致的淘汰目标重复与溢出 BUG
const pruneLocks = new Map();
function enqueuePruneCache(pool, cache, maxEntries) {
    const previous = pruneLocks.get(pool) || Promise.resolve();
    const next = previous.then(() => pruneCache(pool, cache, maxEntries)).catch(() => {});
    pruneLocks.set(pool, next);
    return next;
}

// 基于 IndexedDB 时间戳批量清理最久未使用的条目，一次性清到限额以内
// 应对短时间内大量新图标涌入（如批量导入书签）的场景
async function pruneCache(pool, cache, maxEntries) {
    try {
        const keys = await cache.keys();
        const overflow = keys.length - maxEntries;

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

        // 收集已不存在于 Cache API 中的 IDB 孤立无用时间戳记录（垃圾回收 GC）
        const orphanRecords = timestamps.filter(t => !cacheUrlSet.has(t.url));

        let toDeleteUrls = [];
        if (overflow > 0) {
            // 优先按时间戳从最旧到新删除，凑不够数量再用 keys[0..] 兜底（无 IDB 记录的条目）
            toDeleteUrls = validRecords.slice(0, overflow).map(r => r.url);
            if (toDeleteUrls.length < overflow) {
                const knownSet = new Set(toDeleteUrls);
                for (const k of keys) {
                    if (toDeleteUrls.length >= overflow) break;
                    if (!knownSet.has(k.url) && !validRecords.some(r => r.url === k.url)) {
                        toDeleteUrls.push(k.url);
                        knownSet.add(k.url); // 修复：补全 Set 注册，防止相同 URL 重复压入与兜底清理缺失
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
        // 垃圾回收：同步擦除已不存在于 Cache API 中的孤立 IDB 时间戳，彻底消除硬盘/内存泄漏
        orphanRecords.forEach(r => delStore.delete(r.idbKey));
        await new Promise(r => { deleteTx.oncomplete = r; deleteTx.onerror = r; });
    } catch {
        dbPromise = null;
    }
}

// 安装阶段：预缓存核心静态文件，跳过等待强制激活最新 SW
// 逐项添加并吞掉单项失败：即使未来某个资源意外 404，也不会拖垮整批预缓存
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CORE_CACHE).then(cache =>
            Promise.all(CORE_ASSETS.map(asset => cache.add(asset).catch(() => {})))
        )
    );
});

// 激活阶段：清理旧版本 CACHE 存储，并接管当前客户端页面
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CORE_CACHE && k !== FAVICON_CACHE && k !== IMG_CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
));

// 拦截请求阶段
self.addEventListener('fetch', e => {
    // 仅拦截 HTTP GET 请求
    if (e.request.method !== 'GET') return;

    let urlObj;
    try {
        urlObj = new URL(e.request.url);
    } catch {
        return;
    }

    const pathnameLower = urlObj.pathname.toLowerCase();

    // 精准资源匹配判定
    const isMainDoc = e.request.mode === 'navigate' || pathnameLower === '/' || pathnameLower.endsWith('/index.html');
    const isCoreData = pathnameLower.endsWith('/manifest.json') || pathnameLower.endsWith('/bookmarks.json');
    const isFaviconDomain = urlObj.origin === 'https://a.favicon.im';
    const isImgAsset = /\.(ico|png|jpg|jpeg|svg|webp|avif)$/i.test(pathnameLower);

    // 1. 对 index.html (主文档) 采取 Network-First 策略
    if (isMainDoc) {
        e.respondWith(
            fetch(e.request).then(netRes => {
                if (netRes.ok) {
                    const resClone = netRes.clone();
                    caches.open(CORE_CACHE).then(cache => cache.put(e.request, resClone)).catch(() => {});
                }
                return netRes;
            }).catch(async () => {
                // 网络失败/断网时退回本地 Cache 兜底
                const cachedRes = await caches.match(e.request);
                if (cachedRes) return cachedRes;

                // 若主导航请求无缓存，尝试退回 index.html 或 /
                const fallbackDoc = (await caches.match('./index.html')) || (await caches.match('/'));
                if (fallbackDoc) return fallbackDoc;

                // 最终无任何缓存时的 503 兜底响应
                return new Response('网络离线且本地无缓存', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            })
        );
        return;
    }

    // 2. 对 bookmarks.json 和 manifest.json 采取 Stale-While-Revalidate 策略 (0ms 秒响应 + 后台静默刷新)
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

                // 若本地缓存已存在，实现 0ms 秒级响应，并在后台异步刷新缓存
                if (cachedRes) {
                    e.waitUntil(fetchPromise);
                    return cachedRes;
                }

                // 无本地缓存时等待网络响应
                const netRes = await fetchPromise;
                if (netRes) return netRes;

                return new Response('网络离线且本地无缓存', {
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            })
        );
        return;
    }

    // 3. 对图标及图片资源采取分策略缓存 + IndexedDB 真 LRU 调序
    //    - a.favicon.im 跨域图标：Stale-While-Revalidate。
    //      跨域 <img> 默认 no-cors，响应恒为 opaque（status=0、ok=false、body 不可读），
    //      JS 无法区分 200/404/5xx/中间层告警页；若 Cache-First 一旦首次写进坏响应（网络抖动/被墙/404），
    //      就会永久命中坏缓存导致 favicon 再也不显示。改为"命中即返回 + 后台强制 revalidate 覆盖"，
    //      让瞬时故障在网络恢复后自愈，首次 miss 仍走网络。
    //    - 站内本地图片（同源）：保持 Cache-First。同源响应 res.ok 可靠，不会误缓存坏响应。
    // 两个缓存池独立限额，互不挤占。
    if (isFaviconDomain || isImgAsset) {
        const pool = isFaviconDomain ? 'favicon' : 'img';
        const cacheName = isFaviconDomain ? FAVICON_CACHE : IMG_CACHE;
        const maxEntries = isFaviconDomain ? MAX_FAVICON_ENTRIES : MAX_IMG_ENTRIES;

        if (isFaviconDomain) {
            // ---------- Stale-While-Revalidate：跨域 favicon ----------
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    const cached = await cache.match(e.request);

                    // 后台无条件 revalidate：无论命中与否都尝试用最新响应覆盖缓存，
                    // 让此前被误缓存的 opaque 错误响应能在网络恢复后自愈。
                    const revalidatePromise = (async () => {
                        try {
                            // 用 no-cache 强制走协商/回源，避免被浏览器 HTTP 缓存二次挡在外面
                            const netRes = await fetch(e.request, { cache: 'no-cache' });
                            // opaque 响应无法判别成功失败，但网络层成功到达（未抛异常）即说明
                            // 服务器返回了某种响应——比之前的坏响应当前更"新鲜"，覆盖之；
                            // 真正的网络错误（抛异常）会走到 catch，保留旧缓存不动。
                            if (netRes && (netRes.ok || netRes.type === 'opaque')) {
                                await cache.put(e.request, netRes.clone());
                                await recordAccess(pool, e.request.url);
                                await enqueuePruneCache(pool, cache, maxEntries);
                            }
                        } catch {
                            // 离线/网络错误：保留旧缓存即可，刷新时间戳维持 LRU 顺序
                            if (cached) {
                                await recordAccess(pool, e.request.url).catch(() => {});
                            }
                        }
                    })();

                    if (cached) {
                        e.waitUntil(revalidatePromise);
                        e.waitUntil(recordAccess(pool, e.request.url));
                        return cached;
                    }

                    // 首次 miss：等待 revalidate 完成，缓存中已有结果则直接返回；
                    // 失败（网络离线等）则兜底 404。
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
            // ---------- Cache-First：站内本地图片（同源，res.ok 可靠） ----------
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    // 优先命中本地 Cache 缓存 (0ms 秒开)
                    const cached = await cache.match(e.request);
                    if (cached) {
                        // 命中时刷新时间戳（放入 waitUntil 保证 SW 线程生命周期）
                        e.waitUntil(recordAccess(pool, e.request.url));
                        return cached;
                    }

                    // 未命中缓存，发起网络请求并存入对应缓存池
                    try {
                        const res = await fetch(e.request);
                        if (res.ok) {
                            // 站内同源响应可靠，仅缓存 res.ok===true 的成功响应，拒绝任何错误态
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
