/** 验证构建产物、响应头、离线缓存及防嵌套逻辑。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { validateW3c } from '../scripts/validate-w3c.mjs';
import { createEvaluator, getFreePort, navigateAndWait, waitFor } from './support/helpers.mjs';
import { launchChrome } from './support/cdp.mjs';
import { DIST_DIR as DIST, startServer } from './support/server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

test('dist/ 产物完整性与 Cache-Control 标头规则', () => {
  if (!existsSync(DIST)) {
    throw new Error('dist/ 目录不存在 —— 请先执行 npm run build');
  }

  // 1.1 文件完整性
  const requiredFiles = ['index.html', 'sw.js', '_headers', 'robots.txt', 'wallpapers/bg1.avif', 'LICENSE.txt', 'SOURCE.txt'];
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
  const appCc = rules['/app-builds/*']?.['cache-control'] || '';
  const manifestCc = rules['/manifest.json']?.['cache-control'] || '';
  const iconCc = rules['/apple-touch-icon.png']?.['cache-control'] || '';
  const validNoCache = [indexCc, rootCc, swCc, manifestCc].every(cc => cc.includes('max-age=0'));
  const validWp = ['wallpapers', 'icons'].every(dir => { const cc = rules['/' + dir + '/*']?.['cache-control'] || ''; return cc.includes('max-age=0') && cc.includes('must-revalidate') && !cc.includes('immutable'); });
  const validIcon = iconCc.includes('max-age=604800');
  const srcHeadersContent = readFileSync(join(ROOT, 'public', '_headers'), 'utf-8');
  const syncOk = srcHeadersContent.trim() === headersContent.trim();
  assert.ok(validNoCache && appCc.includes('immutable') && validWp && validIcon && syncOk, 'Cache-Control 头配置合规');

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
    startWatch({ label: 'Test' })();
  } finally {
    fs.watch = originalWatch;
  }
  const expectedSubscriptions = [
    { path: PATHS.src, recursive: true },
    { path: PATHS.public, recursive: true },
    { path: PATHS.root, recursive: false }
  ];
  assert.ok(buildPathsHasSrcIndexHtml);
  assert.deepEqual(subscriptions, expectedSubscriptions);
});

test('跨来源导航到旧预览清理路径时保留本地数据', { timeout: 20000 }, async t => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ['scripts/server.cjs', '--no-watch'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PORT: String(port), AUTO_OPEN: '0' }
  });
  t.after(() => server.kill());
  await once(server.stdout, 'data', { signal: t.signal });
  const origin = 'http://127.0.0.1:' + port;
  const formerEndpoint = origin + '/_clear_cache';
  const response = await fetch(formerEndpoint, { signal: t.signal });
  assert.equal(response.headers.get('Clear-Site-Data'), null);
  assert.match(await response.text(), /__GLASS_BUILD_HTML__/);

  const other = await startServer(0, undefined, { '/': `<a href="${formerEndpoint}">Navigate</a>` }, { testMode: false });
  t.after(() => other.close());
  const chrome = await launchChrome({ port: await getFreePort(), url: origin + '/', testMode: false });
  t.after(() => chrome.close());
  const evalJS = createEvaluator(chrome.send);
  await evalJS(`(async () => {
    await navigator.serviceWorker.ready;
    localStorage.setItem('preview-sentinel', 'kept');
    const req = indexedDB.open('preview-sentinel', 1);
    await new Promise((resolve, reject) => {
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = reject;
    });
  })()`);
  await navigateAndWait(chrome.send, evalJS, origin + '/', '!!navigator.serviceWorker.controller');
  await navigateAndWait(chrome.send, evalJS, 'http://127.0.0.1:' + other.port + '/');
  await evalJS(`setTimeout(() => document.querySelector('a').click(), 0); true`);
  await waitFor(evalJS, `location.href === ${JSON.stringify(formerEndpoint)} && document.readyState === 'complete'`);
  assert.deepEqual(await evalJS(`(async () => ({
    local: localStorage.getItem('preview-sentinel'),
    indexed: (await indexedDB.databases()).some(db => db.name === 'preview-sentinel')
  }))()`), { local: 'kept', indexed: true });
});

test('独立预览将启动 URL 交给临时 Chrome 配置，退出服务后清理', {
  timeout: 15000, skip: process.platform === 'win32'
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'glass-preview-fixture-'));
  const probe = join(directory, 'probe.json');
  const fakeChrome = join(directory, 'chrome');
  writeFileSync(fakeChrome, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const profile = args.find(arg => arg.startsWith('--user-data-dir=')).split('=').slice(1).join('=');
fs.writeFileSync(process.env.PREVIEW_PROBE_FILE, JSON.stringify({ profile, url: args.at(-1), ready: fs.existsSync(profile) }));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const port = await getFreePort();
  const server = spawn(process.execPath, ['scripts/server.cjs', '--no-watch', '--isolated'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), AUTO_OPEN: '1', CHROME_PATH: fakeChrome, PREVIEW_PROBE_FILE: probe, GLASS_TEST_TMPDIR: '' }
  });
  const closed = once(server, 'close');
  t.after(async () => {
    server.kill();
    await closed;
    rmSync(directory, { recursive: true, force: true });
  });
  const result = await waitFor(() => {
    try { return JSON.parse(readFileSync(probe, 'utf8')); } catch { return false; }
  }, 'Chrome preview args', 5000);
  assert.ok(result.ready);
  assert.ok(result.profile.startsWith(join(tmpdir(), 'glass-start-preview-')));
  assert.equal(result.url, `http://localhost:${port}/`);
  server.kill();
  assert.deepEqual(await closed, [0, null]);
  assert.equal(existsSync(result.profile), false);
});

test('预览允许产物入口链接，阻止静态文件链接逃出产物目录', {
  timeout: 10000, skip: process.platform === 'win32'
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'glass-preview-links-'));
  const build = join(directory, 'build');
  mkdirSync(build);
  writeFileSync(join(build, 'index.html'), '<title>Preview</title>');
  writeFileSync(join(directory, 'outside.txt'), 'outside preview');
  symlinkSync(build, join(directory, 'dist'));
  symlinkSync(join(directory, 'outside.txt'), join(build, 'outside.txt'));
  const port = await getFreePort();
  const server = spawn(process.execPath, ['scripts/server.cjs', '--no-watch'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'],
    env: {...process.env, GLASS_TEST_TMPDIR:directory, PORT:String(port), AUTO_OPEN:'0'}
  });
  t.after(async () => {
    const closed = once(server, 'close');
    if (server.kill()) await closed;
    rmSync(directory, {recursive:true, force:true});
  });
  await once(server.stdout, 'data', {signal:t.signal});
  const url = 'http://127.0.0.1:' + port;
  assert.equal((await fetch(url + '/', {signal:t.signal})).status, 200);
  const response = await fetch(url + '/outside.txt', {signal:t.signal});
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(await response.text(), '403 Forbidden');
});

test('Service Worker 核心预缓存资源与产物版本契约', () => {
  const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
  const distAssets = vm.runInNewContext(distSw + '\nCORE_ASSETS', {
    self: { registration: { scope: 'https://example.test/' }, addEventListener() {} }, URL
  });
  const distIndexContent = readFileSync(join(DIST, 'index.html'), 'utf-8');
  const version = distIndexContent.match(/window\.__GLASS_BUILD_HTML__="(app-core-v\d+-[0-9a-f]{16})"/)?.[1];
  assert.ok(version, 'HTML 必须包含构建指纹');
  const script = `app-builds/${version}.js`;
  assert.deepEqual(Array.from(distAssets), ['./', `./${script}`]);
  assert.ok(distIndexContent.includes(`<script src="./${script}" defer></script>`));
  assert.ok(!distIndexContent.includes('id="main-script"'));

  const distAppContent = readFileSync(join(DIST, script), 'utf-8');
  assert.equal(distAppContent.match(/window\.__GLASS_BUILD_APP__="([^"]+)"/)?.[1], version);
  assert.ok(distSw.includes(JSON.stringify(version)));
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
    caches: { match: async () => undefined }
  });
  handlers.get('fetch')({
    request: new Request('https://example.test/app-builds/app-core-v100.js'),
    respondWith: promise => { respond = promise; },
    waitUntil() {}
  });
  assert.equal((await respond).status, 503);
});

test('Service Worker 安装过程只请求同源核心资源', async () => {
  const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
  const installHandlers = new Map(), installTasks = [], installRequests = [];
  const version = srcSw.match(/const CORE_CACHE = '([^']+)'/)[1];
  const origin = 'https://example.test';
  const appUrl = `${origin}/app-builds/${version}.js`;
  class InstallRequest extends Request {
    constructor(url, options) { super(new URL(url, origin), options); }
  }
  vm.runInNewContext(srcSw, {
    self: { registration: { scope: `${origin}/` }, addEventListener: (name, handler) => installHandlers.set(name, handler) },
    URL,
    Request: InstallRequest, Response, AbortSignal,
    fetch: async request => {
      installRequests.push([request.url, request.cache]);
      if (request.url === `${origin}/`) return new Response(`window.__GLASS_BUILD_HTML__="${version}"`);
      if (request.url === appUrl) {
        if (request.cache === 'default') return new Response(null, {status:404});
        return new Response(`window.__GLASS_BUILD_APP__="${version}"`);
      }
      return new Response('wallpaper', {headers:{'Content-Type':'image/avif'}});
    },
    caches: {
      keys: async () => [],
      open: async () => ({ put: async () => {} }),
      delete: async () => true
    }
  });
  installHandlers.get('install')({ waitUntil: task => installTasks.push(task) });
  await Promise.all(installTasks);
  assert.deepEqual(installRequests, [
    [`${origin}/`, 'no-cache'],
    [appUrl, 'default'],
    [appUrl, 'reload'],
    [`${origin}/wallpapers/bg1.avif`, 'no-cache']
  ]);
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

test('天气首屏安全显示缓存图标并恢复温标', () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .find(match => match[1].includes('glass_weather_cache'))?.[1];
  assert.ok(script);
  for (const [icon, tempUnit, expectedTemp] of [
    ['x" onerror="window.__injected=1" data-x=".svg', null, '20°'],
    ['__proto__', '"F"', '68°'],
    ['☀️', 'F', '68°']
  ]) {
    const elements = Object.fromEntries(['weatherIcon', 'weatherTemp', 'weatherCity', 'weatherBtn']
      .map(id => [id, { textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {} }]));
    vm.runInNewContext(script, {
      localStorage: { getItem: key => key === 'glass_weather_cache'
        ? JSON.stringify({ current: {temp:20, icon}, location: {name:'测试'} }) : tempUnit },
      document: { getElementById: id => elements[id] },
      window: { __GLASS_I18N__: { t: () => '', weatherDescription: () => '' } }
    });
    assert.equal(elements.weatherTemp.textContent, expectedTemp);
    if (icon !== '☀️') {
      assert.equal(elements.weatherIcon.innerHTML, '', '异常缓存只能作为文字显示');
      assert.equal(elements.weatherIcon.textContent, icon);
    }
  }
});

async function validatePage(css, messages = [], options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'glass-validation-'));
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<link rel="canonical" href="https://start.test/nested/">\n<style>\n${css}\n</style>\n</head>\n<body style="color:red"></body></html>`;
  const output = [], requests = [];
  try {
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.html'), html);
    writeFileSync(join(directory, 'package.json'), '{"version":"5.5.0"}');
    const code = await validateW3c({ rootDir: directory, documentUrl: '',
      log: message => output.push(message), error: message => output.push(message),
      fetchImpl: async (url, request) => {
        requests.push({ url, ...request });
        return { ok: true, json: async () => ({ messages }) };
      }, ...options });
    return { code, html, requests, output: output.join('\n') };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('现代 CSS 校验接受注册属性、渐变变量过渡、line-clamp 与能力查询', async () => {
  const css = '@property --tone{syntax:"<color>";inherits:false;initial-value:red}.card{color:var(--tone);width:calc(1px + 2px);transition-property:--tone;line-clamp:2}@supports (margin-trim:inline){.card{color:red}}';
  const result = await validatePage(css, [{ type: 'error', message: 'CSS: Unrecognized at-rule “@property”', lastLine: 6 }]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Stylelint.*0 个错误/);
  assert.match(result.output, /另有 1 条诊断/);
  assert.equal(result.requests[0].body, result.html, '提交完整原始 HTML，不删除 CSS 或 CSP 来消除消息');
  assert.equal(result.requests[0].headers['Content-Location'], 'https://start.test/nested/');
  assert.equal(result.requests[0].url, process.env.W3C_VALIDATOR_URL ?? 'https://validator.w3.org/nu/?out=json');
});

test('现代 CSS 校验仍阻断真实语法、属性值与注册描述符错误', async () => {
  for (const css of ['.card{color:not-a-color}', '.card{colr:red}', '.card{line-clamp:banana}',
    '@property --x{syntax:"<color>";inherits:banana;initial-value:red}', '@property --x{initial-value:red}',
    '.card{top:calc(1px + 2)}', '.card{--offset:red;top:var(--offset)}',
    '@property --tone{syntax:"<color>";inherits:false;initial-value:red}.card{--tone:1px}',
    '.card{color:red', '/* stylelint-disable */ .card{color:not-a-color}']) {
    const result = await validatePage(css);
    assert.equal(result.code, 1, `${css}\n${result.output}`);
    assert.equal(result.requests.length, 0, 'CSS 失败后无需消耗在线请求');
  }
});

