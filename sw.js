/**
 * ==============================================================================
 * Service Worker: 快捷书签与导航图标专用高性能本地缓存器 (v5)
 * ==============================================================================
 * 核心目的：
 * 1. 拦截并缓存第三方 Favicon 图标请求（如 favicon.im），提升图标加载速度与防重复请求。
 * 2. 采用容量控制机制（最多 120 条），防止磁盘配额无限制膨胀。
 * 3. 精确匹配图标请求域名与路径，严禁误拦截普通 API / 搜索联想 / 其它资源文件。
 */

// 缓存版本号（升级版本号自动清理旧缓存）
const CACHE = 'app-cache-v1785481162496';
// 缓存文件条目上限（严格控制在 120 条以内，占用极小磁盘配额）
const MAX_ENTRIES = 120;

// 安装阶段：直接跳过等待，强制激活最新 SW
self.addEventListener('install', () => self.skipWaiting());

// 激活阶段：清理旧版本 CACHE 存储，并接管当前客户端页面
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
));

// 拦截请求阶段：精准拦截 favicon.im、.ico 静态图标及 style.css 关键样式表 GET 请求
self.addEventListener('fetch', e => {
    // 仅拦截 HTTP GET 请求，非 GET 请求直接放行
    if (e.request.method !== 'GET') return;

    let urlObj;
    try {
        urlObj = new URL(e.request.url);
    } catch {
        return;
    }

    // 精确判定：仅针对 https://favicon.im/ 域名、.ico 静态图标路径及 style.css
    const isFaviconDomain = urlObj.origin === 'https://favicon.im';
    const pathnameLower = urlObj.pathname.toLowerCase();
    const isIcoPath = pathnameLower.endsWith('.ico') || pathnameLower === '/favicon.ico';
    const isStyleCss = pathnameLower.endsWith('/style.css') || pathnameLower === 'style.css';

    if (!isFaviconDomain && !isIcoPath && !isStyleCss) return;

    // 对 style.css 采取 Stale-While-Revalidate 策略：优先命中缓存秒开，后台异步 Fetch 最新 CSS 更新 Cache
    if (isStyleCss) {
        e.respondWith(
            caches.open(CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                const fetchPromise = fetch(e.request).then(netRes => {
                    if (netRes.ok) cache.put(e.request, netRes.clone());
                    return netRes;
                }).catch(() => null);
                return cached || fetchPromise;
            })
        );
        return;
    }

    e.respondWith(
        caches.open(CACHE).then(async cache => {
            // 1. 图标文件：优先命中本地 Cache 缓存
            const cached = await cache.match(e.request);
            if (cached) return cached;

            // 2. 未命中缓存，发起网络请求并存入 Cache
            try {
                const res = await fetch(e.request);
                if (res.ok || res.type === 'opaque') {
                    await cache.put(e.request, res.clone());
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


