/**
 * 核心、外部图标与同源图片分池缓存，图标和图片按容量限额淘汰。
 * 核心安装校验构建指纹；新版等待用户确认或旧客户端退出后激活。
 * 外部图标允许 opaque 响应入池，无法读取其正文进行校验。
 */

/** @typedef {ServiceWorkerGlobalScope & typeof globalThis} ServiceWorkerContext */

// 缓存池定义（打包 build.cjs 时自动替换 CORE_CACHE 为时间戳版本）
const CORE_CACHE = 'app-core-v1786255428688';
// 图标池不对称隔离：外部 Favicon 与应用构建代码正交，跨版本保留以节省流量与网络 IO，故不挂钩 CORE_CACHE
const FAVICON_CACHE = 'app-favicons-v1';
const SCOPE_URL = /** @type {ServiceWorkerContext} */ (self).registration.scope;
const SCOPE = new URL(SCOPE_URL);
const CACHE_PREFIX = 'glass-scope-' + encodeURIComponent(SCOPE.pathname) + '-';
const CORE_STORAGE = CACHE_PREFIX + CORE_CACHE;
const IMG_CACHE = CACHE_PREFIX + 'app-images-' + CORE_CACHE;
const IMAGE_PREFIX = CACHE_PREFIX + 'app-images-';
const CORE_PREFIX = CACHE_PREFIX + 'app-core-';
const APP_ASSET = `./app-builds/${CORE_CACHE}.js`;
const ACTIVATED_CORE = new URL('./.glass-core-activated', SCOPE_URL).href;
const CORE_PREDECESSORS = new URL('./.glass-core-predecessors', SCOPE_URL).href;
const LEGACY_APP = new URL('./app.js', SCOPE_URL).href;

/** @param {string} key @param {string} prefix */
function isScopedCache(key, prefix) {
    // 部署路径以编码后的斜杠结尾，更深路径可能也匹配前缀。
    return key.startsWith(prefix) && !key.includes('%2F-', CACHE_PREFIX.length);
}

// 图标与图片容量上限配置
const MAX_FAVICON_ENTRIES = 800;
const MAX_IMG_ENTRIES = 200;
const FAVICON_TIMEOUT_MS = 7000;
// SW 内部指令常量（须与 src/js/config/constants.js 中的 CONFIG.SW_MESSAGES.ACTIVATE_UPDATE 严格同步）
const SW_MESSAGES = {
    ACTIVATE_UPDATE: 'ACTIVATE_UPDATE'
};

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
    APP_ASSET
];
const DEFAULT_WALLPAPER = './wallpapers/bg1.avif';

/** @param {URL} url */
function scopedPath(url) {
    return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)
        ? url.pathname.slice(SCOPE.pathname.length) : null;
}

/** @param {string | null} path */
function isAppDocument(path) {
    return path === '' || path === 'index.html';
}

/** @type {Map<string, { dirty: boolean, task: Promise<void> }>} */
const pendingPrunes = new Map();

// CacheStorage 超限时按 FIFO 删除最旧条目；同一缓存池并发写入时微任务合并，避免冗余 keys() 扫描。
/** @param {Cache} cache @param {number} maxEntries @param {string} key */
function pruneCache(cache, maxEntries, key) {
    const pending = pendingPrunes.get(key);
    if (pending) {
        pending.dirty = true;
        return pending.task;
    }
    const state = { dirty: true, task: Promise.resolve() };
    state.task = (async () => {
        try {
            await Promise.resolve();
            while (state.dirty) {
                state.dirty = false;
                const keys = await cache.keys();
                if (keys.length > maxEntries) {
                    const toDelete = keys.slice(0, keys.length - maxEntries);
                    await Promise.all(toDelete.map(k => cache.delete(k)));
                }
            }
        } catch {} finally {
            pendingPrunes.delete(key);
        }
    })();
    pendingPrunes.set(key, state);
    return state.task;
}