test('HTML 错误与未覆盖的行内 CSS 错误不能被样式块复核吞掉', async () => {
  for (const message of [
    { type: 'error', message: 'Element has an invalid attribute.', lastLine: 9 },
    { type: 'error', message: 'CSS: Unknown property.', lastLine: 9, firstColumn: 14 },
    { type: 'error', message: 'CSS: Unknown property.' },
    { type: 'error', message: 'CSS: Unknown property.', lastLine: 5, firstColumn: 1 }
  ]) {
    const result = await validatePage('.card{color:red}', [message]);
    assert.equal(result.code, 1, result.output);
  }
});

test('Nu 服务与校验文档来源可独立覆盖，服务失败和异常响应仍为未完成', async () => {
  const validatorUrl = 'http://127.0.0.1:8888/?out=json';
  const result = await validatePage('.card{color:red}', [], { validatorUrl, documentUrl: 'https://other.test/start/' });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.requests[0].url, validatorUrl);
  assert.equal(result.requests[0].headers['Content-Location'], 'https://other.test/start/');
  assert.equal(result.requests[0].body, result.html);
  const invalidUrl = await validatePage('.card{color:red}', [], { documentUrl: 'file:///tmp/index.html' });
  assert.equal(invalidUrl.code, 2);
  assert.equal(invalidUrl.requests.length, 0);
  const rateLimited = new Response('rate limited', { status: 429 });
  const limited = await validatePage('.card{color:red}', [], { fetchImpl: async () => rateLimited });
  assert.equal(limited.code, 2, limited.output);
  assert.match(limited.output, /HTTP 429/);
  assert.equal(rateLimited.bodyUsed, true);
  for (const fetchImpl of [
    async () => { throw new Error('network unavailable'); },
    async () => ({ ok: false, status: 503, statusText: 'unavailable' }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const incomplete = await validatePage('.card{color:red}', [], { fetchImpl });
    assert.equal(incomplete.code, 2, incomplete.output);
  }
});
