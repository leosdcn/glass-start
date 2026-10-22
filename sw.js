/**
 * 核心、外部图标与同源图片分池缓存，图标和图片按容量限额淘汰。
 * 核心安装校验构建指纹；新版等待用户确认或旧客户端退出后激活。
 * 外部图标允许 opaque 响应入池，无法读取其正文进行校验。
 */

// 缓存池定义（打包 build.js 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
const FAVICON_CACHE = 'app-favicons-v1';
const IMG_CACHE = 'app-images-' + CORE_CACHE;

// 图标与图片容量上限配置
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;
const FAVICON_TIMEOUT_MS = 7000;

// CacheStorage 不会合并同时未命中的请求；多标签或多个图片节点可能重复下载。
const pendingImageResponses = new Map();

function shareImageResponse(event, loadResponse) {
    const request = event.request;
    // 保留请求模式、凭据及响应变体的边界，不将同 URL 的不同请求混在一起。
    const key = JSON.stringify([request.url, request.mode, request.credentials, request.cache,
        request.redirect, request.referrer, request.referrerPolicy, request.integrity,
        request.destination, [...request.headers]]);
    let pending = pendingImageResponses.get(key);
    if (!pending) {
        const cacheTasks = [];
        const waitForCache = task => {
            cacheTasks.push(task);
            event.waitUntil(task);
        };
        pending = Promise.resolve().then(() => loadResponse(waitForCache));
        pendingImageResponses.set(key, pending);
        // 响应可以先返回；写缓存完成前继续合并请求，避免写入窗口重复下载。
        event.waitUntil(pending.then(() => Promise.allSettled(cacheTasks), () => {}).finally(() => {
            if (pendingImageResponses.get(key) === pending) pendingImageResponses.delete(key);
        }));
    }
    // Response 的正文只能消费一次，每个调用者获得独立副本。
    return pending.then(response => response.clone());
}

// 核心预缓存静态资源列表
const CORE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './wallpapers/bg1.avif'
];

const pendingPrunes = new Map();

// CacheStorage 超限时按 FIFO 删除最旧条目；同一缓存池并发写入时微任务合并，避免冗余 keys() 扫描。
function pruneCache(cache, maxEntries, poolKey = '') {
    const key = poolKey || String(maxEntries);
    let pending = pendingPrunes.get(key);
    if (!pending) {
        pending = (async () => {
            try {
                await Promise.resolve();
                const keys = await cache.keys();
                if (keys.length > maxEntries) {
                    const toDelete = keys.slice(0, keys.length - maxEntries);
                    await Promise.all(toDelete.map(k => cache.delete(k)));
                }
            } catch {}
        })().finally(() => {
            if (pendingPrunes.get(key) === pending) pendingPrunes.delete(key);
        });
        pendingPrunes.set(key, pending);
    }
    return pending;
}

function make503Response() {
    return new Response('离线且无本地缓存', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// 核心资源不仅需存在，还必须与当前 worker 的构建指纹一致（单次循环校验存在性与指纹）。
async function validateCoreCache(cache) {
    const fingerprints = {
        './': '__GLASS_BUILD_HTML__',
        './index.html': '__GLASS_BUILD_HTML__',
        './app.js': '__GLASS_BUILD_APP__'
    };
    for (const asset of CORE_ASSETS) {
        const response = await cache.match(asset);
        if (!response || !response.ok) throw new Error('Missing core asset: ' + asset);
        const property = fingerprints[asset];
        if (property) {
            const text = await response.text();
            const fingerprint = text.match(new RegExp(property + `\\s*=\\s*["']([^"']+)`));
            if (fingerprint?.[1] !== CORE_CACHE) throw new Error('Core version mismatch: ' + asset);
        }
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
        // 默认保持 waiting；只有用户确认更新才提前激活。
    })());
});

// 用户确认后允许提前激活；不 claim 未受控页面，避免旧 HTML 混用新脚本。
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

// 仅接受同源窗口的确认；重新校验已下载资源后再跳过等待。
self.addEventListener('message', e => {
    if (e.data?.type !== 'ACTIVATE_UPDATE' || e.source?.type !== 'window' ||
        new URL(e.source.url).origin !== self.location.origin) return;
    e.waitUntil((async () => {
        await validateCoreCache(await caches.open(CORE_CACHE));
        await self.skipWaiting();
    })());
});

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
    const isImgAsset = isSameOrigin && /\.(ico|png|jpg|jpeg|svg|webp|avif)$/.test(pathnameLower);
    // 直接打开图片时仍须返回图片，不能被主文档的离线回退替换成 HTML。
    const isMainDoc = isSameOrigin && !isImgAsset && (
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

                // 命中当前核心池，直接返回缓存文档。
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

    // 2. manifest.json 使用同源 Stale-While-Revalidate。
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

                // 命中当前核心池，返回安装时已校验的应用脚本。
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

    // 跨域图标缓存优先，未命中时使用带超时的网络请求。
    if (isFaviconDomain) {
        e.respondWith(
            shareImageResponse(e, waitForCache => caches.open(FAVICON_CACHE).then(async cache => {
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
                                waitForCache(pruneCache(cache, MAX_FAVICON_ENTRIES, FAVICON_CACHE));
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
            }))
        );
        return;
    }

    // 5. 本地图片按构建分池；每版首次请求绕过旧 HTTP 缓存，离线可回退上一版。
    if (isImgAsset) {
        e.respondWith(
            shareImageResponse(e, waitForCache => caches.open(IMG_CACHE).then(async cache => {
                const cached = (await cache.match(e.request))
                    || (await caches.open(CORE_CACHE).then(core => core.match(e.request)));
                if (cached) return cached;
                try {
                    // 单个消费者取消不能中止其他消费者共用的下载。
                    const res = await fetch(new Request(e.request, { cache: 'reload', signal: new AbortController().signal }));
                    if (res.ok) {
                        waitForCache(cache.put(e.request, res.clone()).then(() => pruneCache(cache, MAX_IMG_ENTRIES, IMG_CACHE)).catch(() => {}));
                        return res;
                    }
                    if (res.status >= 500) return (await previousImageResponse(e.request)) || res;
                    return res;
                } catch {
                    return (await previousImageResponse(e.request)) || new Response('', { status: 404 });
                }
            }))
        );
        return;
    }
});