function make503Response() {
    return new Response('离线且无本地缓存', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

// 每个构建只接收属于自己的文档和脚本。
/** @param {Cache} cache */
async function validateCoreCache(cache) {
    for (const asset of CORE_ASSETS) {
        if (!await validCoreResponse(asset, await cache.match(asset))) {
            throw new Error('Missing or invalid core asset: ' + asset);
        }
    }
}

/** @param {Response} response @param {string} property @param {string} version */
async function matchesBuild(response, property, version) {
    const text = await response.clone().text();
    return text.match(new RegExp(property + `\\s*=\\s*["']([^"']+)`))?.[1] === version;
}

/** @param {Response | undefined} response */
function isImageResponse(response) {
    return !!response?.ok && /^image\//i.test(response.headers.get('content-type') ?? '');
}

/** @param {Response | undefined} response */
async function isManifestResponse(response) {
    if (!response?.ok || !/^application\/(manifest\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return false;
    try {
        const data = await response.clone().json();
        return !!data && typeof data === 'object' && !Array.isArray(data);
    } catch {
        return false;
    }
}

// 只补缺失或指纹不符的资源；所有响应在写入前校验，不污染仍可用的旧构建。
/** @param {string} asset @param {Response | undefined} response */
async function validCoreResponse(asset, response) {
    if (!response?.ok) return false;
    const property = asset === APP_ASSET ? '__GLASS_BUILD_APP__'
        : (asset === './' || asset === './index.html') ? '__GLASS_BUILD_HTML__' : null;
    return !property || matchesBuild(response, property, CORE_CACHE);
}

/** @param {Cache} cache @param {string[]} [assets] */
async function repairCoreCache(cache, assets = CORE_ASSETS) {
    for (const asset of assets) {
        if (await validCoreResponse(asset, await cache.match(asset))) continue;
        const response = await fetch(new Request(new URL(asset, SCOPE_URL), { cache: 'reload' }));
        if (!await validCoreResponse(asset, response)) throw new Error('Cannot repair core asset: ' + asset);
        await cache.put(asset, response);
    }
}

// 当前版本已不可补齐时返回独立恢复页，避免把新脚本交给旧 HTML。
// 用户点击后安装并校验新版，控制器切换完成才重载；失败或离线可重试。
function recoveryResponse() {
    const script = `document.querySelector('button').onclick=async function(){
        this.disabled=true;const status=document.querySelector('p');
        try{
            const repaired=await fetch(location.href,{cache:'reload'}).then(response=>response.ok,()=>false);
            if(repaired){location.reload();return}
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
            reg.waiting.postMessage({type:'${SW_MESSAGES.ACTIVATE_UPDATE}'});
            await activated;location.reload();
        }catch(error){status.textContent='暂时无法修复，请恢复网络后重试。 / Unable to repair. Please reconnect and retry.';this.disabled=false}
    };`;
    return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>修复本地缓存 / Repair Local Cache</title><body><h1>本地应用缓存不完整 / Local cache is incomplete</h1><p>请连接网络，修复后重新加载。已保存的设置会保留。<br>Please connect to the internet and repair. Saved settings will be kept.</p><button type="button">修复并重新加载 / Repair and Reload</button><script nonce="glass-recovery">' + script + '</script></body></html>', {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; script-src 'nonce-glass-recovery'; worker-src 'self'; object-src 'none'; base-uri 'none'" }
    });
}

// 核心失败必须拒绝 install；等待所有请求结束再删除残缺池，防止迟到写入。
/** @type {ServiceWorkerContext} */ (self).addEventListener('install', e => {
    e.waitUntil((async () => {
        try {
            // 安装任务按注册串行。记录先于本次安装的池，供日后接管时回收。
            const predecessors = (await caches.keys()).filter(key => isScopedCache(key, CORE_PREFIX) && key !== CORE_STORAGE);
            const cache = await caches.open(CORE_STORAGE);
            const results = await Promise.allSettled(CORE_ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' }))));
            if (results.some(result => result.status === 'rejected')) throw new Error('Core installation incomplete');
            await validateCoreCache(cache);
            await cache.put(CORE_PREDECESSORS, Response.json(predecessors));
            // 条件重验证复用 HTTP 缓存正文；缺图仍允许安装并离线启动。
            try {
                const wallpaper = await fetch(new Request(DEFAULT_WALLPAPER, {
                    cache: 'no-cache', signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS)
                }));
                if (isImageResponse(wallpaper)) await cache.put(DEFAULT_WALLPAPER, wallpaper);
            } catch {}
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
    await caches.open(IMG_CACHE);
    const keys = await caches.keys();
    const otherImages = keys.filter(key => isScopedCache(key, IMAGE_PREFIX) && key !== IMG_CACHE);
    const previousImages = otherImages
        .sort((a, b) => cacheBuildTime(b) - cacheBuildTime(a))[0];
    const predecessors = new Set(await (await cache.match(CORE_PREDECESSORS))?.json() ?? []);
    // 只回收本次安装前已存在的池，下一次安装即使先进入 waiting 也不在本次回收范围。
    const candidates = keys.filter(key => predecessors.has(key) && isScopedCache(key, CORE_PREFIX))
        .sort((a, b) => cacheBuildTime(b) - cacheBuildTime(a));
    const markers = await Promise.all(candidates.map(cacheName => caches.match(ACTIVATED_CORE, { cacheName })));
    const previous = candidates[markers.findIndex(Boolean)];
    // 迁移时保留仍可能被旧 HTML 引用的旧入口。
    const legacy = previous ? [] : await Promise.all(candidates.map(cacheName => caches.match(LEGACY_APP, { cacheName })));
    const retiredCore = candidates.filter((key, index) => key !== previous && !legacy[index]);
    await cache.put(ACTIVATED_CORE, new Response(''));
    const retiredImages = otherImages.filter(key => key !== previousImages);
    await Promise.all([...retiredCore, ...retiredImages].map(key => caches.delete(key)));
})()));

// 仅接受同源窗口的确认；重新校验已下载资源后再跳过等待。
/** @type {ServiceWorkerContext} */ (self).addEventListener('message', e => {
    const client = /** @type {Client | null} */ (e.source);
    if (e.data?.type !== SW_MESSAGES.ACTIVATE_UPDATE || client?.type !== 'window' ||
        !isAppDocument(scopedPath(new URL(client.url)))) return;
    e.waitUntil((async () => {
        await repairCoreCache(await caches.open(CORE_STORAGE));
        await /** @type {ServiceWorkerContext} */ (self).skipWaiting();
    })());
});

/** @param {string} key */
function cacheBuildTime(key) {
    return Number(key.match(/app-core-v(\d+)(?:-[0-9a-f]{16})?$/)?.[1] || 0);
}

// 仅在网络失败时读取上一版图片，避免在线更新继续使用旧内容。
/** @param {Request} request */
async function previousImageResponse(request) {
    const keys = (await caches.keys()).filter(key => isScopedCache(key, IMAGE_PREFIX) && key !== IMG_CACHE)
        .sort((a, b) => cacheBuildTime(b) - cacheBuildTime(a));
    for (const key of keys) {
        const cached = await caches.match(request, { cacheName: key });
        if (cached && isImageResponse(cached)) return cached;
    }
    if (request.url === new URL(DEFAULT_WALLPAPER, SCOPE_URL).href) {
        const previousCore = (await caches.keys()).filter(key => isScopedCache(key, CORE_PREFIX) && key !== CORE_STORAGE)
            .sort((a, b) => cacheBuildTime(b) - cacheBuildTime(a));
        for (const key of previousCore) {
            const cached = await caches.match(request, { cacheName: key });
            if (cached && isImageResponse(cached)) return cached;
        }
    }
    return null;
}

// 拦截 Fetch 请求阶段
/** @type {ServiceWorkerContext} */ (self).addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;

    const urlObj = new URL(e.request.url);
    const path = scopedPath(urlObj);
    const isImgAsset = path !== null && (path === 'favicon.ico' || path === 'apple-touch-icon.png' ||
        (/^(icons|wallpapers)\//.test(path) && /\.(ico|png|jpe?g|svg|webp|avif)$/i.test(path)));
    const isFaviconDomain = urlObj.origin === 'https://a.favicon.im'
        || (urlObj.origin === 'https://www.google.com' && urlObj.pathname === '/s2/favicons');

    // 1. 主文档版本隔离 Cache-First；缓存命中不重验证，新版通过 worker 生命周期换代
    if (isAppDocument(path)) {
        const asset = path === '' ? './' : './index.html';
        e.respondWith(
            caches.open(CORE_STORAGE).then(async cache => {
                try {
                    const [document, script] = await Promise.all([cache.match(asset), cache.match(APP_ASSET)]);
                    if (document && await validCoreResponse(asset, document) && await validCoreResponse(APP_ASSET, script)) {
                        return document;
                    }
                    await repairCoreCache(cache, [asset, APP_ASSET]);
                    return (await cache.match(asset)) || make503Response();
                } catch {
                    return recoveryResponse();
                }
            })
        );
        return;
    }

    // 2. manifest.json 使用同源 Stale-While-Revalidate。
    if (path === 'manifest.json') {
        const asset = './manifest.json';
        e.respondWith(
            caches.open(CORE_STORAGE).then(async cache => {
                const cachedRes = await cache.match(asset);
                const fetchPromise = fetch(new Request(e.request, { cache: 'no-cache' })).then(async netRes => {
                    if (await isManifestResponse(netRes)) await cache.put(asset, netRes.clone()).catch(() => {});
                    else if (netRes.ok) return null;
                    return netRes;
                }).catch(() => null);

                if (cachedRes && await isManifestResponse(cachedRes)) {
                    e.waitUntil(fetchPromise);
                    return cachedRes;
                }

                return await fetchPromise || make503Response();
            })
        );
        return;
    }

    // 已解析的旧 HTML 即使被新版 Worker 接管，仍只会收到自己引用的构建。
    const legacyVersion = path === 'app.js' ? urlObj.searchParams.get('v') : null;
    const scriptVersion = /^app-builds\/(app-core-v\d+(?:-[0-9a-f]{16})?)\.js$/.exec(path ?? '')?.[1];
    const requestedVersion = scriptVersion ?? (/^app-core-v\d+$/.test(legacyVersion ?? '') ? legacyVersion : null);
    if (requestedVersion) {
        e.respondWith((async () => {
            const asset = scriptVersion ? `./${path}` : './app.js';
            const cacheName = CACHE_PREFIX + requestedVersion;
            try {
                const cached = await caches.match(new URL(asset, SCOPE_URL), { cacheName });
                if (cached?.ok && await matchesBuild(cached, '__GLASS_BUILD_APP__', requestedVersion)) {
                    return cached;
                }
                if (!scriptVersion) return make503Response();
                const response = await fetch(e.request, cached ? { cache: 'reload' } : undefined);
                if (!response.ok || !await matchesBuild(response, '__GLASS_BUILD_APP__', requestedVersion)) {
                    return make503Response();
                }
                if (requestedVersion === CORE_CACHE) {
                    const cache = await caches.open(CORE_STORAGE);
                    await cache.put(asset, response.clone()).catch(() => {});
                }
                return response;
            } catch {
                return make503Response();
            }
        })());
        return;
    }

    // 跨域图标缓存优先，未命中时使用带超时的网络请求。
    if (isFaviconDomain) {
        e.respondWith((async () => {
            const client = e.clientId ? await /** @type {ServiceWorkerContext} */ (self).clients.get(e.clientId) : null;
            if (!client || !isAppDocument(scopedPath(new URL(client.url)))) return fetch(e.request);
            return shareImageResponse(e, waitForCache => caches.open(FAVICON_CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                if (cached) return cached;

                const fetchWithTimeout = async () => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS);
                    try {
                        const netRes = await fetch(e.request, { cache: 'no-cache', signal: controller.signal });
                        if (isImageResponse(netRes) || netRes.type === 'opaque') {
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
            }));
        })());
        return;
    }

    // 5. 本地图片按构建分池；每版首次请求绕过旧 HTTP 缓存，离线可回退上一版。
    if (isImgAsset) {
        e.respondWith(
            shareImageResponse(e, waitForCache => caches.open(IMG_CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                if (cached && isImageResponse(cached)) return cached;
                const precached = await caches.match(e.request, { cacheName: CORE_STORAGE });
                if (precached && isImageResponse(precached)) return precached;
                try {
                    // 单个消费者取消不能中止其他消费者共用的下载。
                    const res = await fetch(new Request(e.request, { cache: 'reload', signal: new AbortController().signal }));
                    if (isImageResponse(res)) {
                        waitForCache(cache.put(e.request, res.clone()).then(() => pruneCache(cache, MAX_IMG_ENTRIES, IMG_CACHE)).catch(() => {}));
                        return res;
                    }
                    if (!res.ok && res.status < 500) return res;
                    return (await previousImageResponse(e.request)) || (res.ok ? make503Response() : res);
                } catch {
                    return (await previousImageResponse(e.request)) || new Response('', { status: 404 });
                }
            }))
        );
        return;
    }
});
