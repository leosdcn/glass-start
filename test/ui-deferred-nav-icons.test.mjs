/** 首屏不下载导航专用图标，进入、滚动和会话恢复仍使用原生图片懒加载。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
try {
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        localStorage.setItem('glass_weather_cache', JSON.stringify({timestamp:Date.now(),current:{temp:20},daily:[]}));
    ` });
    await send('Page.reload');
    await waitFor(evalJS, 'typeof switchToNav === "function" && dom.navCategories.querySelector("img[data-nav-src]")');
    assert.equal(await evalJS(`(() => {
        const firstScreen = new Set([...dom.bookmarks.querySelectorAll('img')].map(img=>img.src));
        const resources = performance.getEntriesByType('resource').map(entry=>entry.name);
        const deferred = [...dom.navSection.querySelectorAll('img[data-nav-src]')];
        return deferred.length > 100 && deferred.every(img=>!img.hasAttribute('src') &&
            (firstScreen.has(new URL(img.dataset.navSrc,location.href).href) || !resources.includes(new URL(img.dataset.navSrc,location.href).href)));
    })()`), true);
    console.log('✅ 首屏超过 100 个导航图片节点保持延迟状态，导航专用图标无网络请求');

    await evalJS('switchToNav()');
    await waitFor(evalJS, '!isScreenTransitioning() && dom.navCategories.querySelector("img").naturalWidth > 0');
    assert.equal(await evalJS(`dom.navSection.querySelectorAll('img[data-nav-src]').length`), 0);
    await evalJS(`(() => {
        window.lastNavIcon = dom.navCategories.querySelector('.category-block:last-child img.lazy-icon');
        lastNavIcon.scrollIntoView({block:'center',behavior:'instant'});
    })()`);
    await waitFor(evalJS, 'lastNavIcon.naturalWidth > 0 && lastNavIcon.classList.contains("loaded")');
    await evalJS('switchToStart()');
    await waitFor(evalJS, '!isScreenTransitioning()');
    await evalJS('switchToNav()');
    await waitFor(evalJS, '!isScreenTransitioning()');
    assert.equal(await evalJS('lastNavIcon.isConnected && lastNavIcon.naturalWidth > 0'), true);
    console.log('✅ 导航首次进入与末尾滚动正常加载图标，往返切屏复用已有节点');

    await send('Page.reload');
    await waitFor(evalJS, 'typeof switchToNav === "function" && state.currentSection === "nav" && dom.navCategories.querySelector("img")?.naturalWidth > 0');
    assert.equal(await evalJS('dom.navSection.querySelectorAll("img[data-nav-src]").length'), 0);
    console.log('✅ 会话恢复直接进入导航时自动启用图标加载');
} finally {
    await chrome.close();
    await server.close();
}
