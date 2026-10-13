/**
 * 基础架构、Service Worker 离线缓存与 Web 安全防护测试套件 (infra-security.test.mjs)
 *
 * 精炼架构：5 大高密度全景断言
 * 1. dist/ 产物完整性与 Cache-Control 标头规则
 * 2. Service Worker 核心预缓存清单与容错安装
 * 3. Service Worker 内存池 FIFO 自动限额淘汰与防污染
 * 4. Service Worker 图标预缓存安全白名单校验
 * 5. 防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTester } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const { pass, finish } = makeTester();

// ══════════════════════════════════════════════════════════════════════
// 1. dist/ 产物完整性与 Cache-Control 标头规则
// ══════════════════════════════════════════════════════════════════════

if (!existsSync(DIST)) {
  console.error('❌ dist/ 目录不存在 —— 请先执行 npm run build');
  process.exit(1);
}

// 1.1 文件完整性
const requiredFiles = ['index.html', 'sw.js', 'app.js', '_headers', 'robots.txt', 'wallpapers/bg1.avif'];
const missingFiles = requiredFiles.filter(f => !existsSync(join(DIST, f)));
const filesExistOk = missingFiles.length === 0;

// 1.2 响应头解析
function parseHeadersFile(content) {
  const rules = {};
  let currentPath = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('/')) {
      currentPath = trimmed;
      if (!rules[currentPath]) rules[currentPath] = {};
    } else if (currentPath && trimmed.includes(':')) {
      const idx = trimmed.indexOf(':');
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      rules[currentPath][key] = val;
    }
  }
  return rules;
}

const headersPath = join(DIST, '_headers');
let headersOk = false;
if (existsSync(headersPath)) {
  const headersContent = readFileSync(headersPath, 'utf-8');
  const rules = parseHeadersFile(headersContent);
  const indexCc = rules['/index.html']?.['cache-control'] || '';
  const rootCc = rules['/']?.['cache-control'] || '';
  const swCc = rules['/sw.js']?.['cache-control'] || '';
  const appCc = rules['/app.js']?.['cache-control'] || '';
  const manifestCc = rules['/manifest.json']?.['cache-control'] || '';
  const iconCc = rules['/apple-touch-icon.png']?.['cache-control'] || '';
  const wpCc = rules['/wallpapers/*']?.['cache-control'] || '';
  const validNoCache = indexCc.includes('max-age=0') && rootCc.includes('max-age=0') && swCc.includes('max-age=0') && appCc.includes('max-age=0') && manifestCc.includes('max-age=0') && !appCc.includes('immutable');
  const validWp = ['wallpapers', 'icons'].every(dir => { const cc = rules['/' + dir + '/*']?.['cache-control'] || ''; return cc.includes('max-age=0') && cc.includes('must-revalidate') && !cc.includes('immutable'); });
  const validIcon = iconCc.includes('max-age=604800');
  const srcHeadersContent = readFileSync(join(ROOT, 'public', '_headers'), 'utf-8');
  const syncOk = srcHeadersContent.trim() === headersContent.trim();
  headersOk = validNoCache && validWp && validIcon && syncOk;
}

// 1.3 构建脚本 PATHS 常量映射与 Watcher 监听目标有效性校验
const buildScriptContent = readFileSync(join(ROOT, 'scripts', 'build.js'), 'utf-8');
const buildPathsHasSrcIndexHtml = /srcIndexHtml\s*:\s*path\.join/.test(buildScriptContent);
const buildWatchHasCorrectKey = /path\s*:\s*PATHS\.srcIndexHtml\s*,\s*name\s*:\s*['"]index\.html['"]/.test(buildScriptContent);
const buildWatchHasNoUndefinedProp = !/PATHS\.indexHtml\b/.test(buildScriptContent);
const buildWatcherPathsOk = buildPathsHasSrcIndexHtml && buildWatchHasCorrectKey && buildWatchHasNoUndefinedProp;

pass('dist/ 产物完整性与 Cache-Control 标头规则 (产物齐全/全链路协商缓存/壁纸强缓存/同步/构建Watcher路径合规)',
  filesExistOk && headersOk && buildWatcherPathsOk,
  filesExistOk && headersOk && buildWatcherPathsOk ? '产物与响应头100%合规且Watcher监听路径合法' : `缺失: ${missingFiles.join(', ')}, watcherOk: ${buildWatcherPathsOk}`);

// ══════════════════════════════════════════════════════════════════════
// 2. Service Worker 核心预缓存清单与容错安装
// ══════════════════════════════════════════════════════════════════════

function extractCoreAssets(swContent) {
  const m = swContent.match(/const\s+CORE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
const distAssets = extractCoreAssets(distSw) || [];

const missingAssets = [];
for (const asset of distAssets) {
  const resolved = asset === './' ? DIST : join(DIST, asset.replace(/^\.\//, ''));
  if (!existsSync(resolved) || (asset !== './' && !statSync(resolved).isFile())) {
    missingAssets.push(asset);
  }
}
const validAssets = missingAssets.length === 0 && !distAssets.includes('./icon.svg') && !distAssets.includes('./manifest.json') && distAssets.includes('./index.html');
const validInstall = distSw.includes('cache.add(') && distSw.includes('validateCoreCache(cache)') && distSw.includes('Promise.allSettled(CORE_ASSETS') && !distSw.includes('self.skipWaiting()') && !distSw.includes('clients.claim()');
const validStrategy = distSw.includes('isCoreStaticAsset') && distSw.includes('fetch(e.request).then(') && distSw.includes('if (cached) return cached;');
const distIndexContent = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf-8') : '';
const validScriptVersion = /<head[^>]*>[\s\S]*?<script\s+src=["']\.\/app\.js\?v=app-core-v\d+["']\s+defer><\/script>/.test(distIndexContent);
const noBodyMainScript = !distIndexContent.includes('id="main-script"');
const distAppContent = existsSync(join(DIST, 'app.js')) ? readFileSync(join(DIST, 'app.js'), 'utf-8') : '';
const validFingerprints = distIndexContent.includes('__GLASS_BUILD_HTML__') && distAppContent.includes('__GLASS_BUILD_APP__');
const validNonOkFallback = /return caches\.match\(e\.request\)\.then\(cached => cached \|\| netRes\)/.test(distSw);

pass('Service Worker 核心预缓存清单与容错安装 (CORE_ASSETS真实存在/核心reload完整校验/失败拒绝安装/等待旧页面退出/原子化SWR锁步版本对齐/指纹契约/非ok回退/Head原生Defer)',
  validAssets && validInstall && validStrategy && validScriptVersion && noBodyMainScript && validFingerprints && validNonOkFallback,
  `包含 ${distAssets.length} 项有效资源，原子化 SWR 锁步策略、双端构建指纹、Head 原生 Defer 与非 ok 缓存回退 100% 对齐`);

// ══════════════════════════════════════════════════════════════════════
// 3. Service Worker 内存池 FIFO 自动限额淘汰与防污染
// ══════════════════════════════════════════════════════════════════════

// 3.1 真实运行 SW 内置 pruneCache 算法：验证先进先出 (FIFO) 淘汰顺序与限额准确性
let pruneAlgorithmOk = false;
try {
  // 提取 sw.js 中的 pruneCache 源码并在隔离上下文中执行真实淘汰断言
  const pruneCodeMatch = srcSw.match(/async\s+function\s+pruneCache\s*\([\s\S]*?\n\}/);
  if (pruneCodeMatch) {
    const fn = new Function(`${pruneCodeMatch[0]}; return pruneCache;`)();
    
    // 场景 A: 模拟 10 条缓存超出 5 条上限，必须严格按 FIFO 删除最旧的前 5 条 (0..4)，保留最新的后 5 条 (5..9)
    const mockEntriesA = Array.from({ length: 10 }, (_, i) => `https://a.favicon.im/site-${i}.png`);
    const deletedKeysA = [];
    const mockCacheA = {
      keys: async () => [...mockEntriesA],
      delete: async (k) => {
        deletedKeysA.push(k);
        const idx = mockEntriesA.indexOf(k);
        if (idx !== -1) mockEntriesA.splice(idx, 1);
        return true;
      }
    };
    await fn(mockCacheA, 5);
    const fifoPruned5Oldest = deletedKeysA.length === 5 && deletedKeysA.every((k, i) => k === `https://a.favicon.im/site-${i}.png`);
    const remaining5Newest = mockEntriesA.length === 5 && mockEntriesA[0] === 'https://a.favicon.im/site-5.png';

    // 场景 B: 模拟 3 条缓存未达 5 条上限，不触发任何删除
    const mockEntriesB = ['https://a.favicon.im/a.png', 'https://a.favicon.im/b.png', 'https://a.favicon.im/c.png'];
    const deletedKeysB = [];
    const mockCacheB = {
      keys: async () => [...mockEntriesB],
      delete: async (k) => { deletedKeysB.push(k); return true; }
    };
    await fn(mockCacheB, 5);
    const noOverheadWhenUnderLimit = deletedKeysB.length === 0 && mockEntriesB.length === 3;

    pruneAlgorithmOk = fifoPruned5Oldest && remaining5Newest && noOverheadWhenUnderLimit;
  }
} catch (e) {
  pruneAlgorithmOk = false;
}

// 3.2 校验三池配额常数与 activate 激活清理保护白名单
const maxFaviconMatch = srcSw.match(/MAX_FAVICON_ENTRIES\s*=\s*(\d+)/);
const maxImgMatch = srcSw.match(/MAX_IMG_ENTRIES\s*=\s*(\d+)/);
const faviconLimitOk = maxFaviconMatch && Number(maxFaviconMatch[1]) === 800;
const imgLimitOk = maxImgMatch && Number(maxImgMatch[1]) === 200;
const poolNamesOk = srcSw.includes("const FAVICON_CACHE = 'app-favicons-v1'") && srcSw.includes("const IMG_CACHE = 'app-images-' + CORE_CACHE;");
const cleanupMatch = srcSw.match(/Promise\.all\(keys\.filter\(([\s\S]*?)\)\.map/);
const cleanupPredicate = cleanupMatch ? new Function('CORE_CACHE', 'IMG_CACHE', 'previousImages', `return (${cleanupMatch[1]})`)('app-core-current', 'app-images-current', 'app-images-previous') : null;
const cleanupInputs = ['app-core-old', 'app-core-current', 'app-favicons-v1', 'app-images-current', 'app-images-previous', 'app-images-old', 'unrelated-cache'];
const activateCleansOldCachesOnly = cleanupPredicate && JSON.stringify(cleanupInputs.filter(cleanupPredicate)) === '["app-core-old","app-images-old"]';

pass('Service Worker 内存池 FIFO 自动限额淘汰与防污染 (真实FIFO执行断言/800与200配额/三池激活保护白名单)',
  pruneAlgorithmOk && faviconLimitOk && imgLimitOk && poolNamesOk && activateCleansOldCachesOnly,
  `FIFO算法执行验证通过，图标上限=800，图片上限=200，三池物理隔离保护`);

// ══════════════════════════════════════════════════════════════════════
// 4. Service Worker 图标预缓存安全白名单校验
// ══════════════════════════════════════════════════════════════════════

function extractCoreFavicons(swContent) {
  const m = swContent.match(/const\s+CORE_FAVICONS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}
const favicons = extractCoreFavicons(srcSw);
const cleanFavicons = favicons.length === 3 && favicons.some(f => f.includes('bing.com')) && favicons.some(f => f.includes('google.com')) && favicons.some(f => f.includes('wikipedia.org')) && !favicons.some(f => f.includes('baidu.com'));

pass('Service Worker 图标预缓存安全白名单校验 (仅Bing&Google&Wikipedia/杜绝百度与未知源)',
  cleanFavicons, `favicons=${JSON.stringify(favicons)}`);

// ══════════════════════════════════════════════════════════════════════
// 5. 防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局
// ══════════════════════════════════════════════════════════════════════

const srcHtmlFile = join(ROOT, 'src', 'index.html');
const indexHtml = readFileSync(srcHtmlFile, 'utf-8');
const distHtml = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf-8') : '';

// 校验源文件与构建产物头部是否均包含顶层防嵌破局与白屏防御逻辑
const frameBustingPattern = /if\s*\(\s*window\.top\s*!==\s*window\.self\s*\)\s*\{?\s*try\s*\{\s*window\.top\.location\.replace\(window\.location\.href\);?\s*\}\s*catch\s*\{\s*document\.documentElement\.style\.display\s*=\s*['"]none['"];?\s*\}?\s*\}?/;

const srcHasFrameBusting = frameBustingPattern.test(indexHtml);
const distHasFrameBusting = frameBustingPattern.test(distHtml);

// 5.2 真实运行 Frame-Busting 双分支防御逻辑
// 场景 A: 允许替换时调用 top.location.replace 破局跳转
let replaceCalledWith = null;
const mockTopSuccess = { location: { replace: (url) => { replaceCalledWith = url; } } };
const mockDocA = { documentElement: { style: { display: '' } } };
const fnA = new Function('window', 'document', `
  if (window.top !== window.self) {
    try {
      window.top.location.replace(window.location.href);
    } catch {
      document.documentElement.style.display = 'none';
    }
  }
`);
fnA({ top: mockTopSuccess, self: {}, location: { href: 'https://start.test/' } }, mockDocA);
const frameBustingEscapeOk = replaceCalledWith === 'https://start.test/' && mockDocA.documentElement.style.display === '';

// 场景 B: 跨域 iframe 被 sandbox 拦截抛出 DOMException -> 降级为隐藏全站 DOM 杜绝点击劫持 (Clickjacking)
const mockTopBlocked = {
  get location() { throw new Error('Blocked a frame with origin from accessing a cross-origin frame.'); }
};
const mockDocB = { documentElement: { style: { display: '' } } };
fnA({ top: mockTopBlocked, self: {}, location: { href: 'https://start.test/' } }, mockDocB);
const frameBustingBlankOk = mockDocB.documentElement.style.display === 'none';

const frameBustingOk = srcHasFrameBusting && distHasFrameBusting && frameBustingEscapeOk && frameBustingBlankOk;

pass('防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局 (源码与产物双重注入/真实破局跳转与防嵌入白屏双分支执行断言)',
  frameBustingOk, '源码与构建产物均包含不可绕过的防御闭环且双分支执行验证通过');

process.exit(finish());
