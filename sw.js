/**
 * ==============================================================================
 * Service Worker: 高性能全站离线与图标 LRU 缓存器 (v7)
 * ==============================================================================
 * 核心功能：
 * 1. 【Network-First 网络优先】：主文档 (index.html)、样式表 (style.css)、数据清单 (bookmarks.json, manifest.json)
 *    优先走网络 (带 cache: 'no-cache' 绕过浏览器 HTTP 强缓存) 获取最新版本，确保部署即更新；断网自动降级退回 Cache 本地离线兜底。
 * 2. 【Cache-First 缓存优先】：图标与图片资源优先命中本地缓存秒开 (0ms)，未命中才联网下载。
 * 3. 【真 LRU 动态更新与容量控制】：命中缓存时动态将其调至队列末尾，超过 250 条时淘汰最久未使用的项 (Least Recently Used)。
 * 4. 【全资源精准匹配】：涵盖 HTML, CSS, JSON, SVG, PNG, ICO, WebP 及 favicon.im 外部图标。
 */

// 缓存版本号（打包 build.js 时会自动更名为时间戳版本）
const CACHE = 'app-cache-v1';
// 缓存文件条目上限（250 条）
const MAX_ENTRIES = 250;

// 核心预缓存静态资源列表（PWA 离线打不开保障）
const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './icon.svg',
    './manifest.json',
    './bookmarks.json'
];

// 安装阶段：预缓存核心静态文件，跳过等待强制激活最新 SW
self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(CORE_ASSETS).catch(() => {}))
    );
});

// 激活阶段：清理旧版本 CACHE 存储，并接管当前客户端页面
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
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
    const isMainDoc = e.request.mode === 'navigate' || pathnameLower === '/' || pathnameLower.endsWith('/index.html') || pathnameLower === '';
    const isCoreData = pathnameLower.endsWith('/style.css') || pathnameLower.endsWith('/bookmarks.json') || pathnameLower.endsWith('/manifest.json');
    const isFaviconDomain = urlObj.origin === 'https://favicon.im';
    const isImgAsset = /\.(ico|png|jpg|jpeg|svg|webp)$/i.test(pathnameLower);

    // 1. 对 index.html (主文档)、style.css、bookmarks.json、manifest.json 采取 Network-First 策略
    // 附带 { cache: 'no-cache' } 强制向服务器发起条件请求，绕过浏览器 HTTP 磁盘强缓存
    if (isMainDoc || isCoreData) {
        const fetchReq = e.request.mode === 'navigate'
            ? e.request
            : new Request(e.request, { cache: 'no-cache' });

        e.respondWith(
            fetch(fetchReq).then(netRes => {
                if (netRes.ok) {
                    const resClone = netRes.clone();
                    caches.open(CACHE).then(cache => cache.put(e.request, resClone));
                }
                return netRes;
            }).catch(() => caches.match(e.request)) // 网络失败/断网时退回本地 Cache 兜底
        );
        return;
    }

    // 2. 对图标及图片资源（favicon.im 域名、.ico/.svg/.png 等）采取 Cache-First 策略 + 真 LRU 调序
    if (isFaviconDomain || isImgAsset) {
        e.respondWith(
            caches.open(CACHE).then(async cache => {
                // 优先命中本地 Cache 缓存 (0ms 秒开)
                const cached = await cache.match(e.request);
                if (cached) {
                    // 真 LRU 关键逻辑：命中时重新写入 Cache 顺位，将其移至 Cache Keys 队列末尾 (最新使用)
                    cache.delete(e.request).then(() => cache.put(e.request, cached.clone())).catch(() => {});
                    return cached;
                }

                // 未命中缓存，发起网络请求并存入 Cache
                try {
                    const res = await fetch(e.request);
                    if (res.ok || res.type === 'opaque') {
                        await cache.put(e.request, res.clone());
                        const keys = await cache.keys();
                        if (keys.length > MAX_ENTRIES) {
                            // 删除最久未使用的项 (队列头部 keys[0])
                            await cache.delete(keys[0]);
                        }
                    }
                    return res;
                } catch {
                    return new Response('', { status: 404 });
                }
            })
        );
    }
});
