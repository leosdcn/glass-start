import assert from 'node:assert/strict';
import { launchSession, waitFor, sleep } from './support/helpers.mjs';
import { test } from 'node:test';

await test("图标空闲准备与延迟加载", async () => {
    /** 首批本地图标空闲准备；其余图标在进入、滚动和会话恢复时按需加载。 */



    const { server, chrome, send, evalJS } = await launchSession();
    try {
        await send('Network.enable');
        const externalImages = [];
        const origin = `http://127.0.0.1:${server.port}`;
        send('Network.requestWillBeSent', ({ type, request }) => {
            const url = new URL(request.url);
            if (type === 'Image' && /^https?:$/.test(url.protocol) && url.origin !== origin) {
                externalImages.push(url.href);
            }
        });
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
        await waitFor(evalJS, `dom.navCategories.querySelector('img.lazy-icon[fetchpriority="low"]')`);
        assert.equal(await evalJS(`(() => {
        const firstScreen = new Set([...dom.bookmarks.querySelectorAll('img')].map(img=>img.src));
        const resources = new Set(performance.getEntriesByType('resource').map(entry=>entry.name));
        const categories = [...dom.navCategories.querySelectorAll('.category-block')];
        const limit = CONFIG.NAV.INITIAL_VISIBLE_CATEGORIES;
        const iconsIn = blocks => blocks.flatMap(block => [...block.querySelectorAll('img.lazy-icon')]);
        const prepared = iconsIn(categories.slice(0, limit));
        const deferred = iconsIn(categories.slice(limit));
        return prepared.length > 0 && prepared.every(img=>img.getAttribute('src')?.startsWith('./icons/') &&
            img.loading === 'eager' && img.fetchPriority === 'low') &&
            deferred.length > 0 && deferred.every(img => {
                if (img.hasAttribute('src') || !img.dataset.navSrc) return false;
                const url = new URL(img.dataset.navSrc, location.href).href;
                return firstScreen.has(url) || !resources.has(url);
            });
    })()`), true);
        console.log('✅ 首批本地图标以低优先级空闲准备，其余图标仍保持延迟加载');

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
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        assert.deepEqual(await evalJS(`(() => {
          const [first, second] = dom.sidebarList.querySelectorAll('button');
          const [line1, line2] = dom.navCategories.querySelectorAll('.category-header-line');
          first.click();
          const firstPulse = line1.getAnimations()[0];
          second.click();
          const secondPulse = line2.getAnimations()[0];
          const restarted = firstPulse?.playState === 'idle' && !!secondPulse;
          handleAppWakeUp();
          const woke = secondPulse?.playState === 'idle' && !line2.getAnimations().length;
          first.click();
          const leaving = line1.getAnimations()[0];
          switchToStart();
          return { restarted, woke, left: leaving?.playState === 'idle' };
        })()`), { restarted: true, woke: true, left: true });
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS(`dom.sidebarList.querySelector('button').click();
          window.motionPreferencePulse = dom.navCategories.querySelector('.category-header-line').getAnimations()[0]`);
        assert.equal(await evalJS('!!motionPreferencePulse'), true);
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await waitFor(evalJS, 'motionPreferencePulse.playState === "idle"');
        assert.equal(await evalJS(`(() => {
          dom.sidebarList.querySelector('button').click();
          return dom.navCategories.querySelector('.category-header-line').getAnimations().length;
        })()`), 0);
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await waitFor(evalJS, 'dom.navSection.querySelectorAll("img[data-nav-src]").length === 0', 2500);
        await evalJS(`(() => {
        window.lastNavIcon = dom.navCategories.querySelector('.category-block:last-child img.lazy-icon');
        lastNavIcon.scrollIntoView({block:'center',behavior:'instant'});
    })()`);
        await waitFor(evalJS, 'lastNavIcon.naturalWidth > 0 && lastNavIcon.classList.contains("loaded")');
        const iconErrors = await evalJS(`(async () => {
            const groups = [
                [dom.bookmarks, pageData.bookmarks],
                [dom.navCategories, pageData.categories.flatMap(category => category.bookmarks)]
            ];
            const errors = [];
            for (const [container, bookmarks] of groups) {
                const icons = [...container.querySelectorAll('img.lazy-icon')];
                if (!icons.length || icons.length !== bookmarks.length) {
                    errors.push(container.id + ': 图标数量 ' + icons.length + '/' + bookmarks.length);
                    continue;
                }
                const expected = bookmarks.map(bookmark => new URL(bookmark.icon, location.href).href).sort();
                const actual = icons.map(icon => icon.src).sort();
                if (expected.some((url, index) => url !== actual[index])) {
                    errors.push(container.id + ': 渲染的图标与书签目录不一致');
                }
                for (const icon of icons) {
                    const url = new URL(icon.src, location.href);
                    if (url.origin !== location.origin || !url.pathname.startsWith('/icons/')) {
                        errors.push(icon.src + ': 图标来源错误');
                        continue;
                    }
                    // 延迟加载已用末尾卡片验证，这里让离屏图片也能直接解码。
                    icon.loading = 'eager';
                    try { await icon.decode(); }
                    catch { errors.push(icon.src + ': 图标解码失败'); }
                }
            }
            return errors;
        })()`);
        assert.deepEqual(iconErrors, []);
        assert.deepEqual(externalImages, []);
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
        // 等目录、通用图标和壁纸恢复后的首批图标三个启动任务都入队。
        await waitFor(evalJS, 'typeof switchToNav === "function" && window.__queuedIdle?.length >= 3');
        assert.deepEqual(await evalJS(`(() => {
            const emptyBeforeEntry = dom.navCategories.firstElementChild === null;
            switchToNav();
            const active = isScreenTransitioning();
            for (const callback of __queuedIdle.splice(0)) callback({didTimeout:false,timeRemaining:()=>50});
            const card = dom.navCategories.querySelector('.nav-bookmark');
            return [emptyBeforeEntry, state.currentSection, active, getComputedStyle(card).contentVisibility,
                dom.navSection.querySelectorAll('img[fetchpriority="low"]').length];
        })()`), [true,'nav',true,'auto',0]);
        await waitFor(evalJS, '!isScreenTransitioning() && __queuedIdle.length === 1');
        console.log('✅ 用户先切屏时立即进入，迟到的空闲回调不在动画中准备图标');

        // 把导航收尾安排的空闲回调推迟到退场，再确认下次切入能重新安排。
        const deferredIcons = 'dom.navSection.querySelectorAll("img[data-nav-src]").length';
        const pending = await evalJS(deferredIcons);
        assert.ok(pending > 0);
        assert.deepEqual(await evalJS(`(() => {
            switchToStart();
            __queuedIdle.shift()({didTimeout:false,timeRemaining:()=>50});
            return [isScreenTransitioning(), ${deferredIcons}];
        })()`), [true, pending]);
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning() && __queuedIdle.length === 1');
        await evalJS('__queuedIdle.shift()({didTimeout:false,timeRemaining:()=>50})');
        assert.equal(await evalJS(deferredIcons), 0);
        assert.equal(await evalJS(`getComputedStyle(dom.navCategories.querySelector('.nav-bookmark')).contentVisibility`), 'visible');
        console.log('✅ 退场期间保留离屏图标的延迟状态，下次切入后正常加载');
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
        pageData.categories[0].name += '更新';
        renderNavCategories();
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

await test("最后一个分类对齐与滚动边界", async () => {
    const { server, chrome, send, evalJS } = await launchSession();
    try {
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        for (const [width, height] of [[1280, 800], [1920, 1080], [390, 844]]) {
            await send('Emulation.setDeviceMetricsOverride', {
                width, height, deviceScaleFactor: 1, mobile: width === 390
            });
            await send('Emulation.setTouchEmulationEnabled', { enabled: width === 390 });
            const { target, bottom } = await evalJS(`(() => {
                const { navContent, navCategories, sidebarList } = dom;
                navContent.scrollTo({ top: 0, behavior: 'instant' });
                sidebarList.lastElementChild.click();
                return {
                    target: navCategories.lastElementChild.offsetTop - navCategories.firstElementChild.offsetTop,
                    bottom: navContent.scrollHeight - navContent.clientHeight
                };
            })()`);
            assert.ok(Math.abs(bottom - target) <= 1, `${width}×${height} 的短分类应在顶对齐时滚到底`);
            await waitFor(evalJS, `Math.abs(dom.navContent.scrollTop - ${target}) <= 1 &&
                dom.sidebarList.lastElementChild.getAttribute('aria-selected') === 'true'`);
        }

        const lastCardClearance = await evalJS(`(() => {
            const { navContent, navCategories } = dom;
            const grid = navCategories.lastElementChild.querySelector('.nav-bookmark-grid');
            for (let i = 0; i < 30; i++) grid.append(grid.firstElementChild.cloneNode(true));
            navContent.scrollTo({ top: navContent.scrollHeight, behavior: 'instant' });
            return navContent.getBoundingClientRect().bottom - grid.lastElementChild.getBoundingClientRect().bottom;
        })()`);
        assert.ok(lastCardClearance >= 72, '长分类滚到底时最后一排应完整避开渐隐区');
    } finally {
        await chrome.close();
        await server.close();
    }
});

await test('分类高亮始终跟随位置，平滑跳转中断后照常更新', async () => {
    const { server, chrome, evalJS } = await launchSession();
    try {
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        const result = await evalJS(`(async () => {
            const { navContent, sidebarList } = dom;
            const current = () => sidebarList.querySelector('.active').dataset.target;
            const end = () => new Promise(resolve => navContent.addEventListener('scrollend', resolve, { once: true }));
            const firstEnd = end();
            sidebarList.children[2].click();
            await firstEnd;

            sidebarList.children[5].click();
            // 旧滚动结束时，新的平滑滚动还没移动。
            navContent.dispatchEvent(new Event('scrollend'));
            updateSidebarActive();
            const during = current();
            await end();
            updateSidebarActive();
            const arrived = current();

            sidebarList.children[4].click();
            const finalEnd = end();
            navContent.scrollTo({ top: 0, behavior: 'instant' });
            await finalEnd;
            updateSidebarActive();
            return { during, arrived, after: current() };
        })()`);
        assert.deepEqual(result, { during: 'cat-2', arrived: 'cat-5', after: 'cat-0' });
    } finally {
        await chrome.close();
        await server.close();
    }
});

await test("窄屏分类栏首尾按钮保留对称边距", async () => {
    const { server, chrome, send, evalJS } = await launchSession();
    try {
        await send('Emulation.setDeviceMetricsOverride', {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true
        });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await evalJS('switchToNav()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        const leftInset = await evalJS(`dom.sidebarList.firstElementChild.getBoundingClientRect().left -
            dom.sidebar.getBoundingClientRect().left`);
        const mask = await evalJS('getComputedStyle(dom.sidebar).maskImage');
        assert.notEqual(mask, 'none', '窄屏分类栏应保留固定渐隐');

        await evalJS('dom.sidebarList.lastElementChild.click()');
        await waitFor(evalJS, `Math.abs(dom.sidebar.scrollLeft - (dom.sidebar.scrollWidth - dom.sidebar.clientWidth)) < 1 &&
            dom.sidebarList.lastElementChild.getAttribute('aria-selected') === 'true'`);
        const rightInset = await evalJS(`dom.sidebar.getBoundingClientRect().right -
            dom.sidebarList.lastElementChild.getBoundingClientRect().right`);
        assert.equal(leftInset, 8, '首个分类的边框应避开渐隐区域');
        assert.ok(Math.abs(rightInset - leftInset) < 1, '首尾分类在滚动端点应有相同留白');
        assert.equal(await evalJS('getComputedStyle(dom.sidebar).maskImage'), mask, '渐隐遮罩应随滚动保持固定');
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
