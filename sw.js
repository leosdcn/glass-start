/**
 * ==============================================================================
 * Service Worker: 快捷书签与导航图标专用 LRU 高性能本地缓存器 (v4)
 * ==============================================================================
 * 核心目的：
 * 1. 拦截并缓存第三方 Favicon 图标请求（如 favicon.im），提升图标加载速度与防重复请求。
 * 2. 采用 LRU (Least Recently Used) 机制控制缓存容量上限（最多 120 条），防止磁盘配额无限制膨胀。
 * 3. 精确匹配图标请求域名，严禁拦截普通 API / 搜索联想 / 资源文件请求。
 */

// 缓存版本号（升级版本号自动清理旧缓存）
const CACHE = 'favicon-cache-v4';
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

// 拦截请求阶段：仅精准拦截 favicon.im 及 .ico 静态图标 GET 请求
self.addEventListener('fetch', e => {
    // 仅拦截 HTTP GET 请求，非 GET 请求直接放行
    if (e.request.method !== 'GET') return;

    const url = e.request.url.toLowerCase();
    // 精确判定：仅针对已知 Favicon 服务域名与 .ico 结尾的图标文件
    const isFaviconRequest = url.includes('favicon.im') || url.includes('/favicon.ico') || url.endsWith('.ico');
    if (!isFaviconRequest) return;

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

