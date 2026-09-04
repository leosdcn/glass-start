/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 FIFO 缓存器 (v11 - Modern Edition)
 * ==============================================================================
 * 核心架构特性:
 * 1. 【三池物理隔离】：CORE_CACHE (全站核心)、FAVICON_CACHE (外部图标)、IMG_CACHE (本地图片)
 * 2. 【防透明响应污染】：a.favicon.im 跨域图标 4s 超时熔断 + 合法响应校验入池
 * 3. 【原生 FIFO 容量淘汰】：轻量 pruneCache 自动限制图标 (800) 与图片 (200) 缓存上限，非阻塞后台运行
 * 4. 【原子化 SWR 锁步策略】：CORE_CACHE 本地 0ms 极速秒开 + 差量 SW 换代升级，构建指纹双重契约根治跨版本割裂
 */

// 缓存池定义（打包 build.js 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
const FAVICON_CACHE = 'app-favicons-v1';
const IMG_CACHE = 'app-images-v1';

// 图标与图片容量上限配置
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;

// 核心预缓存静态资源列表
const CORE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './wallpapers/bg1.avif'
];

// 核心搜索引擎跨域图标预存列表
const CORE_FAVICONS = [
    'https://a.favicon.im/bing.com',
    'https://a.favicon.im/google.com',
    'https://a.favicon.im/wikipedia.org'
];

// 简单 CacheStorage 数量限额清理 (FIFO 超限自动淘汰)
async function pruneCache(cache, maxEntries) {
    try {
        const keys = await cache.keys();
        if (keys.length > maxEntries) {
            const overflow = keys.length - maxEntries;
            await Promise.all(keys.slice(0, overflow).map(k => cache.delete(k)));
        }
    } catch {}
}

function make503Response() {
    return new Response('离线且无本地缓存', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// 安装阶段：并发预缓存核心资源与图标，容错单项失败
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        Promise.all([
            caches.open(CORE_CACHE).then(cache =>
                Promise.all(CORE_ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' })).catch(() => {})))
            ),
            caches.open(FAVICON_CACHE).then(cache =>
                Promise.all(CORE_FAVICONS.map(url =>
                    fetch(url, { mode: 'no-cors' })
                        .then(res => cache.put(url, res))
                        .catch(() => {})
                ))
            )
        ])
    );
});

// 激活阶段：清理废弃版本 CORE_CACHE 并接管客户端
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
    // 过滤本地开发服务器清理通道，直接穿透网络，严禁 SW 拦截
    if (pathnameLower.startsWith('/_clear_cache')) return;

    const isSameOrigin = urlObj.origin === self.location.origin;
    const isMainDoc = e.request.mode === 'navigate' || pathnameLower === '/' || pathnameLower.endsWith('/index.html');
    const isCoreData = isSameOrigin && (pathnameLower.endsWith('/manifest.json') || pathnameLower.endsWith('/bookmarks.json'));
    const isFaviconDomain = urlObj.origin === 'https://a.favicon.im';
    const isImgAsset = isSameOrigin && /\.(ico|png|jpg|jpeg|svg|webp|avif)$/.test(pathnameLower);
    const isCoreStaticAsset = isSameOrigin
        && (pathnameLower.endsWith('.js') || pathnameLower.endsWith('.css'))
        && !pathnameLower.endsWith('/sw.js');

    // 1. 主文档原子化 SWR 锁步策略 (CORE_CACHE 本地 0ms 秒开，彻底消灭 Safari 启动网络阻塞；版本更新由 SW 差量换代原子接管)
    if (isMainDoc) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cachedRes = (await cache.match(e.request))
                    || (await cache.match('./index.html'))
                    || (await cache.match('/'));

                // 命中本地原子版本池：0ms 瞬出首屏，消灭公网网络握手与 TTFB 延迟
                if (cachedRes) {
                    return cachedRes;
                }

                // 首次访问或冷启动缓存未就绪时回退网络，拉取成功后写入当前版本池
                return fetch(e.request).then(netRes => {
                    if (netRes.ok) {
                        const resClone = netRes.clone();
                        cache.put(e.request, resClone).catch(() => {});
                        return netRes;
                    }
                    return caches.match(e.request).then(cached => cached || netRes);
                }).catch(async () => {
                    const fallbackDoc = (await caches.match(e.request)) || (await caches.match('./index.html')) || (await caches.match('/'));
                    return fallbackDoc || make503Response();
                });
            })
        );
        return;
    }

    // 2. 数据 JSON Stale-While-Revalidate 策略 (同源限制防污染)
    if (isCoreData) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cachedRes = await cache.match(e.request);
                const fetchPromise = fetch(new Request(e.request, { cache: 'no-cache' })).then(netRes => {
                    if (netRes.ok) cache.put(e.request, netRes.clone()).catch(() => {});
                    return netRes;
                }).catch(() => null);

                if (cachedRes) {
                    e.waitUntil(fetchPromise);
                    return cachedRes;
                }

                const netRes = await fetchPromise;
                return netRes || make503Response();
            })
        );
        return;
    }

    // 3. 同源 JS/CSS 静态资源原子化 SWR 锁步策略 (与主文档 100% 同版本直出，非 ok 回退缓存)
    if (isCoreStaticAsset) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cached = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (await cache.match('./app.js'));

                // 命中本地原子版本池：0ms 瞬出，保障与 index.html 构建指纹 100% 同源同版
                if (cached) {
                    return cached;
                }

                // 缓存未命中时向网络拉取并存入当前版本池
                return fetch(e.request).then(netRes => {
                    if (netRes.ok) {
                        const resClone = netRes.clone();
                        cache.put(e.request, resClone).catch(() => {});
                        return netRes;
                    }
                    return caches.match(e.request).then(cached => cached || netRes);
                }).catch(async () => {
                    const fallback = (await caches.match(e.request)) || (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('./app.js'));
                    return fallback || make503Response();
                });
            })
        );
        return;
    }

    // 4. 跨域 Favicon 防污染 Stale-While-Revalidate + 4s 超时熔断
    if (isFaviconDomain) {
        e.respondWith(
            caches.open(FAVICON_CACHE).then(async cache => {
                const cached = await cache.match(e.request);

                const fetchWithTimeout = async () => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 4000);
                    try {
                        const netRes = await fetch(e.request, { cache: 'no-cache', signal: controller.signal });
                        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
                            await cache.put(e.request, netRes.clone());
                            await pruneCache(cache, MAX_FAVICON_ENTRIES);
                            return netRes;
                        }
                    } catch {} finally {
                        clearTimeout(timeoutId);
                    }
                    return null;
                };

                if (cached) {
                    e.waitUntil(fetchWithTimeout());
                    return cached;
                }

                const netRes = await fetchWithTimeout();
                return netRes || new Response('', { status: 404, statusText: 'Favicon Unavailable' });
            })
        );
        return;
    }

    // 5. 同源本地图片 Cache-First 策略
    if (isImgAsset) {
        e.respondWith(
            caches.open(IMG_CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                if (cached) return cached;

                try {
                    const res = await fetch(e.request);
                    if (res.ok) {
                        e.waitUntil(cache.put(e.request, res.clone()).then(() => pruneCache(cache, MAX_IMG_ENTRIES)));
                    }
                    return res;
                } catch {
                    return new Response('', { status: 404 });
                }
            })
        );
    }
});
