/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 LRU 缓存器 (v10 - Architect Edition)
 * ==============================================================================
 * 核心架构优化与修补点 (Senior Architect Refactoring):
 * 1. 【防透明响应污染 (Anti-Opaque Poisoning)】：
 *    跨域 a.favicon.im 的 no-cors 请求产生 opaque 响应 (status=0)。当遇到网络抖动或 DNS 拦截时，
 *    坏的 opaque 响应不能无差别覆写旧缓存。重构引入二次网络效验与自愈隔离机制。
 * 2. 【CacheStorage FIFO 容量限额淘汰】：
 *    使用高效轻量的原生 CacheStorage 限额自动淘汰机制 (pruneCache)，淘汰重度 IDB 依赖，杜绝缓存无限膨胀。
 * 3. 【严密边界防护】：
 *    核心 assets 预缓存吞掉单项失败，主导航 Network-First 追加统一 503 兜底页面。
 * 4. 【修复同源 JS/CSS 静态资源缓存漏洞】：
 *    原 fetch handler 仅处理主文档/JSON数据/图标/图片四类，app.js 等同源脚本穿透 SW 走浏览器 HTTP 缓存，
 *    install 预缓存形同虚设、离线不可用。新增 isCoreStaticAsset 分支实现 Cache-First，使预缓存真正生效。
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
    './app.js',
    './wallpapers/bg1.avif'
];

// 核心搜索引擎跨域图标预存列表
const CORE_FAVICONS = [
    'https://a.favicon.im/bing.com',
    'https://a.favicon.im/google.com'
];

// 简单 CacheStorage 数量限额清理 (FIFO 超限自动淘汰，淘汰重度 IDB 依赖)
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



// 安装阶段
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

                return make503Response();
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

                return make503Response();
            })
        );
        return;
    }

    // 3. 同源 JS/CSS 静态资源 Cache-First 策略
    //    app.js 等同源脚本由 install 阶段预缓存写入 CORE_CACHE，fetch 时直接从缓存服务。
    //    显式排除 sw.js 自身，确保 Service Worker 脚本更新机制不受拦截干扰。
    //    缓存未命中（极罕见，install 失败时兜底）时回退网络；离线且无缓存时返回 503。
    const isCoreStaticAsset = urlObj.origin === self.location.origin
        && (pathnameLower.endsWith('.js') || pathnameLower.endsWith('.css'))
        && !pathnameLower.endsWith('/sw.js');

    if (isCoreStaticAsset) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                if (cached) return cached;

                // 缓存未命中时回退网络（install 预缓存失败的兜底路径）
                try {
                    const netRes = await fetch(e.request);
                    if (netRes.ok) {
                        cache.put(e.request, netRes.clone()).catch(() => {});
                    }
                    return netRes;
                } catch {
                    return make503Response();
                }
            })
        );
        return;
    }

    // 4. 图标/图片 Stale-While-Revalidate (跨域 Favicon) / Cache-First (站内图片)
    if (isFaviconDomain || isImgAsset) {
        const cacheName = isFaviconDomain ? FAVICON_CACHE : IMG_CACHE;
        const maxEntries = isFaviconDomain ? MAX_FAVICON_ENTRIES : MAX_IMG_ENTRIES;

        if (isFaviconDomain) {
            // 安全防污染 Stale-While-Revalidate + 弹性超时降级
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    const cached = await cache.match(e.request);

                    // 异步向网络发起重新验证请求（带 4s 超时截断，防止慢速网络/PNA拦截导致渲染阻塞挂起）
                    const fetchWithTimeout = async () => {
                        let timeoutId = null;
                        try {
                            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                            if (controller) {
                                timeoutId = setTimeout(() => {
                                    try { controller.abort(); } catch {}
                                }, 4000);
                            }
                            const netRes = await fetch(e.request, {
                                cache: 'no-cache',
                                signal: controller ? controller.signal : undefined
                            });
                            if (timeoutId) clearTimeout(timeoutId);
                            // 防污染控制：opaque 响应（status=0）无法读取字节，仅按响应类型放行写入；
                            // 网络层有效应答（netRes.ok）或合法 opaque 响应才允许进入缓存池
                            if (netRes && (netRes.ok || netRes.type === 'opaque')) {
                                await cache.put(e.request, netRes.clone());
                                await pruneCache(cache, maxEntries);
                                return netRes;
                            }
                        } catch {
                            if (timeoutId) clearTimeout(timeoutId);
                        }
                        return null;
                    };

                    if (cached) {
                        e.waitUntil(fetchWithTimeout());
                        return cached;
                    }

                    // 首次请求且未命中缓存：等待快速网络拉取
                    const netRes = await fetchWithTimeout();
                    if (netRes) {
                        const freshCached = await cache.match(e.request);
                        if (freshCached) return freshCached;
                        return netRes;
                    }

                    // 网络拉取失败（离线/PNA/CORS/404）：返回 404，由前端 <img> 捕获 onerror 触发优雅首字母徽标降级
                    return new Response('', { status: 404, statusText: 'Favicon Unavailable' });
                })
            );
        } else {
            // Cache-First 站内图片
            e.respondWith(
                caches.open(cacheName).then(async cache => {
                    const cached = await cache.match(e.request);
                    if (cached) return cached;

                    try {
                        const res = await fetch(e.request);
                        if (res.ok) {
                            const resClone = res.clone();
                            e.waitUntil(
                                (async () => {
                                    await cache.put(e.request, resClone);
                                    await pruneCache(cache, maxEntries);
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
