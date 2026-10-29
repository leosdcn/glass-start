/**
 * 核心、外部图标与同源图片分池缓存，图标和图片按容量限额淘汰。
 * 核心安装校验构建指纹；新版等待用户确认或旧客户端退出后激活。
 * 外部图标允许 opaque 响应入池，无法读取其正文进行校验。
 */

/** @typedef {ServiceWorkerGlobalScope & typeof globalThis} ServiceWorkerContext */

// 缓存池定义（打包 build.cjs 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
const FAVICON_CACHE = 'app-favicons-v1';
const SCOPE_URL = /** @type {ServiceWorkerContext} */ (self).registration.scope;
const CACHE_PREFIX = 'glass-scope-' + encodeURIComponent(new URL(SCOPE_URL).pathname) + '-';
const CORE_STORAGE = CACHE_PREFIX + CORE_CACHE;
const IMG_CACHE = CACHE_PREFIX + 'app-images-' + CORE_CACHE;
const IMAGE_PREFIX = CACHE_PREFIX + 'app-images-';
const CORE_PREFIX = CACHE_PREFIX + 'app-core-';

// 图标与图片容量上限配置
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;
const FAVICON_TIMEOUT_MS = 7000;

// CacheStorage 不会合并同时未命中的请求；多标签或多个图片节点可能重复下载。
/** @type {Map<string, Promise<Response>>} */
const pendingImageResponses = new Map();

/**
 * @param {FetchEvent} event
 * @param {(waitForCache: (task: Promise<unknown>) => void) => Promise<Response>} loadResponse
 */
function shareImageResponse(event, loadResponse) {
    const request = event.request;
    // 保留请求模式、凭据及响应变体的边界，不将同 URL 的不同请求混在一起。
    const key = JSON.stringify([request.url, request.mode, request.credentials, request.cache,
        request.redirect, request.referrer, request.referrerPolicy, request.integrity,
        request.destination, [...request.headers]]);
    let pending = pendingImageResponses.get(key);
    if (!pending) {
        /** @type {Promise<unknown>[]} */
        const cacheTasks = [];
        /** @param {Promise<unknown>} task */
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

/** @type {Map<string, Promise<void>>} */
const pendingPrunes = new Map();

// CacheStorage 超限时按 FIFO 删除最旧条目；同一缓存池并发写入时微任务合并，避免冗余 keys() 扫描。
/** @param {Cache} cache @param {number} maxEntries @param {string} [poolKey] */
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
/** @param {Cache} cache */
async function validateCoreCache(cache) {
    /** @type {Partial<Record<string, string>>} */
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

// 只补缺失或指纹不符的资源；所有响应在写入前校验，不污染仍可用的旧构建。
/** @param {string} asset @param {Response | undefined} response */
async function validCoreResponse(asset, response) {
    if (!response?.ok) return false;
    const property = asset === './app.js' ? '__GLASS_BUILD_APP__'
        : (asset === './' || asset === './index.html') ? '__GLASS_BUILD_HTML__' : null;
    if (!property) return true;
    const text = await response.clone().text();
    return text.match(new RegExp(property + `\\s*=\\s*["']([^"']+)`))?.[1] === CORE_CACHE;
}

/** @param {Cache} cache */
async function repairCoreCache(cache) {
    for (const asset of CORE_ASSETS) {
        if (await validCoreResponse(asset, await cache.match(asset))) continue;
        const response = await fetch(new Request(new URL(asset, SCOPE_URL), { cache: 'reload' }));
        if (!await validCoreResponse(asset, response)) throw new Error('Cannot repair core asset: ' + asset);
        await cache.put(asset, response);
    }
    await validateCoreCache(cache);
}

// 旧池只在资源路径能明确归属本实例时迁移；父 scope 不能据 URL 前缀接管子部署。
async function migrateLegacyImages() {
    const keys = (await caches.keys()).filter(key => /^(app-core-|app-images-)/.test(key));
    for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        const corePaths = [...CORE_ASSETS, './manifest.json'].map(asset => new URL(asset, SCOPE_URL).href);
        const owned = requests.length > 0 && requests.every(request => {
            const url = new URL(request.url);
            url.search = '';
            return key.startsWith('app-core-') ? corePaths.includes(url.href)
                : ['./icons/', './wallpapers/'].some(path => url.href.startsWith(new URL(path, SCOPE_URL).href));
        });
        if (!owned) continue;
        if (key.startsWith('app-images-')) {
            const target = await caches.open(CACHE_PREFIX + key);
            for (const request of requests) {
                const response = await cache.match(request);
                if (response) await target.put(request, response);
            }
        }
        await caches.delete(key);
    }
}

// 当前版本已不可补齐时返回独立恢复页，避免把新脚本交给旧 HTML。
// 用户点击后安装并校验新版，控制器切换完成才重载；失败或离线可重试。
function recoveryResponse() {
    const script = `document.querySelector('button').onclick=async function(){
        this.disabled=true;const status=document.querySelector('p');
        try{
            const reg=await navigator.serviceWorker.getRegistration();
            await reg.update();
            const worker=reg.installing;
            if(worker&&!['installed','redundant'].includes(worker.state))await new Promise(resolve=>{
                worker.addEventListener('statechange',()=>{if(['installed','redundant'].includes(worker.state))resolve()});
            });
            if(!reg.waiting)throw Error('新版暂不可用');
            const activated=new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(Error('修复超时'))},15000);
                function changed(){clearTimeout(timer);resolve()}
                navigator.serviceWorker.addEventListener('controllerchange',changed,{once:true});
            });
            reg.waiting.postMessage({type:'ACTIVATE_UPDATE'});
            await activated;location.reload();
        }catch(error){status.textContent='暂时无法修复，请恢复网络后重试。';this.disabled=false}
    };`;
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>修复本地缓存</title><body><h1>本地应用缓存不完整</h1><p>请连接网络，修复后重新加载。已保存的设置会保留。</p><button type="button">修复并重新加载</button><script nonce="glass-recovery">' + script + '</script></body></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; script-src 'nonce-glass-recovery'; worker-src 'self'; object-src 'none'; base-uri 'none'" }
    });
}

