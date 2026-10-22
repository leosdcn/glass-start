/** 分类位置缓存复用、布局变化与分类重建后的高亮回归。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor, sleep } from './helpers.mjs';

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
    await evalJS('renderNavCategories(true)');
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
