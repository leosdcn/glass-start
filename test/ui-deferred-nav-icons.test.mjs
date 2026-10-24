/** 首批本地图标空闲准备；其余图标在进入、滚动和会话恢复时按需加载。 */
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
    await waitFor(evalJS, `dom.navCategories.querySelector('.category-block:nth-child(-n+3) img.lazy-icon[src]')?.fetchPriority === 'low'`);
    assert.equal(await evalJS(`(() => {
        const firstScreen = new Set([...dom.bookmarks.querySelectorAll('img')].map(img=>img.src));
        const resources = performance.getEntriesByType('resource').map(entry=>entry.name);
        const deferred = [...dom.navSection.querySelectorAll('img[data-nav-src]')];
        const prepared = [...dom.navCategories.querySelectorAll('.category-block:nth-child(-n+3) img.lazy-icon[src]')];
        return prepared.length > 0 && prepared.every(img=>img.getAttribute('src').startsWith('./icons/') &&
            img.loading === 'eager' && img.fetchPriority === 'low') &&
            deferred.length > 75 && deferred.every(img=>!img.hasAttribute('src') &&
            (firstScreen.has(new URL(img.dataset.navSrc,location.href).href) || !resources.includes(new URL(img.dataset.navSrc,location.href).href)));
    })()`), true);
    console.log('✅ 首批本地图标以低优先级空闲准备，其余超过 75 个图标仍保持延迟加载');

    assert.deepEqual(await evalJS(`(() => {
        const parent = dom.navCategories.querySelector('.category-block');
        const local = document.createElement('img');
        const remote = document.createElement('img');
        local.dataset.navSrc = parent.querySelector('img.lazy-icon[src]').getAttribute('src');
        remote.dataset.navSrc = 'https://example.com/idle-preload-probe.png';
        parent.append(local, remote);
        try {
            document.documentElement.classList.remove('is-chrome');
            preloadVisibleNavIcons();
            const skippedOtherBrowser = !local.hasAttribute('src');
            document.documentElement.classList.add('is-chrome');
            Object.defineProperty(document, 'hidden', {configurable:true,value:true});
            preloadVisibleNavIcons();
            const skippedHidden = !local.hasAttribute('src');
            delete document.hidden;
            preloadVisibleNavIcons();
            const sources = [...dom.navSection.querySelectorAll('img')].map(img=>img.getAttribute('src'));
            preloadVisibleNavIcons();
            return [skippedOtherBrowser,skippedHidden,local.hasAttribute('src'),
                !remote.hasAttribute('src') && !!remote.dataset.navSrc,
                JSON.stringify(sources) === JSON.stringify([...dom.navSection.querySelectorAll('img')].map(img=>img.getAttribute('src')))];
        } finally {
            delete document.hidden;
            document.documentElement.classList.add('is-chrome');
            local.remove(); remote.remove();
        }
    })()`), [true,true,true,true,true]);
    console.log('✅ 非Chrome、后台页跳过准备；远程图标不提前请求，重复准备不改变图标来源');

    assert.equal(await evalJS(`(() => {
        const icons = [...dom.sidebarList.querySelectorAll('img'),
            ...dom.navCategories.querySelectorAll('.category-header img')];
        return icons.length > 0 && icons.every(img=>img.hasAttribute('src') && !img.hasAttribute('data-nav-src'));
    })()`), true);
    await waitFor(evalJS, `(() => {
        const resources = new Set(performance.getEntriesByType('resource').map(entry=>entry.name));
        const icons = pageData.categories.map(cat=>cat.icon).filter(icon=>icon?.startsWith('./'));
        return icons.length > 0 && icons.every(icon=>resources.has(new URL(icon,location.href).href));
    })()`);
    assert.equal(await evalJS('state.currentSection'), 'start');
    console.log('✅ 分类图标直接设置地址，停留首屏时已请求预加载，不必等待进入导航');

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

    // 人为延迟空闲回调，确保用户先切屏时不会等待或在动画中补做预加载。
    await evalJS('switchToStart()');
    await waitFor(evalJS, '!isScreenTransitioning()');
    await send('Page.addScriptToEvaluateOnNewDocument', {source:`
        window.__queuedIdle = [];
        window.requestIdleCallback = callback => { __queuedIdle.push(callback); return __queuedIdle.length; };
    `});
    await send('Page.reload');
    await waitFor(evalJS, 'typeof switchToNav === "function" && window.__queuedIdle?.length >= 2');
    assert.deepEqual(await evalJS(`(() => {
        // 目录渲染本身也在被扣住的空闲任务中；先建立本用例要测量的延迟图标。
        renderNavCategories();
        const pending = dom.navSection.querySelectorAll('img[data-nav-src]').length;
        switchToNav();
        const active = isScreenTransitioning();
        for (const callback of __queuedIdle.splice(0)) callback({didTimeout:false,timeRemaining:()=>50});
        return [pending > 100, state.currentSection, active,
            dom.navSection.querySelectorAll('img[fetchpriority="low"]').length];
    })()`), [true,'nav',true,0]);
    await waitFor(evalJS, '!isScreenTransitioning()');
    console.log('✅ 用户先切屏时立即进入，迟到的空闲回调不在动画中准备图标');
} finally {
    await chrome.close();
    await server.close();
}
