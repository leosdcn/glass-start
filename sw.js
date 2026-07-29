/**
 * ==============================================================================
 * Service Worker: 快捷书签与导航图标专用 LRU 高性能本地缓存器
 * ==============================================================================
 * 核心目的：
 * 1. 拦截并缓存第三方 Favicon 图标请求（如 favicon.im / 域名图标），提升图标加载速度与防重复请求。
 * 2. 采用 LRU (Least Recently Used) 机制控制缓存容量上限（最多 500 条），防止本地 CacheStorage 无限制膨胀。
 * 3. 兼容跨域图标请求的 opaque (不透明) 响应类型。
 */

// 缓存版本号（升级版本号可自动触发旧缓存清理）
const CACHE = 'favicon-cache-v3';
// 缓存文件条目上限（超过后自动剔除最早加入的旧图标）
const MAX_ENTRIES = 500;

// 安装阶段：直接跳过等待，强制激活最新 SW
self.addEventListener('install', () => self.skipWaiting());

// 激活阶段：清理旧版本 CACHE 存储，并接管当前客户端页面
self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
));

// 拦截请求阶段：专门过滤并缓存各种格式的网站图标请求
self.addEventListener('fetch', e => {
    const url = e.request.url.toLowerCase();
    // 非图标相关 HTTP 请求直接放行，交由浏览器正常网络处理
    if (!url.includes('favicon') && !url.includes('.ico') && !url.includes('icon')) return;

    e.respondWith(
        caches.open(CACHE).then(async cache => {
            // 1. 优先命中本地 Cache 缓存
            const cached = await cache.match(e.request);
            if (cached) return cached;

            // 2. 未命中缓存，发起网络请求并存入 Cache
            try {
                const res = await fetch(e.request, { mode: 'no-cors' });
                // 接受正常响应 (ok) 或跨域不透明响应 (opaque)
                if (res.ok || res.type === 'opaque') {
                    cache.put(e.request, res.clone());
                    // 3. LRU 动态容量管控：超过 MAX_ENTRIES 时清理最早的一条记录
                    const keys = await cache.keys();
                    if (keys.length > MAX_ENTRIES) await cache.delete(keys[0]);
                }
                return res;
            } catch {
                // 网络异常兜底：返回 404 空响应
                return new Response('', { status: 404 });
            }
        })
    );
});
