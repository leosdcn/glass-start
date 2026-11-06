/** 验证构建产物、响应头、离线缓存及防嵌套逻辑。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

test('dist/ 产物完整性与 Cache-Control 标头规则', () => {
  if (!existsSync(DIST)) {
    throw new Error('dist/ 目录不存在 —— 请先执行 npm run build');
  }

  // 1.1 文件完整性
  const requiredFiles = ['index.html', 'sw.js', 'app.js', '_headers', 'robots.txt', 'wallpapers/bg1.avif', 'LICENSE.txt', 'SOURCE.txt'];
  const missingFiles = requiredFiles.filter(f => !existsSync(join(DIST, f)));
  assert.equal(missingFiles.length, 0, `缺少文件: ${missingFiles.join(', ')}`);

  assert.ok(existsSync(join(DIST, 'LICENSE.txt')) && existsSync(join(DIST, 'SOURCE.txt')));
  assert.equal(readFileSync(join(DIST, 'LICENSE.txt'), 'utf-8'), readFileSync(join(ROOT, 'LICENSE'), 'utf-8'));
  assert.ok(readFileSync(join(DIST, 'SOURCE.txt'), 'utf-8').includes('https://github.com/leosdcn/glass-start'));

  // 生产页面包含双屏布局与输入字号样式
  const builtHtml = readFileSync(join(DIST, 'index.html'), 'utf-8');
  const inlineCss = [...builtHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1]).join('\n');
  assert.ok(inlineCss.includes('#startSection') && inlineCss.includes('#navSection') && inlineCss.includes('.text-base'),
    `内嵌 CSS 必须包含布局与字号声明 (${Buffer.byteLength(inlineCss)} bytes)`);

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
  assert.ok(existsSync(headersPath), '缺少 dist/_headers');
  const headersContent = readFileSync(headersPath, 'utf-8');
  const rules = parseHeadersFile(headersContent);
  const indexCc = rules['/index.html']?.['cache-control'] || '';
  const rootCc = rules['/']?.['cache-control'] || '';
  const swCc = rules['/sw.js']?.['cache-control'] || '';
  const appCc = rules['/app.js']?.['cache-control'] || '';
  const manifestCc = rules['/manifest.json']?.['cache-control'] || '';
  const iconCc = rules['/apple-touch-icon.png']?.['cache-control'] || '';
  const validNoCache = indexCc.includes('max-age=0') && rootCc.includes('max-age=0') && swCc.includes('max-age=0') && appCc.includes('max-age=0') && manifestCc.includes('max-age=0') && !appCc.includes('immutable');
  const validWp = ['wallpapers', 'icons'].every(dir => { const cc = rules['/' + dir + '/*']?.['cache-control'] || ''; return cc.includes('max-age=0') && cc.includes('must-revalidate') && !cc.includes('immutable'); });
  const validIcon = iconCc.includes('max-age=604800');
  const srcHeadersContent = readFileSync(join(ROOT, 'public', '_headers'), 'utf-8');
  const syncOk = srcHeadersContent.trim() === headersContent.trim();
  assert.ok(validNoCache && validWp && validIcon && syncOk, 'Cache-Control 头配置合规');

  // 1.3 构建脚本 PATHS 常量映射与 Watcher 监听目标有效性校验
  const buildScriptContent = readFileSync(join(ROOT, 'scripts', 'build.cjs'), 'utf-8');
  const buildPathsHasSrcIndexHtml = /srcIndexHtml\s*:\s*path\.join/.test(buildScriptContent);
  const require = createRequire(import.meta.url);
  const fs = require('node:fs');
  const { startWatch, PATHS } = require('../scripts/build.cjs');
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
  const expectedWatchPaths = [PATHS.src, PATHS.public, PATHS.bookmarksJson, PATHS.pkgJson, PATHS.license, PATHS.sw];
  assert.ok(buildPathsHasSrcIndexHtml);
  assert.equal(subscriptions.length, expectedWatchPaths.length);
  assert.ok(expectedWatchPaths.every(path => subscriptions.filter(item => item.path === path).length === 1));
  assert.ok(subscriptions.every(item => item.recursive === statSync(item.path).isDirectory()));
});

test('Service Worker 核心预缓存资源与产物版本契约', () => {
  const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
  const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
  function inspectWorker(source) {
    return vm.runInNewContext(source + '\n;({CORE_ASSETS, MAX_FAVICON_ENTRIES, MAX_IMG_ENTRIES, pruneCache})', {
      self: { registration: { scope: 'https://example.test/' }, addEventListener() {} }, URL
    });
  }
  const distAssets = Array.from(inspectWorker(distSw).CORE_ASSETS);
  const missingAssets = [];
  for (const asset of distAssets) {
    const resolved = asset === './' ? DIST : join(DIST, asset.replace(/^\.\//, ''));
    if (!existsSync(resolved) || (asset !== './' && !statSync(resolved).isFile())) {
      missingAssets.push(asset);
    }
  }
  assert.equal(missingAssets.length, 0, `预缓存缺失: ${missingAssets.join(', ')}`);
  assert.ok(!distAssets.includes('./icon.svg') && !distAssets.includes('./manifest.json') && distAssets.includes('./index.html'));

  const distIndexContent = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf-8') : '';
  assert.ok(/<head[^>]*>[\s\S]*?<script\s+src=["']\.\/app\.js\?v=app-core-v\d+["']\s+defer><\/script>/.test(distIndexContent));
  assert.ok(!distIndexContent.includes('id="main-script"'));

  const distAppContent = existsSync(join(DIST, 'app.js')) ? readFileSync(join(DIST, 'app.js'), 'utf-8') : '';
  assert.ok(distIndexContent.includes('__GLASS_BUILD_HTML__') && distAppContent.includes('__GLASS_BUILD_APP__'));
});

test('Service Worker 缓存池 FIFO 限额淘汰与网络失败隔离', async () => {
  const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
  function inspectWorker(source) {
    return vm.runInNewContext(source + '\n;({CORE_ASSETS, MAX_FAVICON_ENTRIES, MAX_IMG_ENTRIES, pruneCache})', {
      self: { registration: { scope: 'https://example.test/' }, addEventListener() {} }, URL
    });
  }
  const worker = inspectWorker(srcSw);

  // FIFO pruneCache 算法验证
  const fn = worker.pruneCache;
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
  await fn(mockCacheA, 5, 'favicon-test');
  assert.equal(deletedKeysA.length, 5);
  assert.ok(deletedKeysA.every((k, i) => k === `https://a.favicon.im/site-${i}.png`));
  assert.equal(mockEntriesA.length, 5);
  assert.equal(mockEntriesA[0], 'https://a.favicon.im/site-5.png');

  // 未达上限不删除
  const mockEntriesB = ['https://a.favicon.im/a.png', 'https://a.favicon.im/b.png', 'https://a.favicon.im/c.png'];
  const deletedKeysB = [];
  const mockCacheB = {
    keys: async () => [...mockEntriesB],
    delete: async (k) => { deletedKeysB.push(k); return true; }
  };
  await fn(mockCacheB, 5, 'image-test');
  assert.equal(deletedKeysB.length, 0);
  assert.equal(mockEntriesB.length, 3);

  // 缓存配额
  assert.ok([worker.MAX_FAVICON_ENTRIES, worker.MAX_IMG_ENTRIES].every(value => Number.isInteger(value) && value > 0));

  // 核心脚本网络失败不跨构建回填
  let respond;
  const handlers = new Map();
  vm.runInNewContext(srcSw, {
    self: {
      location: { origin: 'https://example.test', href: 'https://example.test/sw.js' },
      registration: { scope: 'https://example.test/' },
      addEventListener: (name, cb) => handlers.set(name, cb)
    },
    URL, Request, Response,
    fetch: async () => new Response('unavailable', { status: 503 }),
    caches: { open: async () => ({ match: async () => undefined }), match: async () => new Response('cached-script') }
  });
  handlers.get('fetch')({
    request: new Request('https://example.test/uncached.js'),
    respondWith: promise => { respond = promise; },
    waitUntil() {}
  });
  assert.equal((await respond).status, 503);
});

test('Service Worker 安装过程只请求同源核心资源', async () => {
  const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
  function inspectWorker(source) {
    return vm.runInNewContext(source + '\n;({CORE_ASSETS, MAX_FAVICON_ENTRIES, MAX_IMG_ENTRIES, pruneCache})', {
      self: { registration: { scope: 'https://example.test/' }, addEventListener() {} }, URL
    });
  }
  const worker = inspectWorker(srcSw);
  const installHandlers = new Map(), installTasks = [], installUrls = [];
  const version = srcSw.match(/const CORE_CACHE = '([^']+)'/)[1];
  class InstallRequest extends Request {
    constructor(url, options) { super(new URL(url, 'https://example.test/'), options); }
  }
  vm.runInNewContext(srcSw, {
    self: { registration: { scope: 'https://example.test/' }, addEventListener: (name, handler) => installHandlers.set(name, handler) },
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
  assert.equal(installUrls.length, worker.CORE_ASSETS.length);
  assert.ok(installUrls.every(url => new URL(url).origin === 'https://example.test'));
});

test('防 iframe 恶意嵌套点击劫持 (Frame-Busting)', () => {
  for (const file of [join(ROOT, 'src', 'index.html'), join(DIST, 'index.html')]) {
    const html = readFileSync(file, 'utf-8');
    const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .find(match => match[1].includes('window.top'))?.[1];
    assert.ok(script, `${file} 缺少防嵌套脚本`);
    for (const blocked of [false, true]) {
      let replaced;
      const top = {
        get location() {
          if (blocked) throw new Error('cross-origin frame');
          return { replace: url => { replaced = url; } };
        }
      };
      const document = { documentElement: { style: {} } };
      vm.runInNewContext(script, { window: { top, self: {}, location: { href: 'https://start.test/' } }, document });
      assert.equal(replaced, blocked ? undefined : 'https://start.test/');
      assert.equal(document.documentElement.style.display, blocked ? 'none' : undefined);
    }
  }
});

test('天气首屏不将缓存图标地址拼入 HTML', () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .find(match => match[1].includes('glass_weather_cache'))?.[1];
  assert.ok(script);
  for (const icon of ['x" onerror="window.__injected=1" data-x=".svg', '__proto__']) {
    const elements = Object.fromEntries(['weatherIcon', 'weatherTemp', 'weatherCity', 'weatherBtn']
      .map(id => [id, { textContent: '', innerHTML: '', setAttribute() {} }]));
    vm.runInNewContext(script, {
      localStorage: { getItem: key => key === 'glass_weather_cache'
        ? JSON.stringify({ current: {temp:20, icon}, location: {name:'测试'} }) : null },
      document: { getElementById: id => elements[id] },
      window: { __GLASS_I18N__: { t: () => '', weatherDescription: () => '' } }
    });
    assert.equal(elements.weatherIcon.innerHTML, '', '异常缓存只能作为文字显示');
    assert.equal(elements.weatherIcon.textContent, icon);
  }
});
