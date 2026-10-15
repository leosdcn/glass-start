/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 FIFO 缓存器 (v11 - Modern Edition)
 * ==============================================================================
 * 核心架构特性:
 * 1. 【三池物理隔离】：CORE_CACHE (全站核心)、FAVICON_CACHE (外部图标)、IMG_CACHE (本地图片)
 * 2. 【防透明响应污染】：a.favicon.im 跨域图标 7s 超时熔断 + 合法响应校验入池
 * 3. 【原生 FIFO 容量淘汰】：轻量 pruneCache 自动限制图标 (800) 与图片 (200) 缓存上限，非阻塞后台运行
 * 4. 【版本隔离 Cache-First】：CORE_CACHE 缓存优先，安装验证构建指纹，新版等待旧客户端退出后激活
 */

// 缓存池定义（打包 build.js 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
const FAVICON_CACHE = 'app-favicons-v1';
const IMG_CACHE = 'app-images-' + CORE_CACHE;

// 图标与图片容量上限配置
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;
const FAVICON_TIMEOUT_MS = 7000;

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

// 简单 CacheStorage 数量限额清理 (FIFO 超限自动淘汰，保护核心搜索引擎图标)
async function pruneCache(cache, maxEntries) {
    try {
        const keys = await cache.keys();
        if (keys.length > maxEntries) {
            const protectedUrls = (typeof CORE_FAVICONS !== 'undefined' && Array.isArray(CORE_FAVICONS)) ? CORE_FAVICONS : [];
            const evictableKeys = keys.filter(k => {
                const url = typeof k === 'string' ? k : (k && k.url ? k.url : '');
                return !protectedUrls.includes(url);
            });
            const overflow = keys.length - maxEntries;
            const toDelete = evictableKeys.slice(0, overflow);
            await Promise.all(toDelete.map(k => cache.delete(k)));
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

// 核心资源不仅需存在，还必须与当前 worker 的构建指纹一致。
async function validateCoreCache(cache) {
    for (const asset of CORE_ASSETS) {
        const response = await cache.match(asset);
        if (!response || !response.ok) throw new Error('Missing core asset: ' + asset);
    }
    for (const [asset, property] of [
        ['./', '__GLASS_BUILD_HTML__'],
        ['./index.html', '__GLASS_BUILD_HTML__'],
        ['./app.js', '__GLASS_BUILD_APP__']
    ]) {
        const response = await cache.match(asset);
        const text = await response.text();
        const fingerprint = text.match(new RegExp(property + `\\s*=\\s*["']([^"']+)`));
        if (fingerprint?.[1] !== CORE_CACHE) throw new Error('Core version mismatch: ' + asset);
    }
}

// 核心失败必须拒绝 install；等待所有请求结束再删除残缺池，防止迟到写入。
self.addEventListener('install', e => {
    e.waitUntil((async () => {
        try {
            const cache = await caches.open(CORE_CACHE);
            // 壁纸用条件重验证复用 HTTP 缓存正文；更新时仍检查服务器，不能 force-cache 读取旧图。
            const results = await Promise.allSettled(CORE_ASSETS.map(asset => cache.add(new Request(asset, {
                cache: asset.startsWith('./wallpapers/') ? 'no-cache' : 'reload'
            }))));
            if (results.some(result => result.status === 'rejected')) throw new Error('Core installation incomplete');
            await validateCoreCache(cache);
        } catch (error) {
            await caches.delete(CORE_CACHE);
            throw error;
        }
        // 不强制接管旧页面。更新保持 waiting，旧客户端全部退出后由浏览器激活。
    })());
    // 外部图标失败不影响核心安装，也不改变旧 worker 的控制权。
    e.waitUntil(caches.open(FAVICON_CACHE).then(cache => Promise.allSettled(CORE_FAVICONS.map(url =>
        fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS) })
            .then(res => cache.put(url, res))
    ))).catch(() => {}));
});

// 激活仅发生于旧客户端退出后；不 claim 未受控页面，避免旧 HTML 混用新脚本。
self.addEventListener('activate', e => e.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await validateCoreCache(cache);
    await caches.open(IMG_CACHE);
    const keys = await caches.keys();
    const previousImages = keys.filter(key => key.startsWith('app-images-') && key !== IMG_CACHE)
        .sort((a, b) => imageCacheVersion(b) - imageCacheVersion(a))[0];
    await Promise.all(keys.filter(key =>
        (key.startsWith('app-core-') && key !== CORE_CACHE) ||
        (key.startsWith('app-images-') && key !== IMG_CACHE && key !== previousImages)
    ).map(key => caches.delete(key)));
})()));

function imageCacheVersion(key) {
    return Number(key.match(/app-core-v(\d+)$/)?.[1] || 0);
}

