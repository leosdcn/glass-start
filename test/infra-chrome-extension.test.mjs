import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectCDP, launchChrome } from './support/cdp.mjs';
import { createEvaluator, getFreePort, waitFor } from './support/helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(process.env.GLASS_TEST_TMPDIR || root, 'extension');
createRequire(import.meta.url)('../scripts/build-extension.cjs').buildExtension(output);
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
assert(!/__glassSuggestCb_|JsonCallback|callback=/.test(readFileSync(join(output, 'app.js'), 'utf8')), '扩展编译时裁掉 JSONP');
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
            if (/myip\.ipip\.net/.test(value)) {
                return Promise.resolve(new Response(JSON.stringify({ ret: 'ok', data: { location: ['中国', '北京', '北京'] } })));
            }
            if (/geocoding-api\.open-meteo\.com/.test(value)) {
                return Promise.resolve(new Response(JSON.stringify({ results: [{ latitude: 39.9, longitude: 116.4, name: '北京' }] })));
            }
            if (/ipwho\.is/.test(value)) {
                return Promise.resolve(new Response(JSON.stringify({ success: true, latitude: 39.9, longitude: 116.4, city: 'Beijing' })));
            }
            if (/api\.open-meteo\.com/.test(value)) {
                return Promise.resolve(new Response(JSON.stringify({
                    current: { temperature_2m: 20, weather_code: 0, is_day: 1 },
                    daily: { temperature_2m_max: [25], temperature_2m_min: [15], weather_code: [0] }
                })));
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
    await waitFor(evalJS, `(() => {
        const icons = [...document.querySelectorAll('#bookmarks img')];
        return icons.length > 0 && icons.every(img => img.complete && img.naturalWidth > 0);
    })()`, 10000);

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
    await waitFor(evalJS,`document.querySelector('#editModal').open`);
    await evalJS(`document.querySelector('#tab-btn-appearance').click(); document.querySelector('[data-bg="./wallpapers/bg3.avif"]').click()`);
    await waitFor(evalJS,`document.querySelector('#bgLayerNext').style.backgroundImage.includes('bg3.avif')`);
    await evalJS(`document.querySelector('#cancelEditBtn').click()`);
    await send('Page.reload');
    await waitFor(evalJS,`document.querySelector('#bgLayer')?.style.backgroundImage.includes('bg1.avif') && !!document.querySelector('.bookmark-item')`,10000);

    // 实际保存浅色壁纸后，初始深色画布不能锁死恢复的主题。
    await evalJS(`document.querySelector('#editBookmarksBtn').click()`);
    await waitFor(evalJS,`document.querySelector('#editModal').open`);
    await evalJS(`document.querySelector('#tab-btn-appearance').click(); document.querySelector('[data-bg="./wallpapers/bg2.avif"]').click()`);
    await waitFor(evalJS,`document.querySelector('#bgLayerNext').style.backgroundImage.includes('bg2.avif')`);
    await evalJS(`document.querySelector('#saveEditBtn').click()`);
    await waitFor(evalJS,`!document.querySelector('#editModal').open`);
    await send('Page.reload');
    await waitFor(evalJS, `document.querySelector('#bgLayer')?.style.backgroundImage.includes('bg2.avif') && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS('getComputedStyle(document.documentElement).colorScheme'), 'light');
    await evalJS(`localStorage.setItem('glass_language', JSON.stringify('en'))`);
    await send('Page.reload');
    await waitFor(evalJS, `document.documentElement?.lang === 'en' && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS('document.title'), 'Glass Start');
    await evalJS(`document.querySelector('#engineBtn').click(); document.querySelector('[data-engine="wikipedia"]').click()`);
    await evalJS(`(() => { const input = document.querySelector('#searchInput'); input.value = 'glass english'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(evalJS, `window.__suggestRequests.some(url => url.includes('en.wikipedia.org')) && document.querySelector('#suggestionMenu').textContent.includes('extension suggestion')`);
    assert.deepEqual(await evalJS('window.__cspViolations'), []);
    assert.deepEqual(exceptions, []);

    await evalJS(`(async () => {
        const container = document.createElement('div');
        container.className = 'icon-box';
        const broken = document.createElement('img');
        broken.dataset.initial = 'Z';
        broken.src = './icons/does-not-exist.png';
        container.id = 'broken-icon-probe';
        container.append(broken);
        document.body.append(container);
        document.querySelector('#searchInput').value='';
        document.querySelector('#searchInput').dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#editBookmarksBtn').click();
    })()`);
    await waitFor(evalJS,`document.querySelector('#broken-icon-probe').textContent === 'Z'`);
    assert.equal(await evalJS(`caches.has('app-favicons-v1')`), false);
    await waitFor(evalJS,`document.querySelector('#editModal').open`);
    await evalJS(`document.querySelector('#tab-btn-data').click()`);
    const cacheSection = await evalJS(`document.querySelector('.data-section-cache')?.textContent || ''`);
    assert.equal(cacheSection.includes('Service Worker'), false, 'Extension data panel must not mention Service Worker');
    await evalJS(`document.querySelector('#clearCacheBtn').click()`);
    await waitFor(evalJS,`document.querySelector('#confirmModal').open`);
    assert.equal(await evalJS(`document.querySelector('#confirmOkBtn').textContent.trim()`), 'Reload page');
    const beforeCacheClear = await evalJS('performance.timeOrigin');
    await evalJS(`document.querySelector('#confirmOkBtn').click()`);
    await waitFor(evalJS,`performance.timeOrigin !== ${beforeCacheClear} && document.readyState==='complete' &&
        document.querySelector('#bookmarks')?.textContent.includes('扩展保存验证') && !document.querySelector('#editModal').open`,10000);
    assert.equal(await evalJS(`caches.has('app-favicons-v1')`),false);
    await waitFor(evalJS,`document.querySelector('#bgLayer').style.backgroundImage.includes('bg2.avif')`);
    assert.deepEqual(await evalJS('window.__cspViolations'), []);

    mkdirSync(join(root, 'test/artifacts'), { recursive: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, 'test/artifacts/chrome-extension.png'), Buffer.from(screenshot.data, 'base64'));

    await evalJS(`sessionStorage.setItem('startpage_section', 'nav'); localStorage.removeItem('glass_transition_mode')`);
    let pausedApp;
    const stopAppPause = send('Fetch.requestPaused', event => { pausedApp = event; });
    await send('Fetch.enable', { patterns: [{ urlPattern: `chrome-extension://${id}/app.js*` }] });
    await send('Page.reload');
    await waitFor(() => !!pausedApp, 'extension app request paused', 10000);
    await waitFor(evalJS, `document.readyState === 'interactive' && !window.__GLASS_BUILD_APP__`);
    const navAtTop = `document.documentElement.dataset.screen === 'nav' &&
        Math.abs(document.getElementById('navSection').getBoundingClientRect().top) < 1`;
    assert.equal(await evalJS(navAtTop), true);
    await send('Fetch.continueRequest', { requestId: pausedApp.requestId });
    await send('Fetch.disable');
    stopAppPause();
    await waitFor(evalJS, `!!window.__GLASS_BUILD_APP__ && !document.documentElement.classList.contains('screen-restoring')`);
    assert.equal(await evalJS(navAtTop), true);
    assert.equal(await evalJS(`document.getElementById('startSection').inert && !document.getElementById('navSection').inert`), true);
    console.log('✅ Chrome MV3 扩展通过冷启动底色、导航首帧、三引擎联想、设置保存及离线重载验证');
} finally {
    browser?.close();
    await chrome.close();
}
