import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectCDP, launchChrome } from './support/cdp.mjs';
import { createEvaluator, getFreePort, waitFor } from './support/helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
createRequire(import.meta.url)('../scripts/build-extension.cjs').buildExtension();
const output = join(root, 'extension');
const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
const html = readFileSync(join(output, 'index.html'), 'utf8');
assert.equal(manifest.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background, undefined);
assert.equal(manifest.permissions, undefined);
assert.equal(manifest.default_locale, 'en');
assert.equal(manifest.name, '__MSG_extensionName__');
for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(readFileSync(join(output, '_locales', locale, 'messages.json'), 'utf8'));
    assert.ok(messages.extensionName.message && messages.extensionDescription.message);
}
assert(!/<script\b(?![^>]*\bsrc=)/i.test(html), '扩展中不得存在内联脚本');
assert(!/JsonCallback|callback=/.test(readFileSync(join(output, 'app.js'), 'utf8')), '扩展编译时裁掉 JSONP');
assert(!existsSync(join(output, 'sw.js')));

const port = await getFreePort();
const chrome = await launchChrome({ port, url: 'about:blank', testMode: false,
    extraArgs: ['--enable-unsafe-extension-debugging'] });
let browser;
try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = await connectCDP(new WebSocket(version.webSocketDebuggerUrl));
    const { id } = await browser.send('Extensions.loadUnpacked', { path: output });
    const { send } = chrome;
    const evalJS = createEvaluator(send);
    const exceptions = [];
    await send('Runtime.enable');
    send('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
    // 固定远程数据，验证请求和解析，不让第三方服务可用性影响回归测试。
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['zh-CN'] });
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(e.violatedDirective));
        window.__suggestRequests = [];
        const originalFetch = window.fetch;
        window.fetch = (url, options) => {
            const value = String(url);
            if (/api.bing.com|suggestqueries.google.com|(?:zh|en).wikipedia.org/.test(value)) {
                window.__suggestRequests.push(value);
                return Promise.resolve(new Response(JSON.stringify(['glass', ['extension suggestion']])));
            }
            return originalFetch(url, options);
        };
    ` });
    // 浅色浏览器、冷缓存、首个脚本尚未加载时也必须先有深色页面底色。
    await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    let pausedBootstrap;
    const stopPausing = send('Fetch.requestPaused', event => { pausedBootstrap = event; });
    await send('Fetch.enable', { patterns: [{ urlPattern: `chrome-extension://${id}/bootstrap-1.js` }] });
    await send('Page.navigate', { url: 'chrome://newtab/' });
    await waitFor(() => Promise.resolve(!!pausedBootstrap), 'first bootstrap request paused', 10000);
    await waitFor(evalJS, `!!document.querySelector('script[src="./bootstrap-1.js"]')`);
    const initialCanvas = await evalJS(`(() => {
        const style = getComputedStyle(document.documentElement);
        return { scheme: style.colorScheme, background: style.backgroundColor, initialized: !!window.__GLASS_BUILD_HTML__ };
    })()`);
    assert.equal(initialCanvas.initialized, false, '首个脚本仍未执行');
    assert.equal(initialCanvas.scheme, 'dark', '脚本加载前已声明深色画布');
    assert(!['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(initialCanvas.background), '脚本加载前不能透出默认白底');
    await send('Fetch.continueRequest', { requestId: pausedBootstrap.requestId });
    await send('Fetch.disable');
    stopPausing();
    await waitFor(evalJS, `location.protocol === 'chrome-extension:' && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS('location.host'), id, '实际替换 Chrome 新标签页');
    assert.equal(await evalJS('window.__GLASS_BUILD_HTML__ === window.__GLASS_BUILD_APP__'), true);
    assert.equal(await evalJS('window.__GLASS_TEST__'), undefined);
    assert.equal(await evalJS('navigator.serviceWorker.controller'), null);
    await waitFor(evalJS, 'document.querySelector("#bgLayer").style.backgroundImage.includes("wallpapers/")');
    assert.equal(await evalJS('[...document.querySelectorAll("#bookmarks img")].every(img => img.complete && img.naturalWidth > 0)'), true);

    // 用实际控件触发所有引擎的联想请求。
    for (const [engine, host] of [['bing', 'api.bing.com'], ['google', 'suggestqueries.google.com'], ['wikipedia', 'zh.wikipedia.org']]) {
        await evalJS(`document.querySelector('#engineBtn').click()`);
        await evalJS(`document.querySelector('[data-engine="${engine}"]').click()`);
        await evalJS(`(() => { const input = document.querySelector('#searchInput'); input.value = 'glass ${engine}'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await waitFor(evalJS, `window.__suggestRequests.some(url => url.includes('${host}')) && document.querySelector('#suggestionMenu').textContent.includes('extension suggestion')`);
        await evalJS(`document.querySelector('#searchInput').value = ''; document.querySelector('#searchInput').dispatchEvent(new Event('input', { bubbles: true }))`);
    }

    await evalJS(`document.querySelector('#editBookmarksBtn').click()`);
    await waitFor(evalJS, `!!document.querySelector('.edit-name')`);
    await evalJS(`(() => { const name = document.querySelector('.edit-name'); name.value = '扩展保存验证'; name.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#saveEditBtn').click(); })()`);
    await waitFor(evalJS, `document.querySelector('#bookmarks').textContent.includes('扩展保存验证')`);
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send('Page.reload');
    await waitFor(evalJS, `document.querySelector('#bookmarks')?.textContent.includes('扩展保存验证')`, 10000);
    await waitFor(evalJS, `document.querySelector('#bgLayer').style.backgroundImage.includes('wallpapers/')`);
    assert.equal(await evalJS('document.querySelector("#clock").offsetWidth > 0'), true);

    // 设置内只预览：取消后离线重载仍使用原壁纸。
    await evalJS(`document.querySelector('#editBookmarksBtn').click()`);
    await waitFor(evalJS,`document.querySelector('#editModal').classList.contains('active')`);
    await evalJS(`document.querySelector('#tab-btn-appearance').click(); document.querySelector('[data-bg="./wallpapers/bg3.avif"]').click()`);
    await waitFor(evalJS,`document.querySelector('#bgLayerNext').style.backgroundImage.includes('bg3.avif')`);
    await evalJS(`document.querySelector('#cancelEditBtn').click()`);
    await send('Page.reload');
    await waitFor(evalJS,`document.querySelector('#bgLayer')?.style.backgroundImage.includes('bg1.avif') && !!document.querySelector('.bookmark-item')`,10000);

    // 实际保存浅色壁纸后，初始深色画布不能锁死恢复的主题。
    await evalJS(`document.querySelector('#editBookmarksBtn').click()`);
    await waitFor(evalJS,`document.querySelector('#editModal').classList.contains('active')`);
    await evalJS(`document.querySelector('#tab-btn-appearance').click(); document.querySelector('[data-bg="./wallpapers/bg2.avif"]').click()`);
    await waitFor(evalJS,`document.querySelector('#bgLayerNext').style.backgroundImage.includes('bg2.avif')`);
    await evalJS(`document.querySelector('#saveEditBtn').click()`);
    await waitFor(evalJS,`!document.querySelector('#editModal').classList.contains('active')`);
    await send('Page.reload');
    await waitFor(evalJS, `document.querySelector('#bgLayer')?.style.backgroundImage.includes('bg2.avif') && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS('getComputedStyle(document.documentElement).colorScheme'), 'light');
    await evalJS(`localStorage.setItem('glass_language', JSON.stringify('en'))`);
    await send('Page.reload');
    await waitFor(evalJS, `document.documentElement.lang === 'en' && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS('document.title'), 'Glass Start');
    await evalJS(`document.querySelector('#engineBtn').click(); document.querySelector('[data-engine="wikipedia"]').click()`);
    await evalJS(`(() => { const input = document.querySelector('#searchInput'); input.value = 'glass english'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(evalJS, `window.__suggestRequests.some(url => url.includes('en.wikipedia.org')) && document.querySelector('#suggestionMenu').textContent.includes('extension suggestion')`);
    assert.deepEqual(await evalJS('window.__cspViolations'), []);
    assert.deepEqual(exceptions, []);

    await evalJS(`(async () => {
        await caches.open('app-favicons-v1');
        document.querySelector('#searchInput').value='';
        document.querySelector('#searchInput').dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#editBookmarksBtn').click();
    })()`);
    await waitFor(evalJS,`document.querySelector('#editModal').classList.contains('active')`);
    await evalJS(`document.querySelector('#tab-btn-data').click(); document.querySelector('#clearCacheBtn').click()`);
    await waitFor(evalJS,`document.querySelector('#confirmModal').classList.contains('active')`);
    await evalJS(`document.querySelector('#confirmOkBtn').click()`);
    await waitFor(evalJS,`document.readyState==='complete' && document.querySelector('#bookmarks')?.textContent.includes('扩展保存验证') && !document.querySelector('#editModal').classList.contains('active')`,10000);
    assert.equal(await evalJS(`caches.has('app-favicons-v1')`),false);
    await waitFor(evalJS,`document.querySelector('#bgLayer').style.backgroundImage.includes('bg2.avif')`);
    assert.deepEqual(await evalJS('window.__cspViolations'), []);

    mkdirSync(join(root, 'test/artifacts'), { recursive: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, 'test/artifacts/chrome-extension.png'), Buffer.from(screenshot.data, 'base64'));
    console.log('✅ Chrome MV3 扩展：脚本加载前深色底色、浅色主题恢复、新标签页、三引擎联想、设置保存和离线重载通过，无 CSP 违规');
} finally {
    browser?.close();
    await chrome.close();
}
