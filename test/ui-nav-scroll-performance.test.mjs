/** 验证导航页原生滚轮滚动不进入常驻的主线程阻塞区域。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

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
