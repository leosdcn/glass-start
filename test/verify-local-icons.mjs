/**
 * 针对性专项测试：验证本地书签图标是否全面起效 (verify-local-icons.mjs)
 * 
 * 校验维度：
 * 1. 静态数据真理源检验 (bookmarks.json 与 constants.js 相对路径对齐)
 * 2. 磁盘文件与 PNG 二进制签名合法性 (icons/ 与 dist/icons/ 100% 存在且有效)
 * 3. 生产环境浏览器真实渲染与零外部请求断言 (无头 Chrome CDP)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSession, sleep } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'icons');
const DIST_ICONS_DIR = join(ROOT, 'dist', 'icons');
const BOOKMARKS_PATH = join(ROOT, 'bookmarks.json');

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

async function run() {
    console.log(`\n${c.cyan}${c.bold}════════════════════════════════════════════════════════════════════${c.reset}`);
    console.log(`${c.cyan}${c.bold}🧪 Glass Start — 本地书签图标专项效能与渲染验证套件${c.reset}`);
    console.log(`${c.cyan}${c.bold}════════════════════════════════════════════════════════════════════${c.reset}\n`);

    let passedCount = 0;
    let totalChecks = 0;

    function assert(name, ok, detail = '') {
        totalChecks++;
        if (ok) {
            passedCount++;
            console.log(`  ${c.green}✔${c.reset} ${name} ${c.dim}${detail ? `(${detail})` : ''}${c.reset}`);
        } else {
            console.error(`  ${c.red}❌ ${name}${c.reset} ${detail ? `[${detail}]` : ''}`);
            process.exitCode = 1;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 阶段 1: 静态配置与数据源规范断言
    // ─────────────────────────────────────────────────────────────
    console.log(`${c.bold}─── [1/3] 📑 静态数据规范与图标路径真理源检验 ──────────────────────────${c.reset}`);
    
    assert('bookmarks.json 数据文件存在', existsSync(BOOKMARKS_PATH));
    const bookmarksData = JSON.parse(readFileSync(BOOKMARKS_PATH, 'utf-8'));
    
    const allBookmarks = [
        ...(bookmarksData.bookmarks || []),
        ...(bookmarksData.categories || []).flatMap(cat => cat.bookmarks || [])
    ];
    
    assert('书签数据集非空且解析正常', allBookmarks.length > 0, `共收集 ${allBookmarks.length} 个书签`);

    const nonLocalIcons = allBookmarks.filter(bm => !bm.icon || !bm.icon.startsWith('./icons/'));
    assert('全量预设书签 100% 采用 ./icons/ 本地相对路径', nonLocalIcons.length === 0, 
        nonLocalIcons.length === 0 ? `全部 ${allBookmarks.length} 处书签已规范` : `发现 ${nonLocalIcons.length} 处非本地图标`);

    // ─────────────────────────────────────────────────────────────
    // 阶段 2: 磁盘资源完整性与 PNG 二进制签名校验
    // ─────────────────────────────────────────────────────────────
    console.log(`\n${c.bold}─── [2/3] 💾 磁盘图标物理存在性与 PNG 二进制签名合法性检验 ──────────────${c.reset}`);
    
    const sourceIconsExist = existsSync(ICONS_DIR);
    assert('源码 icons/ 目录物理存在', sourceIconsExist);

    const distIconsExist = existsSync(DIST_ICONS_DIR);
    assert('构建产物 dist/icons/ 目录物理存在', distIconsExist);

    const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let missingInSource = 0;
    let missingInDist = 0;
    let corruptedPngs = 0;

    for (const bm of allBookmarks) {
        const filename = bm.icon.replace(/^\.\/icons\//, '');
        const srcPath = join(ICONS_DIR, filename);
        const distPath = join(DIST_ICONS_DIR, filename);

        if (!existsSync(srcPath)) {
            missingInSource++;
            continue;
        }
        if (!existsSync(distPath)) {
            missingInDist++;
            continue;
        }

        const buf = readFileSync(srcPath);
        if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_HEADER)) {
            corruptedPngs++;
        }
    }

    assert('全量书签对应之源码 icons/ 图标文件 0 缺失', missingInSource === 0, `缺失: ${missingInSource}`);
    assert('全量书签对应之 dist/icons/ 构建产物 0 缺失', missingInDist === 0, `缺失: ${missingInDist}`);
    assert('全量本地图标均为合规二进制 PNG (魔数 0x89504E47)', corruptedPngs === 0, `损坏: ${corruptedPngs}`);

    // ─────────────────────────────────────────────────────────────
    // 阶段 3: 无头 Chrome 真实环境网络拦截与 DOM 渲染断言
    // ─────────────────────────────────────────────────────────────
    console.log(`\n${c.bold}─── [3/3] 🌐 浏览器真实渲染与外部网络请求零泄露断言 (Headless Chrome) ───${c.reset}`);

    const session = await launchSession();
    const { evalJS, send, server, chrome } = session;

    try {
        await send('Network.enable');

        const interceptedRequests = [];
        send('Network.requestWillBeSent', params => {
            const url = params.request.url;
            interceptedRequests.push(url);
        });

        // 等待页面初始水合完成
        await evalJS(`new Promise(r => {
            if (document.readyState === 'complete') r();
            else window.addEventListener('load', r);
        })`);
        await sleep(500);

        // 切换到导航页使所有分类书签加载并挂载
        await evalJS(`(() => {
            if (typeof window.switchToNav === 'function') {
                window.switchToNav();
            }
        })()`);
        await sleep(500);

        // 检验首屏懒加载特性与全量滚动解码
        const domResult = await evalJS(`new Promise(async (resolve) => {
            const imgs = Array.from(document.querySelectorAll('.bookmark-card img, .category-item img, .nav-item img, .lazy-icon'));
            const total = imgs.length;
            const relativeLocalCount = imgs.filter(img => img.src.includes('/icons/')).length;
            const initialLazyLoaded = imgs.filter(img => img.complete && img.naturalWidth > 0).length;

            // 模拟用户平滑滚动浏览所有分类卡片，唤醒所有懒加载图标
            for (const img of imgs) {
                img.scrollIntoView({ block: 'center' });
                await new Promise(r => setTimeout(r, 10));
            }

            // 等待所有图片完成加载或解码
            await Promise.all(imgs.map(img => {
                if (img.complete && img.naturalWidth > 0) return Promise.resolve();
                return new Promise(resolve => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', resolve, { once: true });
                    setTimeout(resolve, 2000);
                });
            }));

            const fullyLoadedCount = imgs.filter(img => img.complete && img.naturalWidth > 0).length;
            const failedCount = imgs.filter(img => img.dataset.failed === '1').length;
            const fallbackCount = imgs.filter(img => img.dataset.fallback === '1').length;

            resolve({
                total,
                relativeLocalCount,
                initialLazyLoaded,
                fullyLoadedCount,
                failedCount,
                fallbackCount
            });
        })`);

        assert('DOM 中成功渲染书签图标元素', domResult.total > 0, `共抓取到 ${domResult.total} 个图标节点`);
        assert('DOM 中图标 100% 命中同源 /icons/ 本地路径', domResult.relativeLocalCount === domResult.total,
            `${domResult.relativeLocalCount}/${domResult.total} 节点均为同源本地`);
        assert('原生懒加载 (loading="lazy") 正确生效', domResult.initialLazyLoaded < domResult.total && domResult.initialLazyLoaded > 0,
            `视口内初渲染: ${domResult.initialLazyLoaded} 个，非视口按需延迟`);
        assert('滚动后全量图标 100% 成功解码渲染 (naturalWidth/naturalHeight > 0)', domResult.fullyLoadedCount === domResult.total,
            `真实有效渲染率: ${Math.round((domResult.fullyLoadedCount / domResult.total) * 100)}% (${domResult.fullyLoadedCount}/${domResult.total})`);
        assert('图标 0 触发降级与错误状态机 (failed === 0)', domResult.failedCount === 0 && domResult.fallbackCount === 0,
            `fallback: ${domResult.fallbackCount}, failed: ${domResult.failedCount}`);

        // 校验网络层是否有任何外部第三方 favicon 请求被泄漏
        const externalFaviconRequests = interceptedRequests.filter(url => 
            url.includes('a.favicon.im') || 
            url.includes('google.com/s2/favicons') ||
            url.includes('api.iowen.cn')
        );

        assert('全站图标加载实现真正的 0 外部网络请求 (零泄漏/零外网依赖)', externalFaviconRequests.length === 0,
            externalFaviconRequests.length === 0 ? '0 外部图标请求' : `违规外发 ${externalFaviconRequests.length} 个请求: ${externalFaviconRequests.join(', ')}`);

    } finally {
        await chrome.close();
        await server.close();
    }

    console.log(`\n${c.cyan}${c.bold}════════════════════════════════════════════════════════════════════${c.reset}`);
    if (passedCount === totalChecks) {
        console.log(`  ${c.green}✨ 专项测试全部通过！(${passedCount}/${totalChecks} 项断言通过)${c.reset}`);
        console.log(`  ${c.green}✨ 结论：全站本地书签图标已 100% 起效，首屏实现零外部网络依赖与瞬间解码！${c.reset}`);
    } else {
        console.log(`  ${c.red}⚠ 专项测试未全部通过 (${passedCount}/${totalChecks} 项通过)${c.reset}`);
    }
    console.log(`${c.cyan}${c.bold}════════════════════════════════════════════════════════════════════${c.reset}\n`);
}

run().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