// 仅在网络失败时读取上一版图片，避免在线更新继续使用旧内容。
async function previousImageResponse(request) {
    const keys = (await caches.keys()).filter(key => key.startsWith('app-images-') && key !== IMG_CACHE)
        .sort((a, b) => imageCacheVersion(b) - imageCacheVersion(a));
    for (const key of keys) {
        const cached = await (await caches.open(key)).match(request);
        if (cached) return cached;
    }
    return null;
}

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
    const scopePath = new URL(self.registration ? self.registration.scope : self.location.href).pathname.toLowerCase();
    const scopePathClean = scopePath.endsWith('/') && scopePath.length > 1 ? scopePath.slice(0, -1) : scopePath;
    const isMainDoc = isSameOrigin && (
        e.request.mode === 'navigate'
        || pathnameLower === '/'
        || pathnameLower === scopePath
        || pathnameLower === scopePathClean
        || pathnameLower.endsWith('/index.html')
    );
    const isCoreData = isSameOrigin && pathnameLower.endsWith('/manifest.json');
    const isFaviconDomain = urlObj.origin === 'https://a.favicon.im'
        || (urlObj.origin === 'https://www.google.com' && pathnameLower.startsWith('/s2/favicons'))
        || urlObj.hostname.endsWith('.gstatic.com');
    const isImgAsset = isSameOrigin && /\.(ico|png|jpg|jpeg|svg|webp|avif)$/.test(pathnameLower);
    const isCoreStaticAsset = isSameOrigin
        && (pathnameLower.endsWith('.js') || pathnameLower.endsWith('.css'))
        && !pathnameLower.endsWith('/sw.js');

    // 1. 主文档版本隔离 Cache-First；缓存命中不重验证，新版通过 worker 生命周期换代
    if (isMainDoc) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const cachedRes = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (await cache.match('./index.html'))
                    || (await cache.match('./'))
                    || (await cache.match('/'));

                // 命中本地原子版本池：0ms 瞬出首屏，消灭公网网络握手与 TTFB 延迟
                if (cachedRes) {
                    return cachedRes;
                }

                // 首次访问或冷启动缓存未就绪时回退网络，拉取成功后写入当前版本池
                return fetch(e.request).then(async netRes => {
                    if (netRes.ok) {
                        const resClone = netRes.clone();
                        cache.put(e.request, resClone).catch(() => {});
                        return netRes;
                    }
                    const fallback = (await cache.match(e.request))
                        || (await cache.match(e.request, { ignoreSearch: true }))
                        || (await cache.match('./index.html'))
                        || (await cache.match('./'))
                        || (await cache.match('/'))
                        || (await caches.match(e.request))
                        || (await caches.match(e.request, { ignoreSearch: true }))
                        || (await caches.match('./index.html'))
                        || (await caches.match('./'))
                        || (await caches.match('/'));
                    return fallback || netRes;
                }).catch(async () => {
                    const fallbackDoc = (await cache.match(e.request))
                        || (await cache.match(e.request, { ignoreSearch: true }))
                        || (await cache.match('./index.html'))
                        || (await cache.match('./'))
                        || (await cache.match('/'))
                        || (await caches.match(e.request))
                        || (await caches.match(e.request, { ignoreSearch: true }))
                        || (await caches.match('./index.html'))
                        || (await caches.match('./'))
                        || (await caches.match('/'));
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
                const cachedRes = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }));
                const fetchPromise = fetch(new Request(e.request, { cache: 'no-cache' })).then(netRes => {
                    if (netRes.ok) cache.put(e.request, netRes.clone()).catch(() => {});
                    return netRes;
                }).catch(() => null);

                if (cachedRes) {
                    e.waitUntil(fetchPromise);
                    return cachedRes;
                }

                const netRes = await fetchPromise;
                return netRes
                    || (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (await caches.match(e.request))
                    || (await caches.match(e.request, { ignoreSearch: true }))
                    || make503Response();
            })
        );
        return;
    }

    // 3. 同源 JS/CSS 版本隔离 Cache-First；缓存命中不重验证，非 ok 回退缓存
    if (isCoreStaticAsset) {
        e.respondWith(
            caches.open(CORE_CACHE).then(async cache => {
                const isAppJs = pathnameLower.endsWith('/app.js');
                const cached = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (isAppJs ? await cache.match('./app.js') : null);

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
                    const fallback = (await cache.match(e.request))
                        || (await cache.match(e.request, { ignoreSearch: true }))
                        || (isAppJs ? await cache.match('./app.js') : null)
                        || (await caches.match(e.request))
                        || (await caches.match(e.request, { ignoreSearch: true }))
                        || (isAppJs ? await caches.match('./app.js') : null);
                    return fallback || make503Response();
                });
            })
        );
        return;
    }

    // 4. 跨域 Favicon 防污染 Cache-First + 7s 超时熔断
    if (isFaviconDomain) {
        e.respondWith(
            caches.open(FAVICON_CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                if (cached) return cached;

                const fetchWithTimeout = async () => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS);
                    try {
                        const netRes = await fetch(e.request, { cache: 'no-cache', signal: controller.signal });
                        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
                            try {
                                await cache.put(e.request, netRes.clone());
                                e.waitUntil(pruneCache(cache, MAX_FAVICON_ENTRIES));
                            } catch {}
                            return netRes;
                        }
                    } catch {} finally {
                        clearTimeout(timeoutId);
                    }
                    return null;
                };

                const netRes = await fetchWithTimeout();
                return netRes || new Response('', { status: 404, statusText: 'Favicon Unavailable' });
            })
        );
        return;
    }

    // 5. 本地图片按构建分池；每版首次请求绕过旧 HTTP 缓存，离线可回退上一版。
    if (isImgAsset) {
        e.respondWith(
            caches.open(IMG_CACHE).then(async cache => {
                const cached = (await cache.match(e.request))
                    || (await caches.open(CORE_CACHE).then(core => core.match(e.request)));
                if (cached) return cached;
                try {
                    const res = await fetch(new Request(e.request, { cache: 'reload' }));
                    if (res.ok) {
                        e.waitUntil(cache.put(e.request, res.clone()).then(() => pruneCache(cache, MAX_IMG_ENTRIES)).catch(() => {}));
                        return res;
                    }
                    if (res.status >= 500) return (await previousImageResponse(e.request)) || res;
                    return res;
                } catch {
                    return (await previousImageResponse(e.request)) || new Response('', { status: 404 });
                }
            })
        );
        return;
    }
});