// 核心失败必须拒绝 install；等待所有请求结束再删除残缺池，防止迟到写入。
/** @type {ServiceWorkerContext} */ (self).addEventListener('install', e => {
    e.waitUntil((async () => {
        try {
            const cache = await caches.open(CORE_STORAGE);
            // 壁纸用条件重验证复用 HTTP 缓存正文；更新时仍检查服务器，不能 force-cache 读取旧图。
            const results = await Promise.allSettled(CORE_ASSETS.map(asset => cache.add(new Request(asset, {
                cache: asset.startsWith('./wallpapers/') ? 'no-cache' : 'reload'
            }))));
            if (results.some(result => result.status === 'rejected')) throw new Error('Core installation incomplete');
            await validateCoreCache(cache);
        } catch (error) {
            await caches.delete(CORE_STORAGE);
            throw error;
        }
        // 默认保持 waiting；只有用户确认更新才提前激活。
    })());
});

// 用户确认后允许提前激活；不 claim 未受控页面，避免旧 HTML 混用新脚本。
/** @type {ServiceWorkerContext} */ (self).addEventListener('activate', e => e.waitUntil((async () => {
    const cache = await caches.open(CORE_STORAGE);
    await validateCoreCache(cache);
    await migrateLegacyImages();
    await caches.open(IMG_CACHE);
    const keys = await caches.keys();
    const previousImages = keys.filter(key => key.startsWith(IMAGE_PREFIX) && key !== IMG_CACHE)
        .sort((a, b) => imageCacheVersion(b) - imageCacheVersion(a))[0];
    await Promise.all(keys.filter(key =>
        (key.startsWith(CORE_PREFIX) && key !== CORE_STORAGE) ||
        (key.startsWith(IMAGE_PREFIX) && key !== IMG_CACHE && key !== previousImages)
    ).map(key => caches.delete(key)));
})()));

// 仅接受同源窗口的确认；重新校验已下载资源后再跳过等待。
/** @type {ServiceWorkerContext} */ (self).addEventListener('message', e => {
    if (e.data?.type !== 'ACTIVATE_UPDATE' || /** @type {Client | null} */ (e.source)?.type !== 'window' ||
        !/** @type {Client} */ (e.source).url.startsWith(SCOPE_URL)) return;
    e.waitUntil((async () => {
        await repairCoreCache(await caches.open(CORE_STORAGE));
        await /** @type {ServiceWorkerContext} */ (self).skipWaiting();
    })());
});

/** @param {string} key */
function imageCacheVersion(key) {
    return Number(key.match(/app-core-v(\d+)$/)?.[1] || 0);
}

// 仅在网络失败时读取上一版图片，避免在线更新继续使用旧内容。
/** @param {Request} request */
async function previousImageResponse(request) {
    const keys = (await caches.keys()).filter(key => key.startsWith(IMAGE_PREFIX) && key !== IMG_CACHE)
        .sort((a, b) => imageCacheVersion(b) - imageCacheVersion(a));
    for (const key of keys) {
        const cached = await (await caches.open(key)).match(request);
        if (cached) return cached;
    }
    return null;
}

// 拦截 Fetch 请求阶段
/** @type {ServiceWorkerContext} */ (self).addEventListener('fetch', e => {
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
    const scopePath = new URL(/** @type {ServiceWorkerContext} */ (self).registration
        ? /** @type {ServiceWorkerContext} */ (self).registration.scope
        : self.location.href).pathname.toLowerCase();
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
            caches.open(CORE_STORAGE).then(async cache => {
                const cachedRes = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (await cache.match('./index.html'))
                    || (await cache.match('./'))
                    || (await cache.match('/'));

                // 导航先检查核心资源存在性；仅异常时执行完整修复和指纹校验。
                const complete = (await Promise.all(CORE_ASSETS.map(asset => cache.match(asset))))
                    .every(response => response?.ok);
                if (cachedRes && complete) return cachedRes;
                try {
                    await repairCoreCache(cache);
                    return (await cache.match('./index.html')) || make503Response();
                } catch {
                    return recoveryResponse();
                }
            })
        );
        return;
    }

    // 2. manifest.json 使用同源 Stale-While-Revalidate。
    if (isCoreData) {
        e.respondWith(
            caches.open(CORE_STORAGE).then(async cache => {
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
            caches.open(CORE_STORAGE).then(async cache => {
                const isAppJs = pathnameLower.endsWith('/app.js');
                const cached = (await cache.match(e.request))
                    || (await cache.match(e.request, { ignoreSearch: true }))
                    || (isAppJs ? await cache.match('./app.js') : null);

                // 命中当前核心池，返回安装时已校验的应用脚本。
                if (cached) {
                    return cached;
                }

                try {
                    const response = await fetch(new Request(e.request, { cache: 'reload' }));
                    if (!response.ok || (isAppJs && !await validCoreResponse('./app.js', response))) {
                        return make503Response();
                    }
                    await cache.put(e.request, response.clone());
                    return response;
                } catch {
                    return make503Response();
                }
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
                    || (await caches.open(CORE_STORAGE).then(core => core.match(e.request)));
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
