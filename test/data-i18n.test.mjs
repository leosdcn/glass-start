import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchSession, waitFor } from './support/helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
const ready = () => waitFor(evalJS, `document.documentElement.lang === 'en' && typeof openEditModal === 'function' && !!document.querySelector('.bookmark-item')`, 10000);
const chooseEnglish = async () => {
    await evalJS(`(async () => {
        await openEditModal();
        document.getElementById('tab-btn-data').click();
        dom.languageSelect.value = 'en';
        dom.languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
        dom.saveEditBtn.click();
    })()`);
    await ready();
};
try {
    await evalJS(`(async () => {
        await openEditModal();
        dom.languageSelect.value = 'en';
        dom.languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
        cancelEditModal();
    })()`);
    assert.equal(await evalJS(`localStorage.getItem('glass_language')`), null, 'cancel does not save language');

    await chooseEnglish();
    await waitFor(evalJS, `!!document.querySelector('#sidebarList button')`);
    assert.equal(await evalJS(`document.title`), 'Glass Start — A Clear Start');
    assert.equal(await evalJS(`dom.searchInput.placeholder`), 'Search...');
    assert.equal(await evalJS(`document.documentElement.hasAttribute('data-i18n-pending')`), false);
    assert.equal(await evalJS(`pageData.categories[0].name`), 'Artificial intelligence');
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === 'Bilibili')`), true);
    assert.equal(await evalJS(`pageData.categories.every(category => category.bookmarks.every(bookmark => !/[\u4e00-\u9fff]/.test(bookmark.name + bookmark.desc)))`), true);

    // Hold the deferred app bundle: the head and body bootstrap must translate independently.
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    let pausedApp;
    const stopPausing = send('Fetch.requestPaused', event => { pausedApp = event; });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*app.js*' }] });
    await send('Page.reload');
    await waitFor(() => Promise.resolve(!!pausedApp), 'deferred app request paused', 10000);
    await waitFor(evalJS, `document.querySelector('#searchInput')?.placeholder === 'Search...' && !document.documentElement.hasAttribute('data-i18n-pending')`);
    assert.equal(await evalJS(`typeof openEditModal`), 'undefined', 'app bundle has not executed');
    assert.equal(await evalJS(`document.title`), 'Glass Start — A Clear Start');
    await send('Fetch.continueRequest', { requestId: pausedApp.requestId });
    await send('Fetch.disable');
    stopPausing();
    await send('Network.setBypassServiceWorker', { bypass: false });
    await send('Network.setCacheDisabled', { cacheDisabled: false });
    await send('Page.reload');
    await ready();

    // An untouched inherited field must not become custom when only another field changes.
    await evalJS(`(async () => {
        await openEditModal();
        const input = dom.editList.querySelector('.edit-name');
        input.value = '我的自定义书签';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await saveEditModal();
    })()`);
    const inherited = await evalJS(`(() => {
        const bm = pageData.bookmarks[0];
        return storageGet(CONFIG.KEYS.CUSTOM_META)[normalizeUrl(bm.url)];
    })()`);
    assert.equal(inherited.name, '我的自定义书签');
    assert.equal(inherited.desc, undefined, 'inherited English description stays inherited');

    // Saving a reorder alone must not write any translated default text.
    await evalJS(`(async () => { await openEditModal(); replaceBookmarkDraft([...modalState.draftBookmarks].reverse(), true); await saveEditModal(); })()`);
    const customCount = await evalJS(`Object.keys(storageGet(CONFIG.KEYS.CUSTOM_META)).length`);
    assert.equal(customCount, 1);

    // Exercise real storage failure and retry without discarding the draft.
    const failed = await evalJS(`(async () => {
        await openEditModal();
        modalState.draftLanguage = 'zh-CN';
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key === 'glass_language') throw new Error('blocked'); return original.call(this, key, value); };
        try { await saveEditModal(); return { open: state.editOpen, message: dom.confirmMsg.textContent, saved: storageGet(CONFIG.KEYS.LANGUAGE) }; }
        finally { Storage.prototype.setItem = original; }
    })()`);
    assert.equal(failed.open, true);
    assert.equal(failed.saved, 'en');
    assert.match(failed.message, /Could not save the language/);
    await evalJS(`dom.confirmOkBtn.click(); cancelEditModal();`);

    // Cached Chinese descriptions must not leak into the English forecast or its ARIA label.
    const weather = await evalJS(`(() => {
        const cached = { current: { temp: 22, apparent: 21, weatherCode: 0, weatherText: '晴', icon: '☀️' },
            location: { name: 'Shanghai' }, daily: [{ date: '2026-10-28', weatherCode: 3, label: '今天', text: '阴', tempMax: 24, tempMin: 18 }] };
        renderWeatherCapsule(cached); renderWeatherPopover(cached);
        return { label: dom.weatherBtn.getAttribute('aria-label'), text: dom.weatherPopover.textContent };
    })()`);
    assert.match(weather.label, /Clear/);
    assert.match(weather.text, /Overcast/);
    assert.match(weather.text, /Feels like/);
    assert.doesNotMatch(weather.text, /[\u4e00-\u9fff]/);

    // Mobile layout and screenshots use actual rendered UI.
    mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 });
        await evalJS(`openEditModal()`);
        for (const tab of ['tabAppearance', 'tabData']) {
            await evalJS(`document.getElementById('${tab}' === 'tabData' ? 'tab-btn-data' : 'tab-btn-appearance').click()`);
            await waitFor(evalJS, `getComputedStyle(dom.editModal).opacity === '1' && getComputedStyle(dom.editModal.querySelector('.glass-strong')).opacity === '1'`);
            if (tab === 'tabAppearance') await waitFor(evalJS, `[...dom.presetWallpaperGrid.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0 && img.classList.contains('loaded'))`);
            const layout = await evalJS(`new Promise(resolve => requestAnimationFrame(() => {
                const dialog = dom.editModal.querySelector('.glass-strong').getBoundingClientRect();
                const panel = dom.${tab};
                resolve({ fits: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight + 1,
                    overflow: panel.scrollWidth > panel.clientWidth + 1 });
            }))`);
            assert.ok(layout.fits && !layout.overflow, JSON.stringify({ width, tab, ...layout }));
            const { data } = await send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(new URL(`./artifacts/i18n-${width}-${tab}.png`, import.meta.url), Buffer.from(data, 'base64'));
        }
        await evalJS(`cancelEditModal()`);
    }

    await send('Network.enable');
    await waitFor(evalJS, `!!navigator.serviceWorker.controller`, 10000);
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await send('Page.reload');
    await ready();
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === '我的自定义书签')`), true);
    await evalJS(`(async () => { await openEditModal(); modalState.draftLanguage = 'zh-CN'; dom.saveEditBtn.click(); })()`);
    await waitFor(evalJS, `document.documentElement.lang === 'zh-CN' && !!document.querySelector('.bookmark-item')`, 10000);
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === '哔哩哔哩')`), true);
    assert.equal(await evalJS(`pageData.bookmarks.some(bookmark => bookmark.name === '我的自定义书签')`), true);
    console.log('✅ 英文全站、语言草稿与保存失败、书签继承、天气缓存、桌面/触屏布局及离线切换通过');
} finally {
    await chrome.close();
    await server.close();
}
