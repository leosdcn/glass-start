import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addNewDocumentScript, launchSession, waitFor } from './support/helpers.mjs';

test('多语言切换、语言草稿、布局与离线验证套件', async t => {
const { server, chrome, send, evalJS } = await launchSession();
let tempArtifactsDir;
t.after(async () => {
    await chrome.close();
    await server.close();
    if (tempArtifactsDir) rmSync(tempArtifactsDir, { recursive: true, force: true });
});
const ready = () => waitFor(evalJS, `document.documentElement?.lang === 'en' && typeof openEditModal === 'function' && !!document.querySelector('.bookmark-item')`, 10000);
const firstLocalSuggestion = query => evalJS(`(() => {
    try {
        fetchSuggestions(state.engine, ${JSON.stringify(query)}, true);
        const item = dom.suggestionMenu.querySelector('.suggestion-item[data-url]');
        return item && { name: item.querySelector('span').textContent, url: item.dataset.url };
    } finally { hideSuggestions(); }
})()`);
const selectLanguageAndSave = async lang => {
    await evalJS(`(async () => {
        await openEditModal();
        document.getElementById('tab-btn-data').click();
        dom.languageBtn.click();
        dom.languageList.querySelector('[data-lang=${JSON.stringify(lang)}]').click();
        dom.doneLanguageBtn.click();
    })()`);
};
const chooseEnglish = async () => {
    await selectLanguageAndSave('en');
    await ready();
};
let destinations, autoLanguageLinks;
try {
  await t.test('默认中文、语言弹窗取消与切换英文全站目录', async () => {
    assert.equal(await evalJS(`document.title`), 'Glass Start');
    assert.equal(await evalJS(`state.engine`), 'bing');
    assert.deepEqual(await evalJS(`pageData.bookmarks.map(bookmark => bookmark.name)`),
        ['GitHub', 'DeepSeek', 'Gemini', 'YouTube', '哔哩哔哩', '抖音', '豆包', '网易云音乐']);
    for (const query of ['Google Arts & Culture', 'Google 艺术与文化']) {
        assert.deepEqual(await firstLocalSuggestion(query), { name: 'Google 艺术与文化', url: 'https://artsandculture.google.com' }, query);
    }
    assert.deepEqual(await firstLocalSuggestion('Quick, Draw!'), { name: '快速涂鸦', url: 'https://quickdraw.withgoogle.com' });
    await evalJS(`(async () => {
        await openEditModal();
        dom.languageBtn.click();
        dom.languageList.querySelector('[data-lang="en"]').click();
        dom.cancelLanguageBtn.click();
    })()`);
    assert.equal(await evalJS(`modalState.draftLanguage`), 'auto', 'language dialog cancel restores its initial draft');
    assert.equal(await evalJS(`dom.languageList.querySelector('[data-lang="auto"]').getAttribute('aria-checked')`), 'true');
    await evalJS(`(() => {
        dom.languageBtn.click();
        dom.languageList.querySelector('[data-lang="en"]').click();
        cancelEditModal();
    })()`);
    assert.equal(await evalJS(`localStorage.getItem('glass_language')`), null, 'cancel does not save language');

    await chooseEnglish();
    assert.equal(await evalJS(`state.engine`), 'google');
    assert.equal(await evalJS(`dom.engineName.textContent`), 'Google');
    assert.equal(await evalJS(`localStorage.getItem('preferredEngine')`), null, 'default engine is not saved as a user preference');
    await waitFor(evalJS, `!!document.querySelector('#sidebarList button')`);
    assert.equal(await evalJS(`document.title`), 'Glass Start');
    assert.equal(await evalJS(`dom.searchInput.placeholder`), 'Search...');
    assert.equal(await evalJS(`document.documentElement.hasAttribute('data-i18n-pending')`), false);
    assert.equal(await evalJS(`pageData.categories[0].name`), 'AI');
    assert.deepEqual(await evalJS(`pageData.bookmarks.map(bookmark => bookmark.name)`),
        ['ChatGPT', 'Gemini', 'DeepSeek', 'GitHub', 'YouTube', 'Spotify', 'Reddit', 'X']);
    assert.equal(await evalJS(`pageData.categories.every(category => category.bookmarks.every(bookmark => !/[\u4e00-\u9fff]/.test(bookmark.name + bookmark.desc)))`), true);
    for (const query of ['维基百科', 'Wikipedia']) {
        assert.deepEqual(await firstLocalSuggestion(query), { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' }, query);
    }
    assert.deepEqual(await firstLocalSuggestion('快速涂鸦'), { name: 'Quick, Draw!', url: 'https://quickdraw.withgoogle.com' });

    // Destinations vary by language; stored bookmark identity must remain stable.
    destinations = await evalJS(`(() => {
        const links = [...document.querySelectorAll('.nav-bookmark')].map(link => link.getAttribute('href'));
        return Object.entries(window.__GLASS_I18N__.catalogs['zh-CN'].bookmarks)
            .filter(([, bookmark]) => bookmark.url)
            .map(([source, bookmark]) => {
                const destination = window.__GLASS_I18N__.catalogs.en.bookmarks[source]?.url || source;
                return { source, destination, chinese: bookmark.url, rendered: links.includes(destination) };
            });
    })()`);
    assert.equal(destinations.length, 7);
    assert.ok(destinations.every(item => item.rendered), JSON.stringify(destinations));
    const quickLink = await evalJS(`(() => {
        const original = storageGet(CONFIG.KEYS.BOOKMARKS);
        const bookmark = pageData.categories.flatMap(category => category.bookmarks).find(bookmark => bookmark.name === 'DeepL');
        try {
            storageRemove(CONFIG.KEYS.BOOKMARKS);
            storageSet(CONFIG.KEYS.BOOKMARK_KEYS, ['https://www.deepl.com/zh/translator', bookmark.url]);
            storageSet(CONFIG.KEYS.CUSTOM_META, { 'https://www.deepl.com/zh/translator': { name: 'My translator', desc: 'My description' } });
            loadBookmarks();
            const inherited = pageData.bookmarks.map(bookmark => ({ ...bookmark }));
            saveUserBookmarks(pageData.bookmarks);
            loadBookmarks();
            return { inherited, stored: storageGet(CONFIG.KEYS.BOOKMARKS), url: pageData.bookmarks[0].url,
                href: document.querySelector('.bookmark-item').getAttribute('href') };
        } finally {
            storageRemove(CONFIG.KEYS.BOOKMARK_KEYS);
            storageRemove(CONFIG.KEYS.CUSTOM_META);
            if (original) storageSet(CONFIG.KEYS.BOOKMARKS, original);
            else storageRemove(CONFIG.KEYS.BOOKMARKS);
            loadBookmarks();
        }
    })()`);
    assert.equal(quickLink.inherited.length, 1, 'old and shared URLs resolve to one bookmark');
    assert.equal(quickLink.inherited[0].name, 'My translator');
    assert.equal(quickLink.inherited[0].desc, 'My description');
    assert.equal(quickLink.stored.version, 1);
    assert.deepEqual(quickLink.stored.keys, ['https://www.deepl.com/translator']);
    assert.equal(quickLink.stored.meta['https://www.deepl.com/translator'].name, 'My translator');
    assert.equal(quickLink.url, 'https://www.deepl.com/translator');
    assert.equal(quickLink.href, 'https://www.deepl.com/translator');

    autoLanguageLinks = ['https://www.deepl.com/translator', 'https://tools.pdf24.org', 'https://time.is/', 'https://www.emojiall.com'];
    const englishLinks = await evalJS(`[...document.querySelectorAll('.nav-bookmark')].map(link => link.getAttribute('href'))`);
    assert.ok(autoLanguageLinks.every(url => englishLinks.includes(url)), 'English uses shared URLs for automatic language selection');
  });

  await t.test('延迟加载应用包时首屏内联脚本独立完成多语言与天气预渲染', async () => {
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const removeWeatherCache = await addNewDocumentScript(send, `
        localStorage.setItem('glass_weather_cache', JSON.stringify({
            current: { temp: 24, weatherCode: 2 }, location: { name: 'Shanghai' }, timestamp: Date.now()
        }));
    `);
    let pausedApp;
    const stopPausing = send('Fetch.requestPaused', event => { pausedApp = event; });
    try {
        await send('Fetch.enable', { patterns: [{ urlPattern: '*/app-builds/*.js' }] });
        await send('Page.reload');
        await waitFor(() => Promise.resolve(!!pausedApp), 'deferred app request paused', 10000);
        await waitFor(evalJS, `document.querySelector('#searchInput')?.placeholder === 'Search...' && !document.documentElement.hasAttribute('data-i18n-pending')`);
        assert.equal(await evalJS(`typeof openEditModal`), 'undefined', 'app bundle has not executed');
        assert.equal(await evalJS(`document.getElementById('engineName').textContent`), 'Google');
        assert.match(await evalJS(`document.getElementById('engineBtn').getAttribute('aria-label')`), /Google/);
        assert.equal(await evalJS(`document.title`), 'Glass Start');
        assert.equal(await evalJS(`document.getElementById('weatherCity').textContent`), 'Shanghai');
        assert.equal(await evalJS(`document.getElementById('weatherTemp').textContent`), '24°');
        assert.match(await evalJS(`document.getElementById('weatherBtn').getAttribute('aria-label')`), /^Shanghai: 24°,/);
        await evalJS(`localStorage.removeItem('glass_weather_cache')`);
    } finally {
        await removeWeatherCache();
        if (pausedApp) await send('Fetch.continueRequest', { requestId: pausedApp.requestId }).catch(() => {});
        await send('Fetch.disable').catch(() => {});
        stopPausing();
        await send('Network.setBypassServiceWorker', { bypass: false });
        await send('Network.setCacheDisabled', { cacheDisabled: false });
    }
    await send('Page.reload');
    await ready();
  });

  await t.test('英文下继承字段保存、重排及语言存储失败重试', async () => {
    await evalJS(`dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="bing"]').click()`);
    await send('Page.reload');
    await ready();
    assert.equal(await evalJS(`state.engine`), 'bing', 'saved engine takes priority over the English default');
    assert.equal(await evalJS(`dom.engineName.textContent`), 'Bing');

    await evalJS(`(async () => {
        await openEditModal();
        const input = dom.editList.querySelector('.edit-name');
        input.value = '我的自定义书签';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await saveEditModal();
    })()`);
    const inherited = await evalJS(`(() => {
        const bm = pageData.bookmarks[0];
        return storageGet(CONFIG.KEYS.BOOKMARKS).meta[normalizeUrl(bm.url)];
    })()`);
    assert.equal(inherited.name, '我的自定义书签');
    assert.equal(inherited.desc, undefined, 'inherited English description stays inherited');

    await evalJS(`(async () => {
        await openEditModal();
        const handle = dom.editList.querySelector('.edit-row-card .drag-handle');
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await saveEditModal();
    })()`);
    const customCount = await evalJS(`Object.keys(storageGet(CONFIG.KEYS.BOOKMARKS).meta).length`);
    assert.equal(customCount, 1);

    const failed = await evalJS(`(async () => {
        await openEditModal();
        document.getElementById('tab-btn-data').click();
        dom.languageBtn.click();
        dom.languageList.querySelector('[data-lang="zh-CN"]').click();
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key === 'glass_language') throw new Error('blocked'); return original.call(this, key, value); };
        try {
            dom.doneLanguageBtn.click();
            const deadline = Date.now() + 3000;
            while (OverlayStack.top()?.id !== 'confirmModal' && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            return { open: state.editOpen, message: dom.confirmMsg.textContent, saved: storageGet(CONFIG.KEYS.LANGUAGE) };
        } finally {
            Storage.prototype.setItem = original;
        }
    })()`);
    assert.equal(failed.open, true);
    assert.equal(failed.saved, 'en');
    assert.match(failed.message, /Could not save the language/);
    await evalJS(`dom.confirmOkBtn.click(); cancelEditModal();`);
  });

  await t.test('英文天气缓存过滤中文且即时按天气代码本地化', async () => {
    const forecastDates = await evalJS(`Array.from({length: 3}, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() + index);
        return new Intl.DateTimeFormat('sv-SE').format(date);
    })`);
    const weather = await evalJS(`(() => {
        const cached = { current: { temp: 22, apparent: 21, weatherCode: 0, weatherText: '晴', icon: '☀️' },
            location: { name: 'Shanghai' }, daily: [{ date: ${JSON.stringify(forecastDates[0])}, weatherCode: 3, label: '今天', text: '阴', tempMax: 24, tempMin: 18 }] };
        renderWeatherCapsule(cached); renderWeatherPopover(cached);
        return { label: dom.weatherBtn.getAttribute('aria-label'), text: dom.weatherPopover.textContent };
    })()`);
    assert.match(weather.label, /Clear/);
    assert.match(weather.text, /Overcast/);
    assert.match(weather.text, /Feels like/);
    assert.doesNotMatch(weather.text, /[\u4e00-\u9fff]/);

    const freshWeather = await evalJS(`(async () => {
        const originalFetch = window.fetch;
        try {
            window.fetch = async () => ({ ok: true, json: async () => ({
                current: { temperature_2m: 22, weather_code: 0, is_day: 1 },
                daily: { time: ${JSON.stringify(forecastDates)}, weather_code: [3, 999, 2] }
            }) });
            const data = await fetchWeatherForecast({ lat: 31, lon: 121, name: 'Shanghai' });
            renderWeatherCapsule(data); renderWeatherPopover(data);
            return { data, view: { label: dom.weatherBtn.getAttribute('aria-label'), text: dom.weatherPopover.textContent } };
        } finally {
            window.fetch = originalFetch;
        }
    })()`);
    assert.equal(Object.hasOwn(freshWeather.data.current, 'weatherText'), false);
    assert.ok(freshWeather.data.daily.every(day => !Object.hasOwn(day, 'text') && !Object.hasOwn(day, 'label')));
    assert.match(freshWeather.view.label, /Clear/);
    assert.match(freshWeather.view.text, /Today/);
    assert.match(freshWeather.view.text, /Overcast/);
    assert.match(freshWeather.view.text, /No data/);
    assert.doesNotMatch(freshWeather.view.text, /[\u4e00-\u9fff]/);
  });

  await t.test('桌面与移动端英文设置布局、离线切回中文及部分重置恢复', async () => {
    const artifactsDir = process.env.GLASS_SAVE_TEST_ARTIFACTS === '1'
        ? new URL('./artifacts/', import.meta.url)
        : (tempArtifactsDir = join(process.env.GLASS_TEST_TMPDIR || tmpdir(), `glass-i18n-${process.pid}`));
    mkdirSync(artifactsDir, { recursive: true });
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 });
        await evalJS(`openEditModal()`);
        for (const tab of ['tabAppearance', 'tabData']) {
            await evalJS(`document.getElementById('${tab}' === 'tabData' ? 'tab-btn-data' : 'tab-btn-appearance').click()`);
            await waitFor(evalJS, `getComputedStyle(document.getElementById('editModal')).opacity === '1' && getComputedStyle(document.getElementById('editModal').querySelector('.glass-strong')).opacity === '1'`);
            if (tab === 'tabAppearance') await waitFor(evalJS, `[...dom.presetWallpaperGrid.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0 && img.classList.contains('loaded'))`);
            const layout = await evalJS(`new Promise(resolve => requestAnimationFrame(() => {
                const dialog = document.getElementById('editModal').querySelector('.glass-strong').getBoundingClientRect();
                const panel = document.getElementById('${tab}');
                resolve({ fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight + 1,
                    overflow: panel.scrollWidth > panel.clientWidth + 1 });
            }))`);
            assert.ok(layout.fits && !layout.overflow, JSON.stringify({ width, tab, ...layout }));
            const { data } = await send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(artifactsDir instanceof URL ? new URL(`i18n-${width}-${tab}.png`, artifactsDir) : join(artifactsDir, `i18n-${width}-${tab}.png`), Buffer.from(data, 'base64'));
        }
        await evalJS(`cancelEditModal()`);
    }
    await send('Emulation.clearDeviceMetricsOverride');

    await send('Network.enable');
    await waitFor(evalJS, `!!navigator.serviceWorker.controller`, 10000);
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send('Page.reload');
    await ready();
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === '我的自定义书签')`), true);
    await selectLanguageAndSave('zh-CN');
    await waitFor(evalJS, `document.documentElement?.lang === 'zh-CN' && !!document.querySelector('.bookmark-item')`, 10000);
    const zhWeather = await evalJS(`(async () => {
        const today = new Date();
        const forecastDates = Array.from({length: 3}, (_, index) => {
            const date = new Date(today); date.setDate(date.getDate() + index);
            return new Intl.DateTimeFormat('sv-SE').format(date);
        });
        const originalFetch = window.fetch;
        try {
            window.fetch = async () => ({ ok: true, json: async () => ({
                current: { temperature_2m: 22, weather_code: 0, is_day: 1 },
                daily: { time: forecastDates, weather_code: [3, 999, 2] }
            }) });
            const data = await fetchWeatherForecast({ lat: 31, lon: 121, name: 'Shanghai' });
            renderWeatherCapsule(data); renderWeatherPopover(data);
            return { label: dom.weatherBtn.getAttribute('aria-label'), text: dom.weatherPopover.textContent };
        } finally { window.fetch = originalFetch; }
    })()`);
    assert.match(zhWeather.label, /晴/);
    assert.match(zhWeather.text, /今天/);
    assert.match(zhWeather.text, /阴/);
    assert.match(zhWeather.text, /暂无数据/);
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === 'Reddit')`), true);
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === '我的自定义书签')`), true);
    await waitFor(evalJS, `!!document.querySelector('.nav-bookmark')`);
    const chineseLinks = await evalJS(`[...document.querySelectorAll('.nav-bookmark')].map(link => link.getAttribute('href'))`);
    assert.ok(destinations.every(item => chineseLinks.includes(item.chinese)), 'Chinese catalog retains its remaining localized destinations');
    assert.ok(autoLanguageLinks.every(url => chineseLinks.includes(url)), 'Chinese also uses shared URLs for automatic language selection');

    // Reset must use the same locale default as initialization, without requiring a reload.
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const removeAutoLocale = await addNewDocumentScript(send, `
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });
        localStorage.removeItem('glass_language');
    `);
    try {
        await send('Page.reload');
        await ready();
        await evalJS(`(async () => {
            dom.engineBtn.click();
            dom.dropdownMenu.querySelector('[data-engine="bing"]').click();
            await openEditModal();
            document.getElementById('tab-btn-data').click();
            dom.resetEditBtn.click();
            dom.confirmOkBtn.click();
        })()`);
        await waitFor(evalJS, '!state.editOpen');
        assert.equal(await evalJS('state.engine'), 'google', 'automatic English reset restores Google immediately');
        assert.equal(await evalJS('dom.engineName.textContent'), 'Google');
        assert.equal(await evalJS('localStorage.getItem(CONFIG.KEYS.PREFERRED_ENGINE)'), null);
        await send('Page.reload');
        await ready();
        assert.equal(await evalJS('state.engine'), 'google', 'reset and reload agree on the default engine');
    } finally {
        await removeAutoLocale();
    }

    const removeEnLanguages = await addNewDocumentScript(send, "Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] });");
    try {
        await selectLanguageAndSave('zh-CN');
        await waitFor(evalJS, `document.documentElement.lang === 'zh-CN' && typeof openEditModal === 'function'`);
        await evalJS(`(async () => {
            await openEditModal();
            const remove = Storage.prototype.removeItem;
            window.restoreStorage = () => { Storage.prototype.removeItem = remove; };
            Storage.prototype.removeItem = function(key) {
                if (key === CONFIG.KEYS.NAV_DISCOVERED) throw Error('reset blocked');
                return remove.call(this, key);
            };
            resetAllSettings(); dom.confirmOkBtn.click();
        })()`);
        await waitFor(evalJS, `modalState.phase === 'editing' && dom.confirmModal.open && !storageGet(CONFIG.KEYS.LANGUAGE)`);
        assert.equal(await evalJS(`document.documentElement.lang`), 'zh-CN');
        await evalJS('restoreStorage(); dom.confirmOkBtn.click(); resetAllSettings(); dom.confirmOkBtn.click()');
        await ready();
        assert.equal(await evalJS('state.engine'), 'google', 'retry reconciles the effective locale after a partial reset');
    } finally {
        await removeEnLanguages();
    }
    console.log('✅ 英文全站、语言草稿与保存失败、书签继承、天气缓存、桌面/触屏布局及离线切换通过');
  });
} finally {
    // cleanup handled by t.after
}
});
