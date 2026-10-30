import assert from 'node:assert/strict';
import { launchSession, waitFor, sleep } from './support/helpers.mjs';
import { test } from 'node:test';

await test("图标空闲准备与延迟加载", async () => {
    /** 首批本地图标空闲准备；其余图标在进入、滚动和会话恢复时按需加载。 */



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
        const icons = [...dom.bookmarks.querySelectorAll('img'),
            ...dom.sidebarList.querySelectorAll('img'),
            ...dom.navCategories.querySelectorAll('.category-header img')];
        return icons.length > 0 && icons.every(img => !img.hasAttribute('loading'));
    })()`), true);
        await waitFor(evalJS, `dom.navCategories.querySelector('.category-block:nth-child(-n+5) img.lazy-icon[src]')?.fetchPriority === 'low'`);
        assert.equal(await evalJS(`(() => {
        const firstScreen = new Set([...dom.bookmarks.querySelectorAll('img')].map(img=>img.src));
        const resources = performance.getEntriesByType('resource').map(entry=>entry.name);
        const deferred = [...dom.navSection.querySelectorAll('img[data-nav-src]')];
        const prepared = [...dom.navCategories.querySelectorAll('.category-block:nth-child(-n+5) img.lazy-icon[src]')];
        return prepared.length > 0 && prepared.every(img=>img.getAttribute('src').startsWith('./icons/') &&
            img.loading === 'eager' && img.fetchPriority === 'low') &&
            deferred.length >= 70 && deferred.every(img=>!img.hasAttribute('src') &&
            (firstScreen.has(new URL(img.dataset.navSrc,location.href).href) || !resources.includes(new URL(img.dataset.navSrc,location.href).href)));
    })()`), true);
        console.log('✅ 首批本地图标以低优先级空闲准备，其余 70 个图标仍保持延迟加载');

        assert.deepEqual(await evalJS(`(() => {
        const parent = dom.navCategories.querySelector('.category-block');
        const local = document.createElement('img');
        const remote = document.createElement('img');
        local.dataset.navSrc = parent.querySelector('img.lazy-icon[src]').getAttribute('src');
        remote.dataset.navSrc = 'https://example.com/idle-preload-probe.png';
        parent.append(local, remote);
        try {
            Object.defineProperty(document, 'hidden', {configurable:true,value:true});
            preloadVisibleNavIcons();
            const skippedHidden = !local.hasAttribute('src');
            delete document.hidden;
            preloadVisibleNavIcons();
            const sources = [...dom.navSection.querySelectorAll('img')].map(img=>img.getAttribute('src'));
            preloadVisibleNavIcons();
            return [skippedHidden,local.hasAttribute('src'),
                !remote.hasAttribute('src') && !!remote.dataset.navSrc,
                JSON.stringify(sources) === JSON.stringify([...dom.navSection.querySelectorAll('img')].map(img=>img.getAttribute('src')))];
        } finally {
            delete document.hidden;
            local.remove(); remote.remove();
        }
    })()`), [true,true,true,true]);
        console.log('✅ 后台页跳过准备；远程图标不提前请求，重复准备不改变图标来源');

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
        await waitFor(evalJS, 'dom.navSection.querySelectorAll("img[data-nav-src]").length === 0', 2500);
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
        await waitFor(evalJS, 'dom.navSection.querySelectorAll("img[data-nav-src]").length === 0', 2500);
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
});

await test("分类位置缓存与侧栏高亮", async () => {
    /** 分类位置缓存复用、布局变化与分类重建后的高亮回归。 */



    const { server, chrome, send, evalJS } = await launchSession();
    try {
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS('document.fonts.ready');
        await sleep(400); // 等待初始尺寸观察与防抖刷新完成。
        await evalJS(`(() => {
        window.__offsetReads = 0;
        const get = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop').get;
        for (const section of dom.navCategories.children) {
            Object.defineProperty(section, 'offsetTop', { configurable:true, get() {
                window.__offsetReads++;
                return get.call(this);
            }});
        }
        switchToStart();
    })()`);
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        assert.equal(await evalJS('__offsetReads'), 0, '稳定布局往返切屏应复用分类位置');

        // 只改变某一分类高度，滚动容器尺寸不变，仍须使缓存失效。
        await evalJS(`dom.navCategories.firstElementChild.style.paddingBottom = '1000px'`);
        await waitFor(evalJS, '__offsetReads > 0');
        await evalJS(`dom.navContent.style.scrollBehavior='auto';
        dom.navContent.scrollTop=document.getElementById('cat-1').offsetTop-500;
        updateSidebarActive()`);
        assert.equal(await evalJS('dom.sidebarList.querySelector(".active").dataset.target'), 'cat-0');
        await evalJS(`dom.navContent.scrollTop=document.getElementById('cat-1').offsetTop;
        updateSidebarActive()`);
        assert.equal(await evalJS('dom.sidebarList.querySelector(".active").dataset.target'), 'cat-1');

        // 分类重建必须丢弃旧节点和尺寸，观察器也要跟随新节点。
        const scrollPreserved = await evalJS(`(() => {
        const before = dom.navContent.scrollTop;
        renderNavCategories(true);
        return before > 0 && dom.navContent.scrollTop === before;
    })()`);
        assert.equal(scrollPreserved, true, '重建已有目录应保留当前滚动位置');
        await sleep(400);
        await evalJS(`dom.navContent.scrollTop=document.getElementById('cat-1').offsetTop;
        updateSidebarActive()`);
        assert.equal(await evalJS('dom.sidebarList.querySelector(".active").dataset.target'), 'cat-1');
        await evalJS(`dom.navCategories.firstElementChild.style.paddingBottom='1000px'`);
        await sleep(400);
        await evalJS(`dom.navContent.scrollTop=document.getElementById('cat-1').offsetTop-500;
        updateSidebarActive()`);
        assert.equal(await evalJS('dom.sidebarList.querySelector(".active").dataset.target'), 'cat-0');
        await send('Emulation.setDeviceMetricsOverride', {
            width:390, height:844, deviceScaleFactor:1, mobile:false
        });
        await sleep(400);
        await evalJS(`dom.navContent.scrollTop=document.getElementById('cat-1').offsetTop;
        updateSidebarActive()`);
        assert.equal(await evalJS('dom.sidebarList.querySelector(".active").dataset.target'), 'cat-1');
        console.log('✅ 稳定切屏复用位置，分类高度变化与重建后仍正确刷新分类高亮');
    } finally {
        await chrome.close();
        await server.close();
    }
});

await test("原生滚动与事件阻塞区域", async () => {
    /** 验证导航页原生滚轮滚动不进入常驻的主线程阻塞区域。 */



    const { server, chrome, send, evalJS } = await launchSession();
    let layers = [];
    const wheelRegions = () => layers.flatMap(layer => layer.scrollRects || []).filter(rect => rect.type === 'WheelEventHandler');
    try {
        send('LayerTree.layerTreeDidChange', event => { layers = event.layers || []; });
        await send('LayerTree.enable');
        await evalJS('switchToNav()');
        await waitFor(evalJS, 'state.currentSection === "nav" && !isScreenTransitioning()');
        await evalJS("dom.navContent.style.scrollBehavior='auto'; dom.navContent.scrollTop=500");
        const point = await evalJS(`(() => {
        const rect = dom.navContent.getBoundingClientRect();
        return { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2 };
    })()`);
        // 验证浏览器合成层的滚轮阻塞区域，而非只检查监听器参数。
        await waitFor(async () => layers.length > 0 && wheelRegions().length === 0, 'true');
        assert.equal(wheelRegions().length, 0);

        for (let i = 0; i < 24; i++) {
            const before = await evalJS('dom.navContent.scrollTop');
            const deltaY = i % 2 === 0 ? 120 : -120;
            await send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY });
            await waitFor(evalJS, `Math.abs(dom.navContent.scrollTop - ${before}) > 20`);
            assert.equal(await evalJS('state.currentSection'), 'nav');
        }
        assert.equal(wheelRegions().length, 0);
        assert.deepEqual(await evalJS(`[
        document.querySelectorAll('#sidebarList [aria-selected="true"]').length,
        document.querySelector('#sidebarList .active')?.getAttribute('aria-selected')
    ]`), [1,'true']);
        console.log('✅ 分类内容连续上下原生滚动，无常驻滚轮阻塞区域，分类高亮保持唯一');

        await evalJS(`(() => {
        const box = dom.navContent.getBoundingClientRect();
        window.__hoveredNavCard = [...document.querySelectorAll('.nav-bookmark')].find(card => {
            const rect = card.getBoundingClientRect();
            return rect.top > box.top && rect.bottom < box.bottom;
        });
        const rect = __hoveredNavCard.getBoundingClientRect();
        __hoveredNavCard.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:rect.x+10,clientY:rect.y+10}));
    })()`);
        await waitFor(evalJS, '__hoveredNavCard.style.transform.includes("perspective")');

        // 动画时仍阻止原生滚动，完成或唤醒后必须释放。
        assert.deepEqual(await evalJS(`(() => {
        const before = dom.navContent.scrollTop;
        switchToStart();
        const e = new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true});
        document.dispatchEvent(e);
        return [e.defaultPrevented, before > 0, dom.navContent.scrollTop === before, __hoveredNavCard.style.transform];
    })()`), [true,true,true,'']);
        await waitFor(evalJS, '!isScreenTransitioning()');
        assert.equal(await evalJS('dom.navContent.scrollTop'), 0);
        assert.equal(await evalJS(`(() => {
        const e = new WheelEvent('wheel',{deltaY:-100,cancelable:true,bubbles:true});
        document.dispatchEvent(e);
        return e.defaultPrevented;
    })()`), false);
        await evalJS(`(() => {
        switchToNav();
        const card = document.querySelector('.nav-bookmark');
        const rect = card.getBoundingClientRect();
        card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:rect.x+10,clientY:rect.y+10}));
    })()`);
        await evalJS('(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); })()');
        assert.equal(await evalJS('document.querySelector(".nav-bookmark").style.transform'), '');
        assert.equal(await evalJS(`(() => {
        handleAppWakeUp();
        const e = new WheelEvent('wheel',{deltaY:10,cancelable:true,bubbles:true});
        document.dispatchEvent(e);
        return e.defaultPrevented;
    })()`), false);
        console.log('✅ 退场完成后归零内容，切屏清除并暂停卡片倾斜；滚轮锁正常释放');
    } finally {
        await chrome.close();
        await server.close();
    }
});
