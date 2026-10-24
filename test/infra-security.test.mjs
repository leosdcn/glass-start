/** 验证构建产物、响应头、离线缓存及防嵌套逻辑。 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
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

// HTML 语法合法不代表样式存在；禁止发布构建竞争产生的空样式页面。
const builtHtml = readFileSync(join(DIST, 'index.html'), 'utf-8');
const inlineCss = [...builtHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map(match => match[1]).join('\n');
pass('生产页面包含双屏布局与输入字号样式',
  inlineCss.includes('#startSection') && inlineCss.includes('#navSection') && inlineCss.includes('.text-base'),
  `内嵌 CSS: ${Buffer.byteLength(inlineCss)} bytes`);

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
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { startWatch, PATHS } = require('../scripts/build.js');
const subscriptions = [];
const originalWatch = fs.watch;
try {
  fs.watch = (path, options) => {
    subscriptions.push({ path, recursive: options.recursive });
    return { close() {} };
  };
  startWatch(undefined, { label: 'Test' })();
} finally {
  fs.watch = originalWatch;
}
const expectedWatchPaths = [PATHS.src, PATHS.public, PATHS.bookmarksJson, PATHS.pkgJson, PATHS.sw];
const buildWatcherPathsOk = buildPathsHasSrcIndexHtml && subscriptions.length === expectedWatchPaths.length
  && expectedWatchPaths.every(path => subscriptions.filter(item => item.path === path).length === 1)
  && subscriptions.every(item => item.recursive === statSync(item.path).isDirectory());

pass('dist/ 产物完整性与 Cache-Control 标头规则 (产物齐全/全链路协商缓存/壁纸强缓存/同步/构建Watcher路径合规)',
  filesExistOk && headersOk && buildWatcherPathsOk,
  filesExistOk && headersOk && buildWatcherPathsOk ? '产物与响应头100%合规且Watcher监听路径合法' : `缺失: ${missingFiles.join(', ')}, watcherOk: ${buildWatcherPathsOk}`);

// ══════════════════════════════════════════════════════════════════════
// 2. Service Worker 核心预缓存清单与容错安装
// ══════════════════════════════════════════════════════════════════════

const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
function inspectWorker(source) {
  return vm.runInNewContext(source + '\n;({CORE_ASSETS, MAX_FAVICON_ENTRIES, MAX_IMG_ENTRIES, pruneCache})', {
    self: { registration:{scope:'https://example.test/'}, addEventListener() {} }, URL
  });
}
const worker = inspectWorker(srcSw);
const distAssets = Array.from(inspectWorker(distSw).CORE_ASSETS);

const missingAssets = [];
for (const asset of distAssets) {
  const resolved = asset === './' ? DIST : join(DIST, asset.replace(/^\.\//, ''));
  if (!existsSync(resolved) || (asset !== './' && !statSync(resolved).isFile())) {
    missingAssets.push(asset);
  }
}
const validAssets = missingAssets.length === 0 && !distAssets.includes('./icon.svg') && !distAssets.includes('./manifest.json') && distAssets.includes('./index.html');
const distIndexContent = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf-8') : '';
const validScriptVersion = /<head[^>]*>[\s\S]*?<script\s+src=["']\.\/app\.js\?v=app-core-v\d+["']\s+defer><\/script>/.test(distIndexContent);
const noBodyMainScript = !distIndexContent.includes('id="main-script"');
const distAppContent = existsSync(join(DIST, 'app.js')) ? readFileSync(join(DIST, 'app.js'), 'utf-8') : '';
const validFingerprints = distIndexContent.includes('__GLASS_BUILD_HTML__') && distAppContent.includes('__GLASS_BUILD_APP__');


pass('核心预缓存资源与产物版本契约（安装、更新及离线行为另由 infra-sw-upgrade 验证）',
  validAssets && validScriptVersion && noBodyMainScript && validFingerprints,
  `核心资源存在，HTML 与脚本均包含构建指纹`);

// ══════════════════════════════════════════════════════════════════════
// 3. Service Worker 缓存池的 FIFO 限额淘汰
// ══════════════════════════════════════════════════════════════════════

// 3.1 真实运行 SW 内置 pruneCache 算法：验证先进先出 (FIFO) 淘汰顺序与限额准确性
let pruneAlgorithmOk = false;
try {
  {
    const fn = worker.pruneCache;
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

pass('缓存 FIFO 淘汰保留新项，未超限时不删除', pruneAlgorithmOk);
pass('图标与图片缓存配额为正整数',
  [worker.MAX_FAVICON_ENTRIES, worker.MAX_IMG_ENTRIES].every(value => Number.isInteger(value) && value > 0));

// 直接执行 fetch 路由，验证核心脚本网络失败时返回旧缓存。
let respond;
const handlers = new Map();
vm.runInNewContext(srcSw, {
  self: { location:{origin:'https://example.test',href:'https://example.test/sw.js'},
    registration:{scope:'https://example.test/'}, addEventListener:(name, fn)=>handlers.set(name, fn) },
  URL, Request, Response,
  fetch: async () => new Response('unavailable', {status:503}),
  caches: {open:async()=>({match:async()=>undefined}), match:async()=>new Response('cached-script')}
});
handlers.get('fetch')({request:new Request('https://example.test/uncached.js'),
  respondWith: promise => { respond = promise; }, waitUntil() {}});
pass('核心脚本网络失败不跨构建回填', (await respond).status === 503);

// ══════════════════════════════════════════════════════════════════════
// 4. 安装过程只请求同源核心资源，不预取外部引擎图标。
// ══════════════════════════════════════════════════════════════════════
const installHandlers = new Map(), installTasks = [], installUrls = [];
const version = srcSw.match(/const CORE_CACHE = '([^']+)'/)[1];
class InstallRequest extends Request {
  constructor(url, options) { super(new URL(url, 'https://example.test/'), options); }
}
vm.runInNewContext(srcSw, {
  self: { registration:{scope:'https://example.test/'}, addEventListener: (name, handler) => installHandlers.set(name, handler) },
  URL,
  Request: InstallRequest, Response, AbortSignal,
  fetch: async url => { installUrls.push(String(url)); return new Response('external'); },
  caches: {
    open: async () => ({
      add: async request => { installUrls.push(request.url); },
      put: async () => {},
      match: async asset => new Response(String(asset).includes('app.js')
        ? `window.__GLASS_BUILD_APP__="${version}"`
        : `window.__GLASS_BUILD_HTML__="${version}"`)
    }),
    delete: async () => true
  }
});
installHandlers.get('install')({ waitUntil: task => installTasks.push(task) });
await Promise.all(installTasks);
pass('安装仅预取同源核心资源，无外部引擎图标请求',
  installUrls.length === worker.CORE_ASSETS.length &&
  installUrls.every(url => new URL(url).origin === 'https://example.test'));

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
